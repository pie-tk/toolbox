// 站点匹配 / 去重键 / 搜索过滤 / 备份合并。
// 纯逻辑模块：不得 import Tauri / DOM 副作用。
import type { ImportedEntry, VaultEntry } from "./types";

/** URL → 规范化主机名：补协议、小写、去 www. 前缀；解析失败返回原串小写。 */
export function normalizeHost(url: string): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  let u: URL;
  try {
    const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    u = new URL(withProto);
  } catch {
    return raw.toLowerCase();
  }
  const host = u.hostname.toLowerCase();
  if (!host) return raw.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** 去重键：同站点（主机名）+ 同账号视为同一条；无 URL 的应用退化为名称。 */
export function dupKey(e: Pick<VaultEntry, "name" | "url" | "username">): string {
  const host = normalizeHost(e.url);
  if (host) return `${host}|${e.username.trim().toLowerCase()}`;
  return `name:${e.name.trim().toLowerCase()}`;
}

/** 表单"该网站已有记录"提示：URL 主机名匹配或名称全等（保守，不做包含匹配）。 */
export function findSimilar(
  entries: VaultEntry[],
  opts: { host?: string; nameKey?: string; excludeId?: string | null },
): VaultEntry[] {
  const host = (opts.host ?? "").trim();
  const nameKey = (opts.nameKey ?? "").trim().toLowerCase();
  if (!host && !nameKey) return [];
  return entries.filter((e) => {
    if (opts.excludeId && e.id === opts.excludeId) return false;
    if (host && normalizeHost(e.url) === host) return true;
    if (nameKey && e.name.trim().toLowerCase() === nameKey) return true;
    return false;
  });
}

/** 搜索：空白分词，全部命中才算匹配；只搜 name/url/username/note，不搜 password。 */
export function filterEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return entries;
  return entries.filter((e) => {
    const hay = `${e.name}\n${e.url}\n${e.username}\n${e.note}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export interface ImportClassification {
  /** 与现有库及导入集内部都不重复的行。 */
  fresh: ImportedEntry[];
  /** 与现有库同键的行（可勾选覆盖）。 */
  dups: Array<{ existing: VaultEntry; incoming: ImportedEntry }>;
}

/** 导入分类：与现有库比对 + 导入集内部去重（同键后行覆盖前行）。 */
export function classifyImport(
  existing: VaultEntry[],
  incoming: ImportedEntry[],
): ImportClassification {
  const existingByKey = new Map<string, VaultEntry>();
  for (const e of existing) existingByKey.set(dupKey(e), e);

  const fresh: ImportedEntry[] = [];
  const dups: Array<{ existing: VaultEntry; incoming: ImportedEntry }> = [];
  const seen = new Set<string>();
  for (const item of incoming) {
    const key = dupKey(item);
    if (seen.has(key)) {
      // 导入集内部同键：后行胜出——撤销上一个决定，按后行重新归类
      const fIdx = fresh.findIndex((x) => dupKey(x) === key);
      if (fIdx >= 0) fresh.splice(fIdx, 1);
      const dIdx = dups.findIndex((d) => dupKey(d.incoming) === key);
      if (dIdx >= 0) dups.splice(dIdx, 1);
    }
    seen.add(key);
    const hit = existingByKey.get(key);
    if (hit) dups.push({ existing: hit, incoming: item });
    else fresh.push(item);
  }
  return { fresh, dups };
}

export interface MergeResult {
  merged: VaultEntry[];
  added: number;
  /** 以导入（较新）数据替换了现有条目。 */
  updated: number;
  /** 现有条目较新，导入被忽略。 */
  keptCurrent: number;
}

/** 备份合并：同键保留 updatedAt 较新者；不同键并入。 */
export function mergeDedup(current: VaultEntry[], incoming: VaultEntry[]): MergeResult {
  const byKey = new Map<string, VaultEntry>();
  for (const e of current) byKey.set(dupKey(e), e);
  let added = 0;
  let updated = 0;
  let keptCurrent = 0;
  for (const inc of incoming) {
    const key = dupKey(inc);
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, inc);
      added++;
      continue;
    }
    if (inc.updatedAt > cur.updatedAt) {
      byKey.set(key, inc);
      updated++;
    } else {
      keptCurrent++;
    }
  }
  const merged = Array.from(byKey.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  return { merged, added, updated, keptCurrent };
}
