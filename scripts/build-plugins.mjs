// 插件构建管线 v2（工具 + 共享能力）：
//   plugins/<id>/{manifest.json, src/main.tsx}
//     → esbuild 打包 module.js + tailwind style.css → zip
//   capabilities/<id>/{manifest.json, Cargo.toml, src/, bridge.js}
//     → cargo build --target wasm32-unknown-unknown → cap.wasm → zip
//   产出 public/registry.json（schemaVersion 2：tools + capabilities）+ public/plugins/
// 运行：npm run build:plugins
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const CAPS_DIR = path.join(ROOT, "capabilities");
const OUT_DIR = path.join(ROOT, "public", "plugins");

/* ---- 最小 ZIP 写入器（deflate） ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (~c) >>> 0;
}

/** entries: Array<{ name: string, data: Buffer }> → zip Buffer */
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

function packageZip(id, version, entries) {
  const zip = makeZip(entries);
  const zipName = `${id}-${version}.zip`;
  writeFileSync(path.join(OUT_DIR, zipName), zip);
  const sha256 = createHash("sha256").update(zip).digest("hex");
  return {
    manifest: entries[0] ? JSON.parse(entries[0].data.toString("utf8")) : {},
    package: { file: `plugins/${zipName}`, sha256, size: zip.length },
    sizeKb: zip.length / 1024,
  };
}

/* ---- 主流程 ---- */

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

/* 1. 能力（capabilities/<id>）→ wasm */

const capIds = readdirSync(CAPS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const registryCapabilities = [];
for (const id of capIds) {
  const dir = path.join(CAPS_DIR, id);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.id !== id) throw new Error(`能力目录名 ${id} 与 manifest.id 不一致`);

  const stage = path.join(ROOT, "node_modules", ".cache", "toolbox-caps", id);
  mkdirSync(stage, { recursive: true });
  execFileSync(
    "cargo",
    ["build", "--release", "--target", "wasm32-unknown-unknown"],
    { cwd: dir, stdio: "inherit" }
  );
  const wasmPath = path.join(
    dir,
    "target",
    "wasm32-unknown-unknown",
    "release",
    `${id.replace(/-/g, "_")}.wasm`
  );
  copyFileSync(wasmPath, path.join(stage, "cap.wasm"));

  const entry = packageZip(id, manifest.version, [
    { name: "manifest.json", data: readFileSync(path.join(dir, "manifest.json")) },
    { name: "cap.wasm", data: readFileSync(path.join(stage, "cap.wasm")) },
    { name: "bridge.js", data: readFileSync(path.join(dir, "bridge.js")) },
  ]);
  registryCapabilities.push(entry);
  console.log(`✔ 能力 ${id} v${manifest.version} → ${entry.package.file} (${entry.sizeKb.toFixed(1)} KB)`);
}

/* 2. 工具（plugins/<id>）→ module.js + style.css */

const pluginIds = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (pluginIds.length === 0) {
  console.error("plugins/ 下没有插件目录");
  process.exit(1);
}

const registryTools = [];
for (const id of pluginIds) {
  const dir = path.join(PLUGINS_DIR, id);
  const srcDir = path.join(dir, "src");
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (manifest.id !== id) throw new Error(`插件目录名 ${id} 与 manifest.id ${manifest.id} 不一致`);

  const stage = path.join(ROOT, "node_modules", ".cache", "toolbox-plugins", id);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // esbuild：打包为自包含 ESM。
  await build({
    entryPoints: [path.join(srcDir, "main.tsx")],
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: false,
    outfile: path.join(stage, "module.js"),
    jsx: "automatic",
    alias: { "@": srcDir },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "info",
  });

  // tailwind：扫描插件源码生成 style.css。
  const tailwindCli = path.join(ROOT, "node_modules", "tailwindcss", "lib", "cli.js");
  execFileSync(process.execPath, [
    tailwindCli,
    "-c", path.join(PLUGINS_DIR, "tailwind.config.cjs"),
    "-i", path.join(PLUGINS_DIR, "tailwind.base.css"),
    "--content", path.join(srcDir, "**", "*.{ts,tsx}"),
    "-o", path.join(stage, "style.css"),
    "--minify",
  ], { stdio: "inherit" });

  const entry = packageZip(id, manifest.version, [
    { name: "manifest.json", data: readFileSync(path.join(dir, "manifest.json")) },
    { name: "module.js", data: readFileSync(path.join(stage, "module.js")) },
    { name: "style.css", data: readFileSync(path.join(stage, "style.css")) },
  ]);
  registryTools.push(entry);
  const reqs = manifest.requires ? `（依赖: ${Object.keys(manifest.requires).join(", ")}）` : "";
  console.log(`✔ 工具 ${id} v${manifest.version} → ${entry.package.file} (${entry.sizeKb.toFixed(1)} KB)${reqs}`);
}

/* 3. registry v2 */

const registry = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  tools: registryTools.map((e) => ({ manifest: e.manifest, package: e.package })),
  capabilities: registryCapabilities.map((e) => ({ manifest: e.manifest, package: e.package })),
};
writeFileSync(path.join(ROOT, "public", "registry.json"), JSON.stringify(registry, null, 2));
console.log(`✔ registry.json v2（${registryTools.length} 工具 + ${registryCapabilities.length} 能力）`);
