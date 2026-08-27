---
description: 全量构建与测试验证（改代码后必跑）
---

修改代码后按顺序验证（详见 CLAUDE.md「常用命令」）：

```bash
# 前端类型检查 + 构建
npm run lint && npm run build

# Rust 编译 + 测试（零警告为标准）
cd src-tauri && cargo check && cargo test

# 改动涉及插件构建/打包/安装时：重建插件包后再测（zip 校验依赖产物存在）
cd .. && npm run build:plugins && cd src-tauri && cargo test

# 改动涉及网络/分发链路时（真实网络冒烟，需 --ignored 显式运行）
cargo test remote_registry_smoke -- --ignored --nocapture
```

冒烟启动（窗口会弹出，验证完关闭）：`npm run tauri dev`。
注意端口 1420 被占用时先杀残留进程：toolbox.exe / node（vite）。
