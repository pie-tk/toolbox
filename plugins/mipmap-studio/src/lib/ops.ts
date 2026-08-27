/**
 * Mipmap Studio 数据层：完整移植自原 Rust core/service（scan / rename /
 * reverse / folder transform / undo / thumbnail），文件操作走宿主文件原语，
 * 图像处理走 image-core 共享能力（wasm）。宿主不再内置任何图像后端。
 */
import { invoke } from "@tauri-apps/api/core";
import { imageCore } from "./hostApi";
import type {
  BatchResult,
  FolderTransformKind,
  FolderTransformResult,
  ImageEntry,
  ImageOccurrence,
  RenameTask,
  ScanResult,
  TransformKindInfo,
  UndoResult,
} from "./types";

/* ---- 宿主文件原语 ---- */

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
}

const listDir = (dir: string) => invoke<FsEntry[]>("fs_list_dir", { dir });

async function readBytes(path: string): Promise<Uint8Array> {
  const raw = await invoke<ArrayBuffer | Uint8Array>("fs_read_bytes", { path });
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}

const writeBytes = (path: string, data: Uint8Array) =>
  invoke<void>("fs_write_bytes", { path, data });

const fsRename = (from: string, to: string) => invoke<void>("fs_rename", { from, to });
const fsExists = (path: string) => invoke<boolean>("fs_exists", { path });
const fsRemoveFile = (path: string) => invoke<void>("fs_remove_file", { path });
const fsRemoveDir = (path: string) => invoke<void>("fs_remove_dir", { path });
const fsCreateDirAll = (path: string) => invoke<void>("fs_create_dir_all", { path });
const fsCacheDir = () => invoke<string>("fs_cache_dir");

/* ---- 文件夹命名规则（纯函数，端口自 core/folder.rs） ---- */

const MIPMAP_PREFIX = "mipmap-";
const DRAWABLE_PREFIX = "drawable-";
const LDRTL_INFIX = "ldrtl-";
const NIGHT_INFIX = "night-";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

const PREFERRED_PREVIEW_FOLDERS = [
  "mipmap-xxxhdpi",
  "mipmap-xxhdpi",
  "mipmap-xhdpi",
  "mipmap-hdpi",
  "mipmap-mdpi",
  "mipmap-ldpi",
  "drawable-xxxhdpi",
  "drawable-xxhdpi",
  "drawable-xhdpi",
  "drawable-hdpi",
  "drawable-mdpi",
  "drawable-ldpi",
];

function isResourceFolder(name: string): boolean {
  return name.startsWith(MIPMAP_PREFIX) || name.startsWith(DRAWABLE_PREFIX);
}

function hasImageExtension(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return name.includes(".") && IMAGE_EXTENSIONS.has(ext);
}

function previewRank(folder: string): number {
  const i = PREFERRED_PREVIEW_FOLDERS.indexOf(folder);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function toLdrtlFolder(folder: string): string | null {
  if (folder.startsWith(MIPMAP_PREFIX)) {
    return `${MIPMAP_PREFIX}${LDRTL_INFIX}${folder.slice(MIPMAP_PREFIX.length)}`;
  }
  if (folder.startsWith(DRAWABLE_PREFIX)) {
    return `${DRAWABLE_PREFIX}${LDRTL_INFIX}${folder.slice(DRAWABLE_PREFIX.length)}`;
  }
  return null;
}

/* ---- 目录名变换（端口自 core/transform.rs） ---- */

export const FOLDER_TRANSFORMS: TransformKindInfo[] = [
  {
    kind: "add-night",
    label: "mipmap 加 night",
    description: "给所有 mipmap-* 目录加 night 前缀（深色模式资源）",
    confirm: "确定给所有 mipmap-* 目录加 night 前缀？",
  },
  {
    kind: "remove-night",
    label: "mipmap 去 night",
    description: "去掉所有 mipmap-night-* 目录的 night 前缀",
    confirm: "确定去掉所有 mipmap-night-* 目录的 night 前缀？",
  },
  {
    kind: "mipmap-to-drawable",
    label: "mipmap 转 drawable",
    description: "把所有 mipmap-* 目录重命名为 drawable-*",
    confirm: "确定把所有 mipmap-* 目录转为 drawable-*？",
  },
  {
    kind: "drawable-to-mipmap",
    label: "drawable 转 mipmap",
    description: "把所有 drawable-* 目录还原为 mipmap-*",
    confirm: "确定把所有 drawable-* 目录转为 mipmap-*？",
  },
];

function applyFolderName(kind: FolderTransformKind, folder: string): string | null {
  switch (kind) {
    case "add-night": {
      if (folder.startsWith(`${MIPMAP_PREFIX}${NIGHT_INFIX}`)) return null;
      if (!folder.startsWith(MIPMAP_PREFIX)) return null;
      return `${MIPMAP_PREFIX}${NIGHT_INFIX}${folder.slice(MIPMAP_PREFIX.length)}`;
    }
    case "remove-night": {
      const p = `${MIPMAP_PREFIX}${NIGHT_INFIX}`;
      if (!folder.startsWith(p)) return null;
      return `${MIPMAP_PREFIX}${folder.slice(p.length)}`;
    }
    case "mipmap-to-drawable": {
      if (!folder.startsWith(MIPMAP_PREFIX)) return null;
      return `${DRAWABLE_PREFIX}${folder.slice(MIPMAP_PREFIX.length)}`;
    }
    case "drawable-to-mipmap": {
      if (!folder.startsWith(DRAWABLE_PREFIX)) return null;
      return `${MIPMAP_PREFIX}${folder.slice(DRAWABLE_PREFIX.length)}`;
    }
  }
}

export function listFolderTransforms(): TransformKindInfo[] {
  return FOLDER_TRANSFORMS;
}

/* ---- 扫描（端口自 core/scan.rs） ---- */

export async function scanProject(resDir: string): Promise<ScanResult> {
  const top = await listDir(resDir);
  const folders: string[] = [];
  const grouped = new Map<string, ImageOccurrence[]>();

  for (const entry of top) {
    if (!entry.isDir || !isResourceFolder(entry.name)) continue;
    folders.push(entry.name);
    const inner = await listDir(entry.path);
    for (const file of inner) {
      if (file.isDir || !hasImageExtension(file.name)) continue;
      const occurrence: ImageOccurrence = {
        folder: entry.name,
        path: file.path,
        sizeBytes: file.size,
        modified: file.modified,
      };
      const list = grouped.get(file.name);
      if (list) list.push(occurrence);
      else grouped.set(file.name, [occurrence]);
    }
  }

  folders.sort();

  const entries: ImageEntry[] = [...grouped.entries()]
    .map(([name, occurrences]) => {
      occurrences.sort((a, b) => previewRank(a.folder) - previewRank(b.folder));
      return {
        id: name,
        name,
        occurrences,
        resolutionCount: occurrences.length,
        previewPath: occurrences[0]?.path ?? "",
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return { resDir, folders, entries };
}

/* ---- 重命名计划（端口自 core/rename.rs） ---- */

interface PlannedMove {
  src: string;
  dst: string;
}

function isValidFilename(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return !/[<>:"|?*]/.test(name);
}

function withFileName(path: string, fileName: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sep === -1 ? fileName : path.slice(0, sep + 1) + fileName;
}

function buildMoves(entries: ImageEntry[], tasks: RenameTask[]): PlannedMove[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const moves: PlannedMove[] = [];

  for (const task of tasks) {
    const newName = task.newName.trim();
    if (!newName) throw new Error(`「${task.id}」的新名称为空`);
    if (newName === task.id) continue; // no-op
    if (!isValidFilename(newName)) throw new Error(`无效的文件名: ${newName}`);
    const entry = byId.get(task.id);
    if (!entry) throw new Error(`找不到图片: ${task.id}`);
    for (const occurrence of entry.occurrences) {
      moves.push({ src: occurrence.path, dst: withFileName(occurrence.path, newName) });
    }
  }

  const seen = new Set<string>();
  for (const m of moves) {
    if (seen.has(m.dst)) throw new Error(`多个图片重命名为同一目标: ${m.dst}`);
    seen.add(m.dst);
  }
  return moves;
}

/* ---- 撤销栈（端口自 core/undo.rs + service/ops.rs undo 部分） ---- */

type RecordedOp =
  | { type: "delete"; items: Array<[string, string]> } // (original, stash)
  | { type: "rename"; items: Array<[string, string]> } // (old, new)
  | { type: "reverse"; outputs: string[] }
  | { type: "folder-transform"; renames: Array<[string, string]> };

const undoStack: RecordedOp[] = [];

export function undoCount(): number {
  return undoStack.length;
}

/* ---- 进度上报（直接驱动 store，替代原 Tauri 事件） ---- */

// 延迟 import 避免循环依赖：store 只在操作执行时使用。
type ProgressSetter = (e: { opId: string; current: number; total: number; phase: string }) => void;
let progressSink: ProgressSetter | null = null;
export function setProgressSink(fn: ProgressSetter | null): void {
  progressSink = fn;
}
function report(opId: string, current: number, total: number, phase: string): void {
  progressSink?.({ opId, current, total, phase });
}

let opCounter = 0;
function nextOpId(): string {
  opCounter += 1;
  return `op-${Date.now()}-${opCounter}`;
}

function dirName(path: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sep === -1 ? "" : path.slice(0, sep);
}

function joinPath(dir: string, name: string): string {
  return dir ? `${dir.replace(/[\\/]+$/, "")}/${name}` : name;
}

/* ---- 批量操作（端口自 service/ops.rs，逻辑等价、单线程顺序执行） ---- */

const PROGRESS_EVERY = 5;

export async function batchRename(resDir: string, tasks: RenameTask[]): Promise<BatchResult> {
  const opId = nextOpId();
  const scanResult = await scanProject(resDir);
  const moves = buildMoves(scanResult.entries, tasks);

  // 整体冲突预检：任一目标已存在则全部中止（与原实现一致）。
  for (const m of moves) {
    if (m.dst !== m.src && (await fsExists(m.dst))) {
      throw new Error(`目标已存在: ${m.dst}`);
    }
  }

  const total = moves.length;
  const failed: string[] = [];
  const donePairs: Array<[string, string]> = [];

  for (let i = 0; i < total; i++) {
    try {
      await fsRename(moves[i].src, moves[i].dst);
      donePairs.push([moves[i].src, moves[i].dst]);
    } catch (e) {
      failed.push(`${moves[i].src}: ${String(e)}`);
    }
    if (i % PROGRESS_EVERY === 0 || i + 1 === total) {
      report(opId, i + 1, total, "rename");
    }
  }

  if (donePairs.length > 0) undoStack.push({ type: "rename", items: donePairs });
  return { applied: donePairs.length, skipped: 0, failed, opId };
}

export async function batchDelete(resDir: string, ids: string[]): Promise<BatchResult> {
  const opId = nextOpId();
  const scanResult = await scanProject(resDir);
  const byId = new Map(scanResult.entries.map((e) => [e.id, e]));
  const entries = ids.map((id) => {
    const e = byId.get(id);
    if (!e) throw new Error(`找不到图片: ${id}`);
    return e;
  });

  // 回收站：<缓存目录>/mipmap-studio-trash/<opId>
  const stashRoot = joinPath(
    joinPath(await fsCacheDir(), "mipmap-studio-trash"),
    opId
  );
  await fsCreateDirAll(stashRoot);

  const total = entries.reduce((n, e) => n + e.occurrences.length, 0);
  const failed: string[] = [];
  const stashed: Array<[string, string]> = [];
  let done = 0;
  let index = 0;

  for (const entry of entries) {
    for (const occurrence of entry.occurrences) {
      done += 1;
      const ext = occurrence.path.slice(occurrence.path.lastIndexOf("."));
      const stashPath = joinPath(stashRoot, `${String(index).padStart(6, "0")}${ext}`);
      index += 1;
      try {
        await fsRename(occurrence.path, stashPath);
        stashed.push([occurrence.path, stashPath]);
      } catch (e) {
        failed.push(`${occurrence.path}: ${String(e)}`);
      }
      if (done % PROGRESS_EVERY === 0 || done === total) {
        report(opId, done, total, "delete");
      }
    }
  }

  if (stashed.length > 0) undoStack.push({ type: "delete", items: stashed });
  return { applied: stashed.length, skipped: 0, failed, opId };
}

export async function batchReverse(resDir: string, ids: string[]): Promise<BatchResult> {
  const opId = nextOpId();
  const cap = await imageCore();
  const scanResult = await scanProject(resDir);
  const byId = new Map(scanResult.entries.map((e) => [e.id, e]));
  const entries = ids.map((id) => {
    const e = byId.get(id);
    if (!e) throw new Error(`找不到图片: ${id}`);
    return e;
  });

  const total = entries.reduce((n, e) => n + e.occurrences.length, 0);
  const failed: string[] = [];
  const outputs: string[] = [];
  let done = 0;

  for (const entry of entries) {
    for (const occurrence of entry.occurrences) {
      done += 1;
      const ldrtl = toLdrtlFolder(occurrence.folder);
      if (ldrtl) {
        const dstDir = joinPath(resDir, ldrtl);
        const dst = joinPath(dstDir, entry.id);
        try {
          if (!(await fsExists(dst))) {
            await fsCreateDirAll(dstDir);
            const flipped = await cap.flip(await readBytes(occurrence.path));
            await writeBytes(dst, flipped);
            outputs.push(dst);
          }
        } catch (e) {
          failed.push(`${occurrence.path}: ${String(e)}`);
        }
      }
      if (done % PROGRESS_EVERY === 0 || done === total) {
        report(opId, done, total, "reverse");
      }
    }
  }

  if (outputs.length > 0) undoStack.push({ type: "reverse", outputs });
  return { applied: outputs.length, skipped: 0, failed, opId };
}

export async function applyFolderTransform(
  resDir: string,
  kind: FolderTransformKind
): Promise<FolderTransformResult> {
  const opId = nextOpId();
  const top = await listDir(resDir);
  const renamed: Array<[string, string]> = [];
  const skipped: string[] = [];
  const pairs: Array<[string, string]> = [];

  for (const entry of top) {
    if (!entry.isDir || !isResourceFolder(entry.name)) continue;
    const newName = applyFolderName(kind, entry.name);
    if (!newName) continue;
    const dst = joinPath(resDir, newName);
    if (await fsExists(dst)) {
      skipped.push(entry.name);
    } else {
      await fsRename(entry.path, dst);
      renamed.push([entry.name, newName]);
      pairs.push([entry.path, dst]);
    }
  }

  if (pairs.length > 0) undoStack.push({ type: "folder-transform", renames: pairs });
  return { renamed, skipped, opId };
}

/* ---- 撤销 ---- */

async function reversePairs(items: Array<[string, string]>): Promise<number> {
  let count = 0;
  for (const [oldPath, newPath] of items) {
    if (await fsExists(newPath)) {
      await fsRename(newPath, oldPath);
      count += 1;
    } else if (await fsExists(oldPath)) {
      count += 1; // 已被撤销过
    }
  }
  return count;
}

export async function undoLast(): Promise<UndoResult> {
  const op = undoStack.pop();
  if (!op) return { undone: false, detail: "没有可撤销的操作" };

  if (op.type === "delete") {
    for (const [original, stash] of op.items) {
      await fsRename(stash, original);
    }
    if (op.items.length > 0) {
      await fsRemoveDir(dirName(op.items[0][1])).catch(() => undefined);
    }
    return { undone: true, detail: `恢复 ${op.items.length} 个被删除的文件` };
  }
  if (op.type === "rename") {
    const n = await reversePairs(op.items);
    return { undone: true, detail: `撤销 ${n} 次重命名` };
  }
  if (op.type === "folder-transform") {
    const n = await reversePairs(op.renames);
    return { undone: true, detail: `撤销 ${n} 个文件夹变换` };
  }
  // reverse：删除生成的文件并清理空 ldrtl 目录
  let removed = 0;
  const dirs = new Set<string>();
  for (const output of op.outputs) {
    if (await fsExists(output)) {
      await fsRemoveFile(output);
      removed += 1;
      dirs.add(dirName(output));
    }
  }
  for (const dir of dirs) {
    await fsRemoveDir(dir).catch(() => undefined); // 仅空目录可删
  }
  return { undone: true, detail: `删除 ${removed} 个反转文件` };
}

/* ---- 缩略图：image-core wasm 解码 + blob URL LRU 缓存 ---- */

const thumbCache = new Map<string, { url: string; touch: number }>();
const THUMB_CACHE_MAX = 240;
let touchCounter = 0;

export async function thumbObjectUrl(
  path: string,
  mtime: number,
  size: number
): Promise<string> {
  const key = `${path}|${mtime}|${size}`;
  const hit = thumbCache.get(key);
  if (hit) {
    hit.touch = ++touchCounter;
    return hit.url;
  }
  const cap = await imageCore();
  const png = await cap.thumbnail(await readBytes(path), size, size);
  const url = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
  thumbCache.set(key, { url, touch: ++touchCounter });

  if (thumbCache.size > THUMB_CACHE_MAX) {
    const sorted = [...thumbCache.entries()].sort((a, b) => a[1].touch - b[1].touch);
    for (const [k, v] of sorted.slice(0, sorted.length - THUMB_CACHE_MAX)) {
      URL.revokeObjectURL(v.url);
      thumbCache.delete(k);
    }
  }
  return url;
}
