# ToolBox — 项目规则与架构备忘

模块化桌面工具箱：**薄宿主 + 插件市场 + 共享 wasm 能力 + 自更新**。
技术栈：Tauri 2 / React 18 / TypeScript(strict) / Tailwind / Zustand / Rust。

## 核心架构原则（不可违反）

1. **宿主永不膨胀**。图像处理等重能力一律做成共享能力（wasm），不进宿主 Rust。
   宿主只保留：窗口/导航、插件分发（下载/校验/安装）、极薄文件原语、更新器。
   当前宿主 exe ≈13MB；`image`/`rayon`/`lru` 等曾被刻意移出，勿再引入。
2. **工具与能力是外部插件**，源码在仓库内、分发走远程 registry：
   - 工具：`plugins/<id>/manifest.json + src/main.tsx`（esbuild 打包自包含 ESM，导出
     `mount(container, ctx?)` / `unmount()`；不得 import 宿主代码；样式经
     `plugins/tailwind.config.cjs` 编译，引用宿主 CSS 变量 → 自动跟随主题）
   - 能力：`capabilities/<id>/Cargo.toml(wasm32-unknown-unknown) + bridge.js`
     （手写 C ABI：tb_alloc/tb_free/tb_ret_*，见 image-core）
   - 工具 manifest 用 `requires: {"<能力id>": "^1"}` 声明依赖；安装时自动补齐，
     卸载最后一个引用者后自动清理；打开门槛：能力未就绪则禁用，可一键修复
3. **安装位置跟随 exe 所在目录**（便携版/安装目录）：`plugins/`、`capabilities/`、
   `cache/`；目录不可写（如 Program Files 机器级安装）才回退 `%LOCALAPPDATA%\com.toolbox.app`。
   修改见 `src-tauri/src/plugin/service.rs` 的 `exe_dir_if_writable()`。
4. **mipmap-studio 是完整迁移的插件**：原 Rust 后端已删除，扫描/重命名/撤销等全部
   逻辑在插件 `src/lib/ops.ts`（宿主仅提供 `fs_*` 文件原语命令，见
   `src-tauri/src/commands/host_fs.rs`）；缩略图走 image-core 能力。

## 分发与更新（生产链路）

- **registry 仓库**：`pie-tk/toolbox-registry`（GitHub Pages 即时生效：
  `https://pie-tk.github.io/toolbox-registry/`），内含 `registry.json`（schemaVersion 2：
  tools + capabilities）、`plugins/*.zip`、`app/`（应用自更新三件套）。
- **registry 规则**：`package.file` 是相对 registry.json 所在**目录**的路径（如
  `plugins/x.zip`）；客户端强制 SHA-256 校验；HTML 响应直接拒绝（防 SPA fallback 假包）。
- **工具更新**：`npm run build:plugins` → 拷贝 `public/registry.json + public/plugins/*.zip`
  到 registry 仓库 → push。宿主零改动，用户刷新市场即得。
- **应用更新**：三处版本号同步改（`src-tauri/tauri.conf.json`、`package.json`、
  `src-tauri/Cargo.toml`）→ `npm run dist`（自动注入 `.tauri/toolbox.key` 私钥签名，
  产出 setup.exe + .sig + latest.json 并同步到 `../toolbox-registry/app/`）→ push registry
  → `gh release create`（注意 `-R pie-tk/toolbox`，否则会建到 cwd 仓库）。
- **签名私钥** `.tauri/toolbox.key`（密码为空，已 gitignore）。**丢失即永远无法发更新**。
- 更新器端点与公钥配置在 `tauri.conf.json` 的 `plugins.updater`；
  端点 = registry Pages `/app/latest.json`（jsDelivr `@main` 分支缓存更新过慢，勿用）。

## 常用命令

```bash
npm run dev            # 前端 dev（纯浏览器，无 Tauri IPC）
npm run tauri dev      # 应用开发模式
npm run lint           # tsc --noEmit
npm run build          # 前端构建
npm run build:plugins  # 构建全部工具+能力包 → public/
npm run dist           # 签名发布构建（插件+宿主+NSIS+latest.json）
cargo test             # Rust 测试（extract_real_plugin_zips 需先 build:plugins）
cargo test remote_registry_smoke -- --ignored   # 远程分发链路冒烟（真实网络）
```

## 代码规范

- **主题**：shadcn 风格 CSS 变量（`src/index.css` + `tailwind.config.ts`），暗色默认
  （`html.dark` + `useThemeStore` 持久化，key=`toolbox-theme`）。改色改变量，勿写死色值。
- **UI**：`cn()`（clsx+twMerge）组合类名；Button/Input 用 cva 变体；图标 lucide-react。
- **状态**：zustand；持久化用 `persist` 中间件 + 递增 version + migrate
  （参考 `useSettingsStore`，换默认值必须走 migrate，勿让老用户设置丢失）。
- **插件图标**：manifest 里是字符串（`clock`/`images`/`image`/`braces`/`hash`/`binary`），
  宿主映射表在 `src/lib/plugins.ts` 的 `ICONS`——新增图标名需要改宿主（唯一的例外）。
- **Rust**：`commands/` 只做薄封装无业务逻辑；错误统一 `AppError`（中文消息、
  `serde::Serialize` 为字符串）；重 IO 走 `tauri::async_runtime::spawn_blocking`；
  HTTP 一律用 `send_get()`（系统代理→直连自动回退，错误链完整展开）。
- **插件加载**：模块读文本 → blob URL → `import()`（绕跨源）；wasm 走原始 IPC
  （`capability_read_wasm` 返回 `ipc::Response` 二进制）；CSP 已含 `blob:` 与
  `'wasm-unsafe-eval'`，改动 CSP 前先想清楚加载链路。

## 环境事实（Windows 本机）

- gh 已登录 `pie-tk`；本机代理 `127.0.0.1:7897` 常开。
- **github.com:443（git push/clone）间歇性 SSL 失败**；`api.github.com` 通常可用——
  git push 失败时重试几次；持续失败可用 `gh api` Contents API 上传文件兜底
  （大文件用 `--input payload.json`，命令行传 base64 会超长）。
- 之后记得 `git fetch && git rebase origin/main` 消除 API 提交造成的分叉。
- jsDelivr 仅作备用源（`@main` 缓存可能滞后数小时且 purge 不清 partner 节点）。

## 已知敏感点

- **simulator v4.0.0 是全功能原生移植插件**(参考 E:\tools\simulator,Python/PyQt5,只读):
  全部逻辑在 `plugins/simulator/src/core/`(define/deviceModel/device/devices 族/gateway/
  wsClient/discovery/crypto/mdns/apiServer/tasks/cloudMqtt/engine),UI 在 `components/`
  (Tab:总览/网关/子设备/任务/业务/设置)。持久化走 fs 原语 JSON 快照(8 表等价,
  `cache/simulator/{home_mac|local}.json`);对外 8089 API 由宿主 `commands/net.rs`
  通用网络原语(WS/HTTP 入站 + UDP 组播 + 网卡枚举)承载,插件监听 `net-*` 事件。
  发现协议 AES 是 \0 零填充 → 纯 TS 实现(core/crypto.ts,FIPS 向量自检),勿换 WebCrypto。
  `smoke.mts` 为全量回归冒烟(esbuild+node 跑,见文件头注释)。
  **联网链路(真实 HC/云 broker)需真机联调**;插件 minAppVersion=0.2.0(依赖 net 原语)。
- `plugins/mipmap-studio/src/` 由原独立项目整体迁移，hooks/stores/components 的
  import 路径依赖 esbuild 的 `@ → 插件自身 src` 别名（见 build-plugins.mjs），勿改成宿主路径。
- `timestamp` 与 `image-convert` 是无依赖纯前端工具，可作为新插件的模板。
- 工具市场的 registry 数据缓存在 `useMarketStore`（stale-while-revalidate），
  离开页面不清空；换源时会自动清缓存。
- `.gitignore` 覆盖：`node_modules`、`dist`、`src-tauri/target`、`capabilities/*/target`、
  `public/registry.json`、`public/plugins/`、`release/`、`.tauri/`——构建产物不入库。
- **simulator 源码是私有的，不在本仓库**：真实源码在嵌套 git 仓库
  `plugins/simulator/`（远程 = `pie-tk/toolbox-plugin-simulator`，PRIVATE），
  已被 `.gitignore` 排除且历史已清理；本仓库对 simulator 只分发 registry 的
  构建产物 ZIP。克隆本仓库后需 simulator 源码时：
  `git clone https://github.com/pie-tk/toolbox-plugin-simulator plugins/simulator`
  （需 pie-tk 授权）。`scripts/build-plugins.mjs` 的 `packageZip` 有
  `assertNoSourceLeaks` 防线，源码/调试文件进包会直接构建失败。
