// 存储层：本插件唯一的 Tauri 触点（fs 原语）。
// 数据目录：%LOCALAPPDATA%/com.toolbox.app/password-vault/（fs_cache_dir 剥掉尾段 cache，
// 避免被用户当缓存清理；剥离异常回退 <cache>/password-vault/）。
// 纯浏览器 dev（无 Tauri IPC）时回退 localStorage（仅开发调试用）。
// 注意：tauri dev 与正式安装版共用该目录。
import { invoke } from "@tauri-apps/api/core";

export const LS_DATA_KEY = "toolbox-password-vault-data";
export const LS_BACKUP_KEY = "toolbox-password-vault-backup";
export const LS_EXPORT_KEY = "toolbox-password-vault-export";

const VAULT_FILE = "vault.json";
const BACKUP_DIR = "backup";

export type StorageMode = "fs" | "ls";

let cachedMode: StorageMode | null = null;
let cachedDir = "";

export interface DataDirInfo {
  dir: string;
  mode: StorageMode;
}

/** 解析（并缓存）数据目录；fs 模式下顺带确保目录存在。 */
export async function resolveDataDir(): Promise<DataDirInfo> {
  if (cachedMode !== null) return { dir: cachedDir, mode: cachedMode };
  try {
    const cache = await invoke<string>("fs_cache_dir");
    if (!cache) throw new Error("fs_cache_dir 返回空");
    const parts = cache.split(/[\\/]+/).filter(Boolean);
    let root = cache;
    if (parts.length > 1 && parts[parts.length - 1].toLowerCase() === "cache") {
      root = parts.slice(0, -1).join("/"); // Windows 接受正斜杠
    }
    cachedDir = `${root}/password-vault`;
    cachedMode = "fs";
    await invoke("fs_create_dir_all", { path: cachedDir });
  } catch {
    // 无 Tauri IPC（纯浏览器 dev）→ localStorage 兜底
    cachedMode = "ls";
    cachedDir = "";
  }
  return { dir: cachedDir, mode: cachedMode };
}

/* ---- 底层字节读写 ---- */

async function readBytes(path: string): Promise<Uint8Array | null> {
  const raw = await invoke<ArrayBuffer | Uint8Array | number[]>("fs_read_bytes", { path });
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(raw);
  return null;
}

async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await invoke("fs_write_bytes", { path, data });
}

async function exists(path: string): Promise<boolean> {
  return invoke<boolean>("fs_exists", { path });
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await invoke("fs_remove_file", { path });
  } catch {
    // 不存在即忽略
  }
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/* ---- vault.json 读写（原子） ---- */

export type VaultRead =
  | { state: "missing" }
  | { state: "ok"; bytes: Uint8Array }
  | { state: "error"; message: string };

function vaultPath(which: "main" | "bak" | "tmp"): string {
  const suffix = which === "main" ? "" : `.${which}`;
  return `${cachedDir}/${VAULT_FILE}${suffix}`;
}

/** 读主文件或 .bak 副本。missing（不存在）/ ok / error（存在但读失败）三态。 */
export async function readVault(which: "main" | "bak"): Promise<VaultRead> {
  const { mode } = await resolveDataDir();
  if (mode === "ls") {
    if (which === "bak") return { state: "missing" };
    const text = localStorage.getItem(LS_DATA_KEY);
    if (text === null) return { state: "missing" };
    return { state: "ok", bytes: encodeUtf8(text) };
  }
  const path = vaultPath(which);
  try {
    if (!(await exists(path))) return { state: "missing" };
    const bytes = await readBytes(path);
    if (!bytes || bytes.length === 0) return { state: "error", message: "文件为空" };
    return { state: "ok", bytes };
  } catch (e) {
    return { state: "error", message: String((e as Error)?.message ?? e) };
  }
}

/**
 * 原子写：tmp → 旧文件改名为 .bak → tmp 改名为正式名。
 * 任意一步失败：删除 tmp 并抛错（正式文件要么未动、要么有 .bak 兜底）。
 */
export async function writeVaultFileAtomic(bytes: Uint8Array): Promise<void> {
  const { mode } = await resolveDataDir();
  if (mode === "ls") {
    localStorage.setItem(LS_DATA_KEY, decodeUtf8(bytes));
    return;
  }
  const main = vaultPath("main");
  const tmp = vaultPath("tmp");
  const bak = vaultPath("bak");
  try {
    await writeBytes(tmp, bytes);
    if (await exists(main)) {
      await invoke("fs_rename", { from: main, to: bak }); // Windows rename 可覆盖旧 .bak
    }
    await invoke("fs_rename", { from: tmp, to: main });
  } catch (e) {
    await removeIfExists(tmp);
    throw e;
  }
}

/* ---- 备份 / 明文导出 ---- */

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 加密备份落盘，返回完整路径（UI 展示/复制）。 */
export async function writeBackupBytes(bytes: Uint8Array): Promise<string> {
  const { dir, mode } = await resolveDataDir();
  if (mode === "ls") {
    localStorage.setItem(LS_BACKUP_KEY, decodeUtf8(bytes));
    return "（浏览器模式：备份存于本页 localStorage）";
  }
  const path = `${dir}/${BACKUP_DIR}/vault-backup-${stamp()}.json`;
  await writeBytes(path, bytes);
  return path;
}

export interface BackupItem {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export async function listBackups(): Promise<BackupItem[]> {
  const { dir, mode } = await resolveDataDir();
  if (mode === "ls") return [];
  try {
    const entries = await invoke<Array<{ name: string; path: string; isDir: boolean; size: number; modified: number }>>(
      "fs_list_dir",
      { dir: `${dir}/${BACKUP_DIR}` },
    );
    return entries
      .filter((e) => !e.isDir && e.name.endsWith(".json"))
      .map((e) => ({ name: e.name, path: e.path, size: e.size, modified: e.modified }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return []; // 目录不存在等
  }
}

/** 明文 CSV 导出落盘，返回完整路径。 */
export async function writePlainCsv(text: string): Promise<string> {
  const { dir, mode } = await resolveDataDir();
  if (mode === "ls") {
    localStorage.setItem(LS_EXPORT_KEY, text);
    return "（浏览器模式：导出内容存于本页 localStorage）";
  }
  const path = `${dir}/export-${stamp()}.csv`;
  await writeBytes(path, encodeUtf8(text));
  return path;
}

/** 删除保险库全部数据文件（vault + 副本 + 备份；明文导出文件保留）。 */
export async function clearVaultFiles(): Promise<void> {
  await resolveDataDir();
  if (cachedMode === "fs") {
    await removeIfExists(vaultPath("main"));
    await removeIfExists(vaultPath("bak"));
    await removeIfExists(vaultPath("tmp"));
    try {
      const entries = await invoke<Array<{ name: string; isDir: boolean }>>("fs_list_dir", {
        dir: `${cachedDir}/${BACKUP_DIR}`,
      });
      for (const e of entries) {
        if (!e.isDir) await removeIfExists(`${cachedDir}/${BACKUP_DIR}/${e.name}`);
      }
    } catch {
      // backup 目录不存在即忽略
    }
  }
  try {
    localStorage.removeItem(LS_DATA_KEY);
    localStorage.removeItem(LS_BACKUP_KEY);
    localStorage.removeItem(LS_EXPORT_KEY);
  } catch {
    // 非浏览器环境忽略
  }
}
