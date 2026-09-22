// 加密核心：WebCrypto PBKDF2-SHA256 → AES-256-GCM。
// 纯逻辑模块：不得 import Tauri / DOM 副作用（smoke.mts 在 node 下直接引用，
// node ≥19 有全局 crypto.subtle / btoa / TextEncoder）。
import type { VaultEntry, VaultFile, VaultPayload } from "./types";

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_LEN = 16;
export const IV_LEN = 12;
export const VAULT_SCHEMA_VERSION = 1;

/** 管理密码错误（GCM 认证失败）。 */
export class WrongPasswordError extends Error {
  constructor(message = "管理密码错误") {
    super(message);
    this.name = "WrongPasswordError";
  }
}

/** 保险库文件损坏 / 结构不识别 / 版本过新。 */
export class VaultFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultFileError";
  }
}

/* ---- 编码工具 ---- */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  // Web Crypto 规范限制单次 ≤65536 字节，超出分块填充
  const LIMIT = 65_536;
  for (let off = 0; off < n; off += LIMIT) {
    globalThis.crypto.getRandomValues(b.subarray(off, Math.min(off + LIMIT, n)));
  }
  return b;
}

/** 随机 UUID v4（randomBytes 实现，不依赖 crypto.randomUUID 可用性）。 */
export function uuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeText(s: string): Uint8Array {
  return textEncoder.encode(s);
}

export function decodeText(b: Uint8Array): string {
  return textDecoder.decode(b);
}

/* ---- KDF 与对称加解密 ---- */

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new VaultFileError("当前环境不支持 WebCrypto，无法加解密");
  return s;
};

/** 管理密码 → 非可导出 AES-GCM 256 密钥。 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const keyMaterial = await subtle().importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plain: Uint8Array,
): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = randomBytes(IV_LEN);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    plain as unknown as BufferSource,
  );
  return { iv, ct: new Uint8Array(ct) };
}

/** 认证失败（密码错/篡改）抛 WrongPasswordError。 */
export async function decryptBytes(
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array> {
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      ct as unknown as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new WrongPasswordError();
  }
}

/* ---- vault 文件封包 / 拆包 ---- */

/** 明文 payload + KDF 参数 → 可落盘的 VaultFile（随机 IV）。 */
export async function sealVault(
  key: CryptoKey,
  payload: VaultPayload,
  kdf: { salt: Uint8Array; iterations: number },
): Promise<VaultFile> {
  const { iv, ct } = await encryptBytes(key, encodeText(JSON.stringify(payload)));
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    kdf: { algo: "PBKDF2-SHA256", iterations: kdf.iterations, salt: toB64(kdf.salt) },
    cipher: { algo: "AES-256-GCM", iv: toB64(iv), ct: toB64(ct) },
    entryCount: payload.entries.length,
    updatedAt: Date.now(),
  };
}

/** 解析并校验外层结构（不解密）。损坏/不识别抛 VaultFileError。 */
export function parseVaultFile(bytes: Uint8Array): VaultFile {
  let obj: unknown;
  try {
    obj = JSON.parse(decodeText(bytes));
  } catch {
    throw new VaultFileError("保险库文件不是有效的 JSON（可能已损坏）");
  }
  if (obj === null || typeof obj !== "object") {
    throw new VaultFileError("保险库文件结构不识别");
  }
  const raw = obj as Record<string, unknown>;
  const sv = raw.schemaVersion;
  if (typeof sv !== "number") throw new VaultFileError("保险库文件缺少版本号");
  if (sv > VAULT_SCHEMA_VERSION) {
    throw new VaultFileError("此保险库由更新版本的插件创建，请先升级插件");
  }
  const kdf = raw.kdf as Record<string, unknown> | undefined;
  const cipher = raw.cipher as Record<string, unknown> | undefined;
  if (
    !kdf || typeof kdf !== "object" || typeof kdf.salt !== "string" ||
    !cipher || typeof cipher !== "object" ||
    typeof cipher.iv !== "string" || typeof cipher.ct !== "string"
  ) {
    throw new VaultFileError("保险库文件结构不完整（缺少加密参数）");
  }
  const iterations = typeof kdf.iterations === "number" ? kdf.iterations : PBKDF2_ITERATIONS;
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 10_000_000) {
    throw new VaultFileError("保险库文件的 KDF 迭代数异常，拒绝使用");
  }
  // b64 必须可解码，否则后续 deriveKey 会得到错误 salt
  try {
    fromB64(kdf.salt);
    fromB64(cipher.iv);
    fromB64(cipher.ct);
  } catch {
    throw new VaultFileError("保险库文件的加密参数编码损坏");
  }
  return {
    schemaVersion: sv,
    kdf: { algo: "PBKDF2-SHA256", iterations, salt: kdf.salt },
    cipher: { algo: "AES-256-GCM", iv: cipher.iv, ct: cipher.ct },
    entryCount: typeof raw.entryCount === "number" ? raw.entryCount : 0,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
}

/** 备份文件结构预检（用于恢复前确认"这是一个保险库文件"）。 */
export function isVaultFile(bytes: Uint8Array): boolean {
  try {
    parseVaultFile(bytes);
    return true;
  } catch {
    return false;
  }
}

/** 单条 entry 宽松清洗：字段缺失/类型异常尽量补默认值，仅丢弃非对象项。 */
function sanitizeEntry(item: unknown): VaultEntry | null {
  if (item === null || typeof item !== "object") return null;
  const e = item as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const url = str(e.url);
  const kind = e.kind === "app" || e.kind === "web" ? e.kind : url ? "web" : "app";
  const createdAt = num(e.createdAt) || Date.now();
  return {
    id: typeof e.id === "string" && e.id ? e.id : uuid(),
    name: str(e.name) || url || "(未命名)",
    kind,
    url,
    username: str(e.username),
    password: str(e.password),
    note: str(e.note),
    createdAt,
    updatedAt: num(e.updatedAt) || createdAt,
  };
}

/** 解密并解析 payload。密码错误抛 WrongPasswordError，内容损坏抛 VaultFileError。 */
export async function openVault(
  key: CryptoKey,
  file: VaultFile,
): Promise<{ payload: VaultPayload; dropped: number }> {
  const plain = await decryptBytes(key, fromB64(file.cipher.iv), fromB64(file.cipher.ct));
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(plain));
  } catch {
    throw new VaultFileError("保险库内容解析失败（数据已损坏）");
  }
  const rawEntries = (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(rawEntries)) {
    throw new VaultFileError("保险库内容缺少条目列表（数据已损坏）");
  }
  const entries: VaultEntry[] = [];
  let dropped = 0;
  for (const item of rawEntries) {
    const entry = sanitizeEntry(item);
    if (entry) entries.push(entry);
    else dropped++;
  }
  return { payload: { schemaVersion: VAULT_SCHEMA_VERSION, entries }, dropped };
}
