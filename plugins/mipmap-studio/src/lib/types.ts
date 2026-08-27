// TS mirror of the Rust serde types (camelCase). Kept in sync manually.

export interface ImageOccurrence {
  folder: string;
  path: string;
  sizeBytes: number;
  /** mtime seconds since UNIX_EPOCH (drives thumbnail-cache invalidation). */
  modified: number;
}

export interface ImageEntry {
  /** Stable id == group key (the file name). */
  id: string;
  name: string;
  occurrences: ImageOccurrence[];
  resolutionCount: number;
  previewPath: string;
}

export interface ScanResult {
  resDir: string;
  folders: string[];
  entries: ImageEntry[];
}

export interface BatchResult {
  applied: number;
  skipped: number;
  failed: string[];
  opId: string;
}

export interface FolderTransformResult {
  renamed: [string, string][];
  skipped: string[];
  opId: string;
}

export type FolderTransformKind =
  | "add-night"
  | "remove-night"
  | "mipmap-to-drawable"
  | "drawable-to-mipmap";

export interface TransformKindInfo {
  kind: FolderTransformKind;
  label: string;
  description: string;
  confirm: string;
}

export interface RenameTask {
  id: string;
  newName: string;
}

export interface UndoResult {
  undone: boolean;
  detail: string;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
}

export interface ProgressEvent {
  opId: string;
  current: number;
  total: number;
  phase: string;
}
