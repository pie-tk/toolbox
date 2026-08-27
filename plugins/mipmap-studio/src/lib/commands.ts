// 命令门面：保持原 Rust command 时代的导出名不变，内部改为
// 本地 ops（JS 实现 + 宿主文件原语 + image-core 能力）。
import { invoke } from "@tauri-apps/api/core";
import * as ops from "./ops";
import type { AppInfo } from "./types";

export const scanProject = ops.scanProject;
export const batchRename = ops.batchRename;
export const batchDelete = ops.batchDelete;
export const batchReverse = ops.batchReverse;
export const applyFolderTransform = ops.applyFolderTransform;
export const undoLast = ops.undoLast;
export const undoCount = () => Promise.resolve(ops.undoCount());
export const listFolderTransforms = () => Promise.resolve(ops.listFolderTransforms());

export const appInfo = () => invoke<AppInfo>("app_info");
