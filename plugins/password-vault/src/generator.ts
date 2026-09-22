// 密码生成器：getRandomValues 拒绝采样（无模偏差），保证每个勾选类至少 1 字符。
// 纯逻辑模块：不得 import Tauri / DOM 副作用。
import type { GenOptions } from "./types";

const SET_LOWER = "abcdefghijklmnopqrstuvwxyz";
const SET_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SET_DIGITS = "0123456789";
const SET_SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/~";

/** 字节流拒绝采样 RNG：mod 偏差区间直接丢弃，用完自动补随机字节。 */
function makeRng(): (maxExclusive: number) => number {
  const buf = new Uint8Array(256);
  let idx = buf.length;
  return (maxExclusive: number) => {
    if (maxExclusive <= 1) return 0;
    const limit = Math.floor(256 / maxExclusive) * maxExclusive;
    for (;;) {
      if (idx >= buf.length) {
        globalThis.crypto.getRandomValues(buf);
        idx = 0;
      }
      const v = buf[idx++];
      if (v < limit) return v % maxExclusive;
    }
  };
}

export function generatePassword(opts: GenOptions): string {
  const pools: string[] = [];
  if (opts.lower) pools.push(SET_LOWER);
  if (opts.upper) pools.push(SET_UPPER);
  if (opts.digits) pools.push(SET_DIGITS);
  if (opts.symbols) pools.push(SET_SYMBOLS);
  if (pools.length === 0) pools.push(SET_LOWER); // 全不勾时兜底小写
  const all = pools.join("");
  const len = Math.max(4, Math.min(128, Math.floor(opts.length) || 16));
  const rng = makeRng();

  // 每类先保证 1 个，再从全集中补齐
  const chars: string[] = pools.map((p) => p[rng(p.length)]);
  while (chars.length < len) chars.push(all[rng(all.length)]);

  // Fisher–Yates 洗牌，避免"前几位总是各类代表字符"的固定模式
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    const t = chars[i];
    chars[i] = chars[j];
    chars[j] = t;
  }
  return chars.join("");
}

export interface StrengthInfo {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** 熵估计（bit）：长度 × log2(字符池大小)。 */
  entropyBits: number;
}

const STRENGTH_LABELS = ["很弱", "弱", "一般", "强", "极强"] as const;

/** 熵估计式强度评估（信息性提示，不作硬性拦截）。 */
export function passwordStrength(pw: string): StrengthInfo {
  if (!pw) return { score: 0, label: STRENGTH_LABELS[0], entropyBits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const entropyBits = pw.length * Math.log2(Math.max(pool, 2));
  let score: 0 | 1 | 2 | 3 | 4;
  if (entropyBits < 28) score = 0;
  else if (entropyBits < 36) score = 1;
  else if (entropyBits < 60) score = 2;
  else if (entropyBits < 100) score = 3;
  else score = 4;
  if (pw.length < 8 && score > 1) score = 1; // 过短一律压到"弱"档
  return { score, label: STRENGTH_LABELS[score], entropyBits: Math.round(entropyBits) };
}
