// 一键发布构建：
//   1. npm run build:plugins               工具与能力包
//   2. tauri build（注入签名私钥）          宿主：Windows 便携 exe + NSIS / macOS .app + .dmg（自动生成 .sig）
//   3. 整理 release/ 产物（命名带版本+平台）
//   4. 同步产物到本地 registry 仓库（toolbox-registry/app/，先 pull 带上另一平台已发布产物）
//   5. 扫描 registry app/ 下同版本各平台产物 → 组装 latest.json（缺平台则该平台暂无更新）
// 运行：npm run dist
// 私钥：.tauri/toolbox.key（密码为空；丢失则无法再发布更新，务必备份）
//
// 多平台发布纪律（详见 CLAUDE.md「分发与更新」）：
//   - 双端版本号必须同步 bump（tauri.conf.json / package.json / src-tauri/Cargo.toml）
//   - 产物命名 ToolBox_<ver>_<platform>_*，各版本共存，绝不覆盖（绕 CDN 缓存）
//   - latest.json 只收「同版本产物已就位」的平台条目 —— 禁止跨版本照抄旧平台条目
//     （旧平台条目 = 新版本号 + 旧平台包 → 该平台客户端无限更新循环，0.2.5 事故）
//   - updater 对缺失平台条目静默跳过（前端 catch → 无更新）
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
const PAGES_BASE = "https://pie-tk.github.io/toolbox-registry/app";
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
console.log("=== 1/5 构建插件与能力包 ===");
run("npm run build:plugins");

/* 2. 宿主（带更新签名） */
const keyPath = path.join(ROOT, ".tauri", "toolbox.key");
const signed = existsSync(keyPath);
if (!signed) {
  console.warn("⚠️  未找到 .tauri/toolbox.key，本次构建不签名（无法发布自更新）");
}
console.log("=== 2/5 构建宿主（前端 + Rust + 打包） ===");
run(
  `npx tauri build --bundles ${BUNDLES}`,
  signed
    ? {
        TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf8"),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
      }
    : {}
);

/* 3. 整理产物（带版本+平台命名） */
console.log("=== 3/5 整理发布产物 ===");
mkdirSync(RELEASE_DIR, { recursive: true });

const copy = (src, dest) => {
  copyFileSync(src, dest);
  console.log(`✔ ${path.relative(ROOT, dest)}  (${(statSync(dest).size / 1024 / 1024).toFixed(2)} MB)`);
};

const version = JSON.parse(
  readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
).version;

// 本平台产物文件名（registry app/ 与 release/ 一致），同步段使用
const outputs = [];

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

  const destName = `ToolBox_${version}_windows-x86_64-setup.exe`;
  const setupSrc = path.join(NSIS_DIR, setupName);
  copy(setupSrc, path.join(RELEASE_DIR, destName));
  outputs.push(destName);

  const sigSrc = setupSrc + ".sig";
  if (signed && existsSync(sigSrc)) {
    copyFileSync(sigSrc, path.join(RELEASE_DIR, destName + ".sig"));
    console.log(`✔ release/${destName}.sig`);
    outputs.push(destName + ".sig");
  }
} else {
  const MACOS_DIR = path.join(TARGET_DIR, "bundle", "macos");

  // 更新器产物：.app.tar.gz + .sig（createUpdaterArtifacts 生成于 bundle/macos/）
  const appTar = path.join(MACOS_DIR, "ToolBox.app.tar.gz");
  if (!existsSync(appTar)) {
    console.error(`✗ 未找到更新器产物 ${appTar}`);
    process.exit(1);
  }
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const tarName = `ToolBox_${version}_darwin-${arch}.app.tar.gz`;
  copy(appTar, path.join(RELEASE_DIR, tarName));
  outputs.push(tarName);

  const sigSrc = appTar + ".sig";
  if (signed && existsSync(sigSrc)) {
    copyFileSync(sigSrc, path.join(RELEASE_DIR, tarName + ".sig"));
    console.log(`✔ release/${tarName}.sig`);
    outputs.push(tarName + ".sig");
  }

  // 手动安装包：hdiutil 直接制作 .dmg（功能与 Tauri 产物等价，无窗口美化）。
  // dmg 只供手动下载、不进 latest.json 扫描，文件名用人类友好的 macOS。
  const dmgName = `ToolBox_${version}_macOS.dmg`;
  const dmgDest = path.join(RELEASE_DIR, dmgName);
  const r = spawnSync(
    "hdiutil",
    ["create", "-volname", "ToolBox", "-srcfolder", path.join(MACOS_DIR, "ToolBox.app"),
     "-format", "UDZO", "-ov", dmgDest],
    { stdio: "inherit" }
  );
  if (r.status === 0) {
    console.log(`✔ release/${dmgName}  (${(statSync(dmgDest).size / 1024 / 1024).toFixed(2)} MB)`);
    outputs.push(dmgName);
  } else {
    console.warn("⚠️  hdiutil 制作 dmg 失败（不影响自更新发布）");
  }
}

/* 4. 同步产物到 registry（先 pull，带上另一平台已 push 的产物） */
const appDir = path.join(REGISTRY_DIR, "app");
if (!existsSync(REGISTRY_DIR)) {
  console.log("（未找到 ../toolbox-registry，跳过同步与 latest.json 组装）");
} else {
  console.log("=== 4/5 同步产物到 toolbox-registry/app/ ===");
  // github 通道可能间歇失败:重试几次;持续失败仅警告(本地扫描仍可用,但可能缺另一平台的新产物)
  let pulled = false;
  for (let i = 1; i <= 3 && !pulled; i++) {
    const r = spawnSync("git", ["-C", REGISTRY_DIR, "pull", "--ff-only"], { encoding: "utf8" });
    if (r.status === 0) pulled = true;
    else console.warn(`⚠️  registry pull 第 ${i} 次失败（另一平台新产物可能未取到）`);
  }
  mkdirSync(appDir, { recursive: true });
  for (const f of outputs) {
    copyFileSync(path.join(RELEASE_DIR, f), path.join(appDir, f));
    console.log(`✔ ../toolbox-registry/app/${f}`);
  }

  /* 5. latest.json：扫描同版本产物组装（禁止跨版本照抄旧平台条目） */
  console.log("=== 5/5 组装 latest.json（扫描同版本产物） ===");
  const platforms = {};
  for (const f of readdirSync(appDir)) {
    // ToolBox_<ver>_<platform>_<kind>.sig → 平台条目
    const m = f.match(new RegExp(`^ToolBox_${version.replace(/\./g, "\\.")}_(windows-x86_64-setup\\.exe|darwin-(aarch64|x86_64)\\.app\\.tar\\.gz)\\.sig$`));
    if (!m) continue;
    const pkgName = f.replace(/\.sig$/, "");
    if (!existsSync(path.join(appDir, pkgName))) continue;
    const platformKey = m[1].startsWith("windows") ? "windows-x86_64" : `darwin-${m[2]}`;
    platforms[platformKey] = {
      signature: readFileSync(path.join(appDir, f), "utf8"),
      url: `${PAGES_BASE}/${pkgName}`,
    };
  }
  if (!signed || Object.keys(platforms).length === 0) {
    console.warn("⚠️  无任何平台签名产物，latest.json 未生成");
  } else {
    for (const expect of ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"]) {
      if (!platforms[expect]) console.warn(`⚠️  ${expect} 侧尚未发布 ${version}，该平台客户端将暂无更新`);
    }
    const latest = {
      version,
      notes: `ToolBox v${version}`,
      pub_date: new Date().toISOString(),
      platforms,
    };
    const text = JSON.stringify(latest, null, 2);
    writeFileSync(path.join(RELEASE_DIR, "latest.json"), text);
    writeFileSync(path.join(appDir, "latest.json"), text);
    console.log(`✔ latest.json  (v${version}, platforms: ${Object.keys(platforms).join(", ")})`);
    console.log("推送 toolbox-registry 后，更新即对已列平台客户端生效。");
  }
}
