// 一键发布构建：
//   1. npm run build:plugins               工具与能力包
//   2. tauri build（注入签名私钥）          宿主：便携 exe + NSIS 安装包（自动生成 .sig）
//   3. 整理 release/ 产物 + 生成 latest.json（自更新清单）
//   4. 同步 app 更新文件到本地 registry 仓库（toolbox-registry/app/）
// 运行：npm run dist
// 私钥：.tauri/toolbox.key（密码为空；丢失则无法再发布更新，务必备份）
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_DIR = path.join(ROOT, "release");
const TARGET_DIR = path.join(ROOT, "src-tauri", "target", "release");
const NSIS_DIR = path.join(TARGET_DIR, "bundle", "nsis");
const REGISTRY_DIR = path.resolve(ROOT, "..", "toolbox-registry");

const run = (cmd, env = {}) => {
  const r = spawnSync(cmd, { stdio: "inherit", shell: true, cwd: ROOT, env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`✗ 命令失败: ${cmd}`);
    process.exit(1);
  }
};

/* 1. 工具与能力包 */
console.log("=== 1/4 构建插件与能力包 ===");
run("npm run build:plugins");

/* 2. 宿主（带更新签名） */
const keyPath = path.join(ROOT, ".tauri", "toolbox.key");
const signed = existsSync(keyPath);
if (!signed) {
  console.warn("⚠️  未找到 .tauri/toolbox.key，本次构建不签名（无法发布自更新）");
}
console.log("=== 2/4 构建宿主（前端 + Rust + NSIS） ===");
run(
  "npx tauri build",
  signed
    ? {
        TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf8"),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
      }
    : {}
);

/* 3. 整理产物 + latest.json */
console.log("=== 3/4 整理发布产物 ===");
mkdirSync(RELEASE_DIR, { recursive: true });

const copy = (src, dest) => {
  copyFileSync(src, dest);
  console.log(`✔ ${path.relative(ROOT, dest)}  (${(statSync(dest).size / 1024 / 1024).toFixed(2)} MB)`);
};

copy(path.join(TARGET_DIR, "ToolBox.exe"), path.join(RELEASE_DIR, "ToolBox.exe"));

// NSIS 目录可能积累多个历史版本的 *-setup.exe(目录序不确定),
// 必须按当前版本号精确匹配,匹配不到再取 mtime 最新的一个。
const version = JSON.parse(
  readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
).version;
const setupCandidates = readdirSync(NSIS_DIR).filter((f) => f.endsWith("-setup.exe"));
const setupName =
  setupCandidates.find((f) => f === `ToolBox_${version}_x64-setup.exe`) ??
  setupCandidates
    .filter((f) => /^ToolBox_\d+\.\d+\.\d+_x64-setup\.exe$/.test(f))
    .sort((a, b) => statSync(path.join(NSIS_DIR, b)).mtimeMs - statSync(path.join(NSIS_DIR, a)).mtimeMs)[0];
if (!setupName) {
  console.error(`✗ 未在 ${NSIS_DIR} 找到 *-setup.exe`);
  process.exit(1);
}
console.log(`选定安装包: ${setupName}`);
const setupSrc = path.join(NSIS_DIR, setupName);
copy(setupSrc, path.join(RELEASE_DIR, "ToolBox-setup.exe"));

const sigSrc = setupSrc + ".sig";
if (signed && existsSync(sigSrc)) {
  copyFileSync(sigSrc, path.join(RELEASE_DIR, "ToolBox-setup.exe.sig"));
  console.log("✔ release\\ToolBox-setup.exe.sig");
}

if (signed && existsSync(sigSrc)) {
  const signature = readFileSync(sigSrc, "utf8");
  const latest = {
    version,
    notes: `ToolBox v${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: "https://pie-tk.github.io/toolbox-registry/app/ToolBox-setup.exe",
      },
    },
  };
  writeFileSync(path.join(RELEASE_DIR, "latest.json"), JSON.stringify(latest, null, 2));
  console.log(`✔ release\\latest.json  (v${version})`);
}

/* 4. 同步到本地 registry 仓库（供推送发布） */
if (existsSync(REGISTRY_DIR)) {
  console.log("=== 4/4 同步 app 更新文件到 toolbox-registry/app/ ===");
  const appDir = path.join(REGISTRY_DIR, "app");
  mkdirSync(appDir, { recursive: true });
  for (const f of ["ToolBox-setup.exe", "ToolBox-setup.exe.sig", "latest.json"]) {
    const src = path.join(RELEASE_DIR, f);
    if (existsSync(src)) {
      copyFileSync(src, path.join(appDir, f));
      console.log(`✔ ../toolbox-registry/app/${f}`);
    }
  }
  console.log("推送 toolbox-registry 后，更新即对全部客户端生效。");
} else {
  console.log("（未找到 ../toolbox-registry，跳过同步）");
}
