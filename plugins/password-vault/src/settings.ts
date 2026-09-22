// 非敏感设置（自动锁定时长等）：localStorage 持久化，schemaVersion + 迁移。
// 敏感数据绝不存这里（一律进加密库）。仿 glm-key-test 的存储模式。
import type { VaultSettings } from "./types";

const LS_KEY = "toolbox-password-vault-settings";
const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
  clipboardClearSec: 20,
  lockOnLeave: true,
};

const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 60];
const CLIPBOARD_CHOICES = [0, 10, 20, 60];

function clampChoice(v: unknown, choices: number[], fallback: number): number {
  return typeof v === "number" && choices.includes(v) ? v : fallback;
}

export function loadSettings(): VaultSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VaultSettings> & { schemaVersion?: number };
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      // 未来版本迁移点；未知版本 → 回默认（设置项均为低敏感，可接受）
      return { ...DEFAULT_SETTINGS };
    }
    return {
      autoLockMinutes: clampChoice(parsed.autoLockMinutes, AUTO_LOCK_CHOICES, DEFAULT_SETTINGS.autoLockMinutes),
      clipboardClearSec: clampChoice(parsed.clipboardClearSec, CLIPBOARD_CHOICES, DEFAULT_SETTINGS.clipboardClearSec),
      lockOnLeave: typeof parsed.lockOnLeave === "boolean" ? parsed.lockOnLeave : DEFAULT_SETTINGS.lockOnLeave,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: VaultSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...s }));
  } catch {
    // localStorage 不可用（配额/隐私模式）→ 静默，本次会话仍生效
  }
}

export const AUTO_LOCK_CHOICES_READONLY = AUTO_LOCK_CHOICES;
export const CLIPBOARD_CHOICES_READONLY = CLIPBOARD_CHOICES;
