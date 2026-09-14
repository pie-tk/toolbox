// 一键发布构建：
//   1. npm run build:plugins               工具与能力包
//   2. tauri build（注入签名私钥）          宿主：Windows 便携 exe + NSIS / macOS .app + .dmg（自动生成 .sig）
//   3. 整理 release/ 产物 + 生成 latest.json（自更新清单，跨平台条目合并）
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
const REGISTRY_DIR = path.resolve(ROOT, "..", "toolbox-registry");
const IS_WIN = process.platform === "win32";
// 按平台产出：Windows 保持只出 NSIS（历史行为）；macOS 只 bundle .app，
// .dmg 由下方 hdiutil 直接制作——Tauri 的 bundle_dmg.sh 依赖 Finder AppleScript，
// 在无 GUI 交互的进程（后台/CI）会因自动化权限失败。
const BUNDLES = IS_WIN ? "nsis" : "app";

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
console.log("=== 2/4 构建宿主（前端 + Rust + 打包） ===");
run(
  `npx tauri build --bundles ${BUNDLES}`,
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

const version = JSON.parse(
  readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
).version;

// 本平台在 latest.json 中的条目，由各平台分支填充
let platformKey = null;
let platformEntry = null;

if (IS_WIN) {
  const NSIS_DIR = path.join(TARGET_DIR, "bundle", "nsis");
  copy(path.join(TARGET_DIR, "ToolBox.exe"), path.join(RELEASE_DIR, "ToolBox.exe"));

  // NSIS 目录可能积累多个历史版本的 *-setup.exe(目录序不确定),
  // 必须按当前版本号精确匹配,匹配不到再取 mtime 最新的一个。
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
    console.log("✔ release/ToolBox-setup.exe.sig");
    platformKey = "windows-x86_64";
    platformEntry = {
      signature: readFileSync(sigSrc, "utf8"),
      url: "https://pie-tk.github.io/toolbox-registry/app/ToolBox-setup.exe",
    };
  }
} else {
  const MACOS_DIR = path.join(TARGET_DIR, "bundle", "macos");

  // 更新器产物：.app.tar.gz + .sig（createUpdaterArtifacts 生成于 bundle/macos/）
  const appTar = path.join(MACOS_DIR, "ToolBox.app.tar.gz");
  if (!existsSync(appTar)) {
    console.error(`✗ 未找到更新器产物 ${appTar}`);
    process.exit(1);
  }
  copy(appTar, path.join(RELEASE_DIR, "ToolBox.app.tar.gz"));

  const sigSrc = appTar + ".sig";
  if (signed && existsSync(sigSrc)) {
    copyFileSync(sigSrc, path.join(RELEASE_DIR, "ToolBox.app.tar.gz.sig"));
    console.log("✔ release/ToolBox.app.tar.gz.sig");
    const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
    platformKey = `darwin-${arch}`;
    platformEntry = {
      signature: readFileSync(sigSrc, "utf8"),
      url: "https://pie-tk.github.io/toolbox-registry/app/ToolBox.app.tar.gz",
    };
  }

  // 手动安装包：hdiutil 直接制作 .dmg（功能与 Tauri 产物等价，无窗口美化）
  const dmgDest = path.join(RELEASE_DIR, "ToolBox-macos.dmg");
  const r = spawnSync(
    "hdiutil",
    ["create", "-volname", "ToolBox", "-srcfolder", path.join(MACOS_DIR, "ToolBox.app"),
     "-format", "UDZO", "-ov", dmgDest],
    { stdio: "inherit" }
  );
  if (r.status !== 0) {
    console.error("✗ hdiutil 制作 dmg 失败");
    process.exit(1);
  }
  console.log(`✔ release/ToolBox-macos.dmg  (${(statSync(dmgDest).size / 1024 / 1024).toFixed(2)} MB)`);
}

/* latest.json：与已发布版本合并，保留其他平台条目（双平台并行发布的唯一正确姿势） */
if (platformEntry) {
  let prev = { platforms: {} };
  let text = null;
  const localLatest = path.join(REGISTRY_DIR, "app", "latest.json");
  if (existsSync(localLatest)) {
    text = readFileSync(localLatest, "utf8");
  } else {
    // 本地没有 registry 仓库时拉线上版本
    const r = spawnSync(
      "curl",
      ["-fsSL", "--connect-timeout", "10", "https://pie-tk.github.io/toolbox-registry/app/latest.json"],
      { encoding: "utf8" }
    );
    if (r.status === 0) text = r.stdout;
  }
  try {
    if (text) prev = JSON.parse(text);
  } catch {
    console.warn("⚠️  已有 latest.json 解析失败，将仅包含本平台条目");
    prev = { platforms: {} };
  }
  if (prev.version && prev.version !== version) {
    console.warn(`⚠️  已发布版本为 ${prev.version}，本次为 ${version}（合并平台条目后覆盖版本号）`);
  }
  const platforms = { ...(prev.platforms ?? {}) };
  platforms[platformKey] = platformEntry;
  const latest = {
    version,
    notes: `ToolBox v${version}`,
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync(path.join(RELEASE_DIR, "latest.json"), JSON.stringify(latest, null, 2));
  console.log(`✔ release/latest.json  (v${version}, platforms: ${Object.keys(platforms).join(", ")})`);
}

/* 4. 同步到本地 registry 仓库（供推送发布） */
if (existsSync(REGISTRY_DIR)) {
  console.log("=== 4/4 同步 app 更新文件到 toolbox-registry/app/ ===");
  const appDir = path.join(REGISTRY_DIR, "app");
  mkdirSync(appDir, { recursive: true });
  const files = [
    "ToolBox-setup.exe",
    "ToolBox-setup.exe.sig",
    "ToolBox-macos.dmg",
    "ToolBox.app.tar.gz",
    "ToolBox.app.tar.gz.sig",
    "latest.json",
  ];
  for (const f of files) {
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
