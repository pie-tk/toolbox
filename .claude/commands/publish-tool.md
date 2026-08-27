---
description: 构建并发布工具/能力包到远程 registry（宿主零改动）
---

按以下流程发布工具或能力包（详细规则见 CLAUDE.md「分发与更新」）：

1. 确认插件源码就绪：`plugins/<id>/manifest.json`（工具）或 `capabilities/<id>/`（能力）。
   - 工具 manifest 新增/变更 `requires` 时注意：安装会自动补齐能力，无需用户操作。
   - 若用了新图标名，需在宿主 `src/lib/plugins.ts` 的 `ICONS` 表加映射（这需要重新发宿主）。
2. 在 `E:\tools\toolbox` 执行 `npm run build:plugins`，确认产物：
   - `public/registry.json`（schemaVersion 2，包含新增条目）
   - `public/plugins/<id>-<version>.zip`
3. 拷贝到 registry 仓库：`E:\tools\toolbox-registry`（`registry.json` → 根目录，zip → `plugins/`）。
4. 提交并推送 registry 仓库。注意 github.com 的 git 通道可能间歇失败：
   - 先重试几次 push（用 `git ls-remote origin main` 对比本地确认成功，别信管道退出码）；
   - 持续失败则用 `gh api` Contents API 上传（大文件用 node 生成 payload.json + `--input`）；
   - 事后 `git fetch && git rebase origin/main` 消除分叉。
5. 推送成功后 GitHub Pages 约 1 分钟生效；提示用户在应用内「工具市场 → 刷新」即可看到。
6. 回归验证：`cd src-tauri && cargo test`（extract_real_plugin_zips 会校验新包的 sha256 与解压完整性）。
