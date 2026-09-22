// 密码保险库：共享类型定义。
// 纯类型模块：不得 import Tauri / DOM 副作用（smoke.mts 在 node 下直接引用）。

/** 一条凭据（网站或应用）。 */
export interface VaultEntry {
  id: string;
  /** 显示名称（站点/应用名）。 */
  name: string;
  /** 网站（web）还是应用（app）。 */
  kind: "web" | "app";
  /** web 类型通常有值；app 可为空串。 */
  url: string;
  username: string;
  password: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

/** 落盘文件的外层（明文）KDF 参数。 */
export interface VaultKdf {
  algo: "PBKDF2-SHA256";
  iterations: number;
  /** base64(16B)。 */
  salt: string;
}

/** 落盘文件的外层（明文）密文参数。 */
export interface VaultCipher {
  algo: "AES-256-GCM";
  /** base64(12B)。 */
  iv: string;
  /** base64。 */
  ct: string;
}

/** vault.json 的完整外层结构（JSON 明文，内容加密）。 */
export interface VaultFile {
  schemaVersion: number;
  kdf: VaultKdf;
  cipher: VaultCipher;
  /** 未加密元数据：锁定页展示用（见安全说明）。 */
  entryCount: number;
  updatedAt: number;
}

/** cipher.ct 解开后的明文 payload。 */
export interface VaultPayload {
  schemaVersion: number;
  entries: VaultEntry[];
}

export type VaultStatus = "booting" | "no-vault" | "locked" | "unlocked";
export type VaultView = "list" | "form" | "import" | "settings";

/** 非敏感设置（localStorage，不进加密库）。 */
export interface VaultSettings {
  /** 闲置自动锁定分钟数；0 = 永不。 */
  autoLockMinutes: number;
  /** 复制密码后自动清剪贴板秒数；0 = 不清。 */
  clipboardClearSec: number;
  /** 切出工具页立即锁定。 */
  lockOnLeave: boolean;
}

/** 密码生成器选项。 */
export interface GenOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

/** 浏览器 CSV 导入的一行（导入后再补 id/时间戳/kind）。 */
export interface ImportedEntry {
  name: string;
  url: string;
  username: string;
  password: string;
  note: string;
}
