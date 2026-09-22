// 保险库状态机：模块级 store（宿主 moduleCache 使其跨页面切换存活）。
// React 侧用 useSyncExternalStore(subscribe, getState) 订阅。
// 保存统一走 saveChain 串行队列；失败置 saveError（内存态保留，UI 给重试）。
import {
  PBKDF2_ITERATIONS,
  SALT_LEN,
  WrongPasswordError,
  VaultFileError,
  deriveKey,
  fromB64,
  openVault,
  parseVaultFile,
  randomBytes,
  sealVault,
  uuid,
} from "./crypto";
import { mergeDedup } from "./match";
import * as storage from "./storage";
import { toCsv } from "./csv";
import type { ImportedEntry, VaultEntry, VaultFile, VaultStatus, VaultView } from "./types";

export interface VaultState {
  status: VaultStatus;
  view: VaultView;
  editingId: string | null;
  /** 仅 unlocked 非 null。锁定时清引用（等 GC）。 */
  entries: VaultEntry[] | null;
  key: CryptoKey | null;
  kdfMeta: { salt: Uint8Array; iterations: number } | null;
  /** 外层明文元数据（锁定页展示条数/更新时间）。 */
  fileMeta: { entryCount: number; updatedAt: number } | null;
  /** boot 失败 / 文件损坏等阻断性错误。 */
  error: string | null;
  /** 非阻断提示（.bak 回退、忽略损坏条目等）。 */
  notice: string | null;
  /** 保存失败（内存态仍在，可重试）。 */
  saveError: string | null;
  storageMode: storage.StorageMode | null;
  storageDir: string;
}

let state: VaultState = {
  status: "booting",
  view: "list",
  editingId: null,
  entries: null,
  key: null,
  kdfMeta: null,
  fileMeta: null,
  error: null,
  notice: null,
  saveError: null,
  storageMode: null,
  storageDir: "",
};

/** 最近一次解析成功的外层文件（解锁时复用，不重复读盘）。 */
let currentFile: VaultFile | null = null;
let bootPromise: Promise<void> | null = null;

const listeners = new Set<() => void>();

function set(patch: Partial<VaultState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): VaultState {
  return state;
}

/* ---- 解锁失败退避（模块级，防爆破） ---- */

let failCount = 0;
let lastFailAt = 0;

/** 当前仍需等待的退避毫秒数（0 = 可尝试）。 */
export function backoffRemainingMs(): number {
  if (failCount === 0) return 0;
  const waitMs = Math.min(2 ** (failCount - 1), 30) * 1000;
  return Math.max(0, lastFailAt + waitMs - Date.now());
}

/* ---- 保存队列 ---- */

let saveChain: Promise<void> = Promise.resolve();

function persist(): void {
  const work = async (): Promise<void> => {
    const s = state;
    if (s.status !== "unlocked" || !s.key || !s.entries || !s.kdfMeta) return;
    const file = await sealVault(s.key, { schemaVersion: 1, entries: s.entries }, s.kdfMeta);
    const bytes = new TextEncoder().encode(JSON.stringify(file));
    await storage.writeVaultFileAtomic(bytes);
    currentFile = file;
    set({ saveError: null, fileMeta: { entryCount: file.entryCount, updatedAt: file.updatedAt } });
  };
  saveChain = saveChain.then(work).catch((e: unknown) => {
    set({ saveError: `保存到磁盘失败：${String((e as Error)?.message ?? e)}。数据仍在内存中，不会丢失。` });
  });
}

/** 保存失败后的手动重试。 */
export function retrySave(): void {
  persist();
}

/* ---- 启动 ---- */

async function bootInner(): Promise<void> {
  const { dir, mode } = await storage.resolveDataDir();
  let file: VaultFile | null = null;
  let notice: string | null = null;
  let error: string | null = null;

  const tryParse = async (which: "main" | "bak"): Promise<{ file: VaultFile | null; read: storage.VaultRead }> => {
    const read = await storage.readVault(which);
    if (read.state !== "ok") return { file: null, read };
    try {
      return { file: parseVaultFile(read.bytes), read };
    } catch {
      return { file: null, read: { state: "error", message: "内容无法解析" } };
    }
  };

  const main = await tryParse("main");
  if (main.file) {
    file = main.file;
  } else {
    // 主文件缺失/损坏 → 尝试 .bak（绝不静默重建空库）
    const bak = await tryParse("bak");
    if (bak.file) {
      file = bak.file;
      if (main.read.state === "error") notice = "主文件损坏，已自动回退到 .bak 副本（建议尽快导出备份）";
      else notice = "主文件丢失，已自动回退到 .bak 副本";
    } else if (main.read.state === "error") {
      error = `保险库文件损坏（${main.read.message}）。请从加密备份恢复。数据目录：${dir || "(浏览器模式)"}`;
    }
  }

  if (!file) {
    if (error) {
      set({ status: "locked", storageMode: mode, storageDir: dir, error, notice: null, kdfMeta: null });
    } else {
      set({ status: "no-vault", storageMode: mode, storageDir: dir, error: null, notice: null });
    }
    return;
  }
  currentFile = file;
  set({
    status: "locked",
    storageMode: mode,
    storageDir: dir,
    kdfMeta: { salt: fromB64(file.kdf.salt), iterations: file.kdf.iterations },
    fileMeta: { entryCount: file.entryCount, updatedAt: file.updatedAt },
    error: null,
    notice,
  });
}

/** 幂等 boot（destroyVault / replaceWithBackup 后会重置再 boot）。 */
export function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = bootInner().catch((e: unknown) => {
      set({ status: "no-vault", error: `初始化失败：${String((e as Error)?.message ?? e)}` });
    });
  }
  return bootPromise;
}

/* ---- 生命周期动作 ---- */

/** 首次创建：设置管理密码并落盘空库。 */
export async function setupVault(password: string): Promise<void> {
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const file = await sealVault(key, { schemaVersion: 1, entries: [] }, { salt, iterations: PBKDF2_ITERATIONS });
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  await storage.writeVaultFileAtomic(bytes);
  currentFile = file;
  failCount = 0;
  set({
    status: "unlocked",
    view: "list",
    editingId: null,
    entries: [],
    key,
    kdfMeta: { salt, iterations: PBKDF2_ITERATIONS },
    fileMeta: { entryCount: 0, updatedAt: file.updatedAt },
    error: null,
    notice: null,
    saveError: null,
  });
}

/** 解锁。密码错误抛 WrongPasswordError（并累计退避）。 */
export async function unlock(password: string): Promise<void> {
  const s = state;
  if (s.status !== "locked" || !currentFile || !s.kdfMeta) {
    throw new VaultFileError("保险库状态异常，请重新进入本页");
  }
  const key = await deriveKey(password, s.kdfMeta.salt, s.kdfMeta.iterations);
  let opened: Awaited<ReturnType<typeof openVault>>;
  try {
    opened = await openVault(key, currentFile);
  } catch (e) {
    if (e instanceof WrongPasswordError) {
      failCount++;
      lastFailAt = Date.now();
    }
    throw e;
  }
  failCount = 0;
  set({
    status: "unlocked",
    view: "list",
    editingId: null,
    entries: opened.payload.entries,
    key,
    notice: opened.dropped > 0 ? `已忽略 ${opened.dropped} 条损坏的记录` : s.notice,
    error: null,
  });
}

/** 锁定：清密钥与明文（引用置 null 等 GC；字符串无法主动擦零，见安全说明）。 */
export function lock(): void {
  if (state.status !== "unlocked") return;
  set({ status: "locked", key: null, entries: null, view: "list", editingId: null });
}

/** 校验密码（明文导出/改密等敏感操作前防离座）。 */
export async function verifyPassword(password: string): Promise<boolean> {
  if (!currentFile || !state.kdfMeta) return false;
  try {
    const key = await deriveKey(password, state.kdfMeta.salt, state.kdfMeta.iterations);
    await openVault(key, currentFile);
    return true;
  } catch {
    return false;
  }
}

/* ---- 视图 ---- */

export function setView(view: VaultView): void {
  set({ view });
}

export function openNew(): void {
  set({ view: "form", editingId: null });
}

export function openEdit(id: string): void {
  set({ view: "form", editingId: id });
}

/* ---- CRUD ---- */

export function addEntry(input: Omit<VaultEntry, "id" | "createdAt" | "updatedAt">): void {
  if (!state.entries) return;
  const now = Date.now();
  const entry: VaultEntry = { ...input, id: uuid(), createdAt: now, updatedAt: now };
  set({ entries: [entry, ...state.entries], view: "list", editingId: null });
  persist();
}

export function updateEntry(
  id: string,
  patch: Omit<VaultEntry, "id" | "createdAt" | "updatedAt">,
): void {
  if (!state.entries) return;
  const now = Date.now();
  const entries = state.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now } : e));
  set({ entries, view: "list", editingId: null });
  persist();
}

export function deleteEntry(id: string): void {
  if (!state.entries) return;
  set({ entries: state.entries.filter((e) => e.id !== id) });
  persist();
}

/* ---- 导入 ---- */

export interface ImportOutcome {
  added: number;
  updated: number;
}

export function importEntries(
  fresh: ImportedEntry[],
  overwrites: Array<{ existingId: string; data: ImportedEntry }>,
): ImportOutcome {
  if (!state.entries) return { added: 0, updated: 0 };
  const now = Date.now();
  const toEntry = (d: ImportedEntry, id: string, createdAt: number): VaultEntry => ({
    id,
    name: d.name,
    kind: d.url ? "web" : "app",
    url: d.url,
    username: d.username,
    password: d.password,
    note: d.note,
    createdAt,
    updatedAt: now,
  });
  const entries = state.entries.map((e) => {
    const hit = overwrites.find((o) => o.existingId === e.id);
    return hit ? toEntry(hit.data, e.id, e.createdAt) : e; // 保 id/createdAt，其余以导入为准
  });
  const added = fresh.map((d) => toEntry(d, uuid(), now));
  set({ entries: [...added, ...entries], view: "list" });
  persist();
  return { added: added.length, updated: overwrites.length };
}

/* ---- 备份 / 恢复 / 改密 / 销毁 ---- */

/** 等待在途保存全部落盘后，把最近一次的密文字节原样复制为备份（不产生第二份明文）。 */
export async function exportBackup(): Promise<string> {
  await saveChain;
  if (!currentFile) throw new Error("保险库尚未保存，无法备份");
  return storage.writeBackupBytes(new TextEncoder().encode(JSON.stringify(currentFile)));
}

/** 用当前解锁态导出明文 CSV（调用前必须 verifyPassword 过）。 */
export async function exportPlainCsv(): Promise<string> {
  if (!state.entries) throw new Error("保险库未解锁");
  const rows: string[][] = [
    ["name", "url", "username", "password", "note"],
    ...state.entries.map((e) => [e.name, e.url, e.username, e.password, e.note]),
  ];
  return storage.writePlainCsv(toCsv(rows));
}

/** 恢复-替换：备份字节整体覆盖当前库，随后回到锁定态（需用备份时的管理密码解锁）。 */
export async function replaceWithBackup(bytes: Uint8Array): Promise<void> {
  const file = parseVaultFile(bytes); // 结构不对抛 VaultFileError
  await storage.writeVaultFileAtomic(new TextEncoder().encode(JSON.stringify(file)));
  currentFile = null;
  bootPromise = null;
  set({ status: "booting", entries: null, key: null, view: "list", editingId: null, error: null, notice: null, saveError: null });
  await boot();
}

/** 恢复-合并：备份的管理密码解密后并入当前库（同键取较新者），当前密钥重加密。 */
export async function mergeBackup(
  bytes: Uint8Array,
  backupPassword: string,
): Promise<{ added: number; updated: number; keptCurrent: number }> {
  if (state.status !== "unlocked" || !state.entries) throw new Error("请先解锁当前保险库");
  const file = parseVaultFile(bytes);
  const backupKey = await deriveKey(backupPassword, fromB64(file.kdf.salt), file.kdf.iterations);
  const { payload } = await openVault(backupKey, file); // 备份密码错 → WrongPasswordError
  const { merged, added, updated, keptCurrent } = mergeDedup(state.entries, payload.entries);
  set({ entries: merged });
  persist();
  return { added, updated, keptCurrent };
}

/** 修改管理密码：新盐新钥重加密全量；写盘失败则文件与内存均保持旧密码态。 */
export async function changeMaster(newPassword: string): Promise<void> {
  if (state.status !== "unlocked" || !state.entries) throw new Error("请先解锁保险库");
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKey(newPassword, salt, PBKDF2_ITERATIONS);
  const file = await sealVault(key, { schemaVersion: 1, entries: state.entries }, { salt, iterations: PBKDF2_ITERATIONS });
  await storage.writeVaultFileAtomic(new TextEncoder().encode(JSON.stringify(file)));
  currentFile = file;
  set({ key, kdfMeta: { salt, iterations: PBKDF2_ITERATIONS }, fileMeta: { entryCount: file.entryCount, updatedAt: file.updatedAt } });
}

/** 销毁保险库（调用方必须已完成管理密码 + DELETE 双确认）。 */
export async function destroyVault(): Promise<void> {
  await storage.clearVaultFiles();
  currentFile = null;
  bootPromise = null;
  failCount = 0;
  set({
    status: "no-vault",
    view: "list",
    editingId: null,
    entries: null,
    key: null,
    kdfMeta: null,
    fileMeta: null,
    error: null,
    notice: null,
    saveError: null,
  });
}
