import { ArrowRightLeft, Moon, Repeat, Sun, type LucideIcon } from "lucide-react";
import type { FolderTransformKind } from "./types";

/** Icon per folder transform kind. Adding a new op = one entry here. */
export const FOLDER_OP_ICONS: Record<FolderTransformKind, LucideIcon> = {
  "add-night": Moon,
  "remove-night": Sun,
  "mipmap-to-drawable": ArrowRightLeft,
  "drawable-to-mipmap": Repeat,
};
