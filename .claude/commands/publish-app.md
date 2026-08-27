---
description: 发布应用新版本（签名构建 + registry 推送 + GitHub Release，含自更新链路）
---

按以下流程发布 ToolBox 应用版本（详细规则见 CLAUDE.md「分发与更新」）：

1. **同步改三处版本号**：`src-tauri/tauri.conf.json`、`package.json`、`src-tauri/Cargo.toml`。
2. 确认签名私钥存在：`.tauri/toolbox.key`（丢失则无法发更新，立即提醒用户）。
3. 执行 `npm run dist`。产出（并自动同步到 `E:\tools\toolbox-registry\app\`）：
   - `release/ToolBox.exe`（便携版）
   - `release/ToolBox-setup.exe` + `.sig`（NSIS 安装包 + minisign 签名）
   - `release/latest.json`（更新清单，version 应为新版本号）
4. 提交推送 registry 仓库（`app/` 三个文件）。git 失败时重试，再不行走 gh api Contents。
5. 创建 GitHub Release（**必须 `-R pie-tk/toolbox`**，否则会建到 cwd 所在仓库）：
   ```
   gh release create vX.Y.Z -R pie-tk/toolbox release/ToolBox.exe release/ToolBox-setup.exe release/ToolBox-setup.exe.sig release/latest.json --title "..." --notes "..."
   ```
6. 提交推送源码仓库 `pie-tk/toolbox`（版本号变更）。
7. 验证：等约 1 分钟后 `curl https://pie-tk.github.io/toolbox-registry/app/latest.json`
   确认 version 为新版本；旧版本应用「设置 → 关于与更新 → 检查更新」应能发现并安装。
