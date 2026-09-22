// CSV 解析 / 序列化与浏览器密码导出格式适配。
// 纯逻辑模块：不得 import Tauri / DOM 副作用。
// Chrome/Edge 导出格式（表头 name,url,username,password[,note,...]）；
// 密码字段可能含逗号/引号/换行，必须走完整状态机而非 split(",")。
import type { ImportedEntry } from "./types";

export interface CsvParseResult {
  rows: string[][];
  warnings: string[];
}

export function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** RFC 4180 风格状态机：引号内逗号/换行合法、"" 转义、\r\n|\n|\r 行界。 */
export function parseCsv(text: string): CsvParseResult {
  const s = stripBom(text);
  const rows: string[][] = [];
  const warnings: string[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      i++;
      endRow();
      continue;
    }
    field += c;
    i++;
  }
  if (inQuotes) warnings.push("文件存在未闭合的引号，最后一行可能不完整");
  if (field !== "" || row.length > 0) endRow();

  // 剔除全空行（Excel 导出常见尾随空行）
  const clean = rows.filter((r) => !r.every((f) => f.trim() === ""));
  return { rows: clean, warnings };
}

export interface BrowserExportResult {
  entries: ImportedEntry[];
  skipped: Array<{ line: number; reason: string }>;
}

/** 表头驱动的浏览器密码导出解析。非浏览器导出格式抛 Error（中文提示）。 */
export function parseBrowserExport(rows: string[][]): BrowserExportResult {
  if (rows.length === 0) throw new Error("文件是空的");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string): number => header.indexOf(name);
  const iName = idx("name");
  const iUrl = idx("url");
  const iUser = idx("username");
  const iPass = idx("password");
  const iNote = idx("note");
  if (iUser < 0 || iPass < 0) {
    throw new Error("缺少 username / password 列，看起来不是浏览器导出的密码 CSV");
  }

  const entries: ImportedEntry[] = [];
  const skipped: Array<{ line: number; reason: string }> = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (i: number): string => (i >= 0 && i < row.length ? row[i].trim() : "");
    const name = get(iName);
    const url = get(iUrl);
    const username = get(iUser);
    const password = get(iPass);
    const note = get(iNote);
    if (!username && !password) {
      skipped.push({ line: r + 1, reason: "账号与密码均为空" });
      continue;
    }
    if (!password) {
      skipped.push({ line: r + 1, reason: "密码为空" });
      continue;
    }
    if (!username) {
      skipped.push({ line: r + 1, reason: "账号为空" });
      continue;
    }
    if (!name && !url) {
      skipped.push({ line: r + 1, reason: "缺少名称与网址，无法归类" });
      continue;
    }
    entries.push({ name: name || url, url, username, password, note });
  }
  if (entries.length === 0) {
    throw new Error("没有解析到任何有效凭据行");
  }
  return { entries, skipped };
}

/** 明文导出 CSV：BOM + 全字段双引号 + CRLF；防公式注入（= + - @ 开头前缀 '）。 */
export function toCsv(rows: string[][]): string {
  const esc = (v: string): string => {
    const x = v ?? "";
    const guarded = /^[=+\-@\t\r]/.test(x) ? `'${x}` : x;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}
