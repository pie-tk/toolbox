// 密码保险库 · 纯逻辑冒烟测试（crypto / generator / csv / match）。
// 运行（仓库根目录）：
//   npx esbuild plugins/password-vault/smoke.mts --bundle --platform=node \
//     --format=cjs --outfile=.pv-smoke.cjs && node .pv-smoke.cjs
// 仅测无 Tauri/DOM 依赖的模块（node ≥19 自带全局 crypto.subtle / btoa / TextEncoder）。
import {
  PBKDF2_ITERATIONS,
  decryptBytes,
  deriveKey,
  encryptBytes,
  fromB64,
  isVaultFile,
  openVault,
  parseVaultFile,
  randomBytes,
  sealVault,
  toB64,
  uuid,
  VaultFileError,
  WrongPasswordError,
} from "./src/crypto";
import { generatePassword, passwordStrength } from "./src/generator";
import { parseBrowserExport, parseCsv, stripBom, toCsv } from "./src/csv";
import { classifyImport, dupKey, filterEntries, findSimilar, mergeDedup, normalizeHost } from "./src/match";
import type { VaultEntry } from "./src/types";

/* ---- 极简断言 ---- */
let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, name: string): void {
  if (cond) passed++;
  else failures.push(name);
}

function throws(fn: () => unknown, name: string): void {
  try {
    void fn();
    failures.push(`${name}（未抛出异常）`);
  } catch {
    passed++;
  }
}

async function throwsAsync(fn: () => Promise<unknown>, name: string): Promise<void> {
  try {
    await fn();
    failures.push(`${name}（未抛出异常）`);
  } catch {
    passed++;
  }
}

const entry = (over: Partial<VaultEntry>): VaultEntry => ({
  id: uuid(),
  name: "x",
  kind: "web",
  url: "",
  username: "u",
  password: "p",
  note: "",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

async function main(): Promise<void> {
  /* ---- crypto：编码 / UUID ---- */
  ok(stripBom("﻿abc") === "abc", "stripBom");

  const big = randomBytes(100_000); // > 0x8000 分块路径
  ok(toB64(big).length > 0 && fromB64(toB64(big)).length === big.length, "toB64/fromB64 大缓冲往返");
  ok(fromB64(toB64(new Uint8Array([0, 1, 2, 254, 255]))).join() === "0,1,2,254,255", "b64 字节往返");
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid()), "uuid v4 格式");

  /* ---- crypto：加解密与 vault 文件 ---- */
  const salt = randomBytes(16);
  const key = await deriveKey("correct horse battery staple", salt, PBKDF2_ITERATIONS);
  const { iv, ct } = await encryptBytes(key, new TextEncoder().encode("秘密秘密"));
  ok(new TextDecoder().decode(await decryptBytes(key, iv, ct)) === "秘密秘密", "AES-GCM 往返（含多字节 UTF-8）");

  const ctBad = new Uint8Array(ct);
  ctBad[0] ^= 0xff; // 篡改密文
  await throwsAsync(() => decryptBytes(key, iv, ctBad), "篡改密文 → 认证失败");
  const wrongKey = await deriveKey("wrong password", salt, PBKDF2_ITERATIONS);
  await throwsAsync(() => decryptBytes(wrongKey, iv, ct), "错误密钥 → WrongPasswordError");

  const entries = [
    entry({ id: "a", name: "GitHub", url: "https://github.com/login", username: "me@example.com", password: "p@ss,with\"quotes\"" }),
    entry({ id: "b", kind: "app", name: "微信", url: "", username: "wx_user", password: "中文密码123" }),
  ];
  const file = await sealVault(key, { schemaVersion: 1, entries }, { salt, iterations: PBKDF2_ITERATIONS });
  ok(file.entryCount === 2 && file.kdf.iterations === PBKDF2_ITERATIONS, "sealVault 外层元数据");
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  ok(isVaultFile(bytes), "isVaultFile 识别");
  const opened = await openVault(key, parseVaultFile(bytes));
  ok(opened.payload.entries.length === 2 && opened.payload.entries[0].password === "p@ss,with\"quotes\"", "openVault 往返");
  await throwsAsync(() => openVault(wrongKey, parseVaultFile(bytes)), "openVault 错误密码");
  ok(!isVaultFile(new TextEncoder().encode("{\"hello\":1}")), "isVaultFile 拒绝非库 JSON");

  const corrupt = new Uint8Array(bytes);
  corrupt[10] ^= 0xff; // 破坏外层 JSON
  throws(() => parseVaultFile(corrupt), "损坏 JSON → VaultFileError");
  throws(
    () => parseVaultFile(new TextEncoder().encode(JSON.stringify({ ...file, schemaVersion: 99 }))),
    "未来版本 → VaultFileError",
  );
  const openedDropped = await openVault(key, parseVaultFile(bytes));
  ok(openedDropped.dropped === 0, "正常 payload 无丢弃");
  const loosePayload = await sealVault(key, { schemaVersion: 1, entries: [...entries, null as unknown as VaultEntry] }, { salt, iterations: PBKDF2_ITERATIONS });
  const openedLoose = await openVault(key, loosePayload);
  ok(openedLoose.dropped === 1 && openedLoose.payload.entries.length === 2, "坏条目被 sanitize 剔除");

  /* ---- generator ---- */
  const pw = generatePassword({ length: 20, lower: true, upper: true, digits: true, symbols: true });
  ok(pw.length === 20, "生成长度");
  ok(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^a-zA-Z0-9]/.test(pw), "四类字符齐全");
  const pw2 = generatePassword({ length: 12, lower: true, upper: false, digits: false, symbols: false });
  ok(/^[a-z]{12}$/.test(pw2), "仅小写集合约束");
  ok(generatePassword({ length: 500, lower: true, upper: true, digits: true, symbols: true }).length === 128, "长度上限 128");
  ok(passwordStrength("abc").score <= 1 && passwordStrength("Tr0ub4dor&3-Correct-Horse!x").score >= 3, "强度分档");

  /* ---- csv ---- */
  const csvText = "﻿name,url,username,password,note\r\n" +
    "\"GitHub, Inc\",\"https://github.com\",\"me@x.com\",\"p,with\"\"q\"\"\",\"line1\nline2\"\r\n" +
    "微信,,wx_user,中文密码123,\r\n" +
    "只有名字,,,\r\n" +
    ",,,, \r\n";
  const parsed = parseCsv(csvText);
  ok(parsed.rows.length === 4, "CSV 行数（剔除全空行，保留缺字段行）");
  ok(parsed.rows[1][3] === "p,with\"q\"", "CSV 引号内逗号与转义引号");
  ok(parsed.rows[1][4] === "line1\nline2", "CSV 引号内换行");
  const browser = parseBrowserExport(parsed.rows);
  ok(browser.entries.length === 2 && browser.skipped.length === 1, "浏览器导出解析 + 空行跳过");
  ok(browser.entries[0].name === "GitHub, Inc" && browser.entries[1].name === "微信", "导入字段映射");
  throws(() => parseBrowserExport([["foo", "bar"], ["a", "b"]]), "缺 username/password 列报错");

  const out = toCsv([["name", "url"], ["=HYPERLINK(1)", "a\"b"]]);
  ok(out.charCodeAt(0) === 0xfeff && out.includes("\"'=HYPERLINK(1)\""), "导出 BOM + 公式注入防护");
  ok(parseCsv(out).rows[1][1] === "a\"b", "导出可被自身解析器往返");

  /* ---- match ---- */
  ok(normalizeHost("https://WWW.Example.com/path") === "example.com", "normalizeHost 去 www/小写/去路径");
  ok(normalizeHost("example.com") === "example.com", "normalizeHost 补协议");
  ok(normalizeHost("https://192.168.1.5:8080") === "192.168.1.5", "normalizeHost IP+端口");
  ok(normalizeHost("") === "", "normalizeHost 空串");

  ok(dupKey({ name: "n", url: "https://www.a.com", username: "U@x.com" }) === dupKey({ name: "m", url: "a.com/x", username: "u@x.com" }), "dupKey 归一化等价");
  ok(dupKey({ name: "App", url: "", username: "" }) === dupKey({ name: "app", url: "", username: "" }), "dupKey 应用退化为名称");

  const libs = [
    entry({ name: "GitHub", url: "https://github.com", username: "a@x.com" }),
    entry({ name: "GitLab", url: "https://gitlab.com", username: "b@x.com" }),
    entry({ name: "App1", kind: "app", url: "", username: "c" }),
  ];
  const sim = findSimilar(libs, { host: normalizeHost("github.com/login") });
  ok(sim.length === 1 && sim[0].name === "GitHub", "findSimilar 主机名匹配");
  ok(findSimilar(libs, { nameKey: "app1" }).length === 1, "findSimilar 名称全等");
  ok(filterEntries(libs, "git a@x").length === 1, "filterEntries 多词 AND");
  ok(filterEntries([entry({ name: "n", password: "zzz" })], "zzz").length === 0, "搜索不含密码字段");

  const existing = [entry({ name: "GitHub", url: "https://github.com", username: "a@x.com", password: "old" })];
  const incoming = [
    { name: "GitHub", url: "https://github.com", username: "a@x.com", password: "new1", note: "" },
    { name: "GitHub", url: "https://github.com", username: "a@x.com", password: "new2", note: "" }, // 集内重复：后行胜
    { name: "New", url: "https://new.com", username: "n", password: "p", note: "" },
  ];
  const cls = classifyImport(existing, incoming);
  ok(cls.fresh.length === 1 && cls.fresh[0].name === "New", "导入分类：新增");
  ok(cls.dups.length === 1 && cls.dups[0].incoming.password === "new2", "导入分类：集内去重后行胜");

  const merged = mergeDedup(
    [entry({ id: "cur", name: "A", url: "https://a.com", username: "u", updatedAt: 100 })],
    [entry({ id: "inc", name: "A2", url: "a.com", username: "u", updatedAt: 200 })],
  );
  ok(merged.updated === 1 && merged.merged.find((e) => e.name === "A2") !== undefined, "合并：同键取较新");
  const mergedKeep = mergeDedup(
    [entry({ id: "cur", name: "A", url: "https://a.com", username: "u", updatedAt: 300 })],
    [entry({ id: "inc", name: "A2", url: "a.com", username: "u", updatedAt: 200 })],
  );
  ok(mergedKeep.keptCurrent === 1 && mergedKeep.merged[0].name === "A", "合并：现有较新则保留");

  /* ---- 汇总 ---- */
  if (failures.length > 0) {
    console.error(`✘ 冒烟失败 ${failures.length} 项：`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`✔ 密码保险库冒烟通过（${passed} 项断言）`);
}

void main().catch((e: unknown) => {
  console.error("冒烟执行异常：", e);
  process.exit(1);
});
