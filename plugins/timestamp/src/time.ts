/** 时间格式化与解析工具函数。 */

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** 本地时间 YYYY-MM-DD HH:mm:ss[.SSS] */
export function formatLocal(d: Date, opts?: { ms?: boolean }): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return opts?.ms ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
}

/** UTC 时间 YYYY-MM-DD HH:mm:ss[.SSS] */
export function formatUtc(d: Date, opts?: { ms?: boolean }): string {
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return opts?.ms ? `${base}.${pad(d.getUTCMilliseconds(), 3)}` : base;
}

export function toIso(d: Date): string {
  return d.toISOString();
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function dayOfWeekCN(d: Date): string {
  return `星期${WEEKDAYS[d.getDay()]}`;
}

export function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86400000) + 1;
}

/** 中文相对时间，如「3 分钟前」「2 天后」。 */
export function relativeTime(d: Date, now = Date.now()): string {
  const diff = now - d.getTime();
  const past = diff >= 0;
  const s = Math.abs(diff) / 1000;
  let text: string;
  if (s < 10) return "刚刚";
  if (s < 60) text = `${Math.floor(s)} 秒`;
  else if (s < 3600) text = `${Math.floor(s / 60)} 分钟`;
  else if (s < 86400) text = `${Math.floor(s / 3600)} 小时`;
  else if (s < 86400 * 30) text = `${Math.floor(s / 86400)} 天`;
  else if (s < 86400 * 365) text = `${Math.floor(s / (86400 * 30))} 个月`;
  else text = `${Math.floor(s / (86400 * 365))} 年`;
  return past ? `${text}前` : `${text}后`;
}

export type TimestampUnit = "s" | "ms" | "µs" | "date";

export const UNIT_LABELS: Record<TimestampUnit, string> = {
  s: "秒级",
  ms: "毫秒级",
  "µs": "微秒级",
  date: "日期字符串",
};

export type TimestampParse =
  | { ok: true; date: Date; unit: TimestampUnit }
  | { ok: false; error: string };

/**
 * 宽松解析用户输入：Unix 时间戳（秒/毫秒/微秒，按量级自动识别）、
 * ISO 8601、或 "2026-08-26 14:30:00" 风格的本地时间字符串。
 * 返回 null 表示输入为空。
 */
export function parseTimestampInput(raw: string): TimestampParse | null {
  const t = raw.trim();
  if (!t) return null;

  if (/^-?\d+$/.test(t)) {
    const v = Number(t);
    const abs = Math.abs(v);
    let ms: number;
    let unit: TimestampUnit;
    if (abs >= 1e14) {
      ms = v / 1e3;
      unit = "µs";
    } else if (abs >= 1e11) {
      ms = v;
      unit = "ms";
    } else {
      ms = v * 1e3;
      unit = "s";
    }
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: "数值超出可表示的时间范围" };
    }
    return { ok: true, date, unit };
  }

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(t);
  const normalized = hasZone || t.includes("T") ? t : t.replace(" ", "T");
  const time = Date.parse(normalized);
  if (Number.isNaN(time)) {
    return {
      ok: false,
      error: "无法识别：支持 Unix 时间戳（秒/毫秒/微秒）、2026-08-26 14:30:00 或 ISO 8601",
    };
  }
  return { ok: true, date: new Date(time), unit: "date" };
}

/** Date → datetime-local 输入框的值（YYYY-MM-DDTHH:mm，本地时区）。 */
export function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
