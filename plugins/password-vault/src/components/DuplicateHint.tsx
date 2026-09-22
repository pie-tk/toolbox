// 表单"该网站已有记录"提示：防重复保存，可一键载入已有记录编辑。
import { useState } from "react";
import { ChevronDown, Info, Pencil } from "lucide-react";
import type { VaultEntry } from "../types";
import { fmtDateTime, maskUsername, smallBtnClass } from "../ui";

interface DuplicateHintProps {
  similar: VaultEntry[];
  /** 编辑自身时提示文案不同。 */
  editing: boolean;
  onLoad: (entry: VaultEntry) => void;
}

export function DuplicateHint({ similar, editing, onLoad }: DuplicateHintProps) {
  const [expanded, setExpanded] = useState(false);
  if (similar.length === 0) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
      <button
        className="flex w-full items-center gap-1.5 text-left text-xs text-warning"
        onClick={() => setExpanded((v) => !v)}
      >
        <Info className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">
          {editing ? "该网站已有以下记录（正在编辑其中之一？）" : `该网站/应用已有 ${similar.length} 条记录：`}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1">
          {similar.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded border border-border/60 bg-background/60 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{e.name}</div>
                <div className="truncate text-muted-foreground">
                  {maskUsername(e.username)} · 更新于 {fmtDateTime(e.updatedAt)}
                </div>
              </div>
              <button
                className={`${smallBtnClass} h-6 shrink-0`}
                onClick={() => onLoad(e)}
                title="载入该记录编辑"
              >
                <Pencil className="h-3 w-3" />
                编辑
              </button>
            </li>
          ))}
        </ul>
      )}
      {!editing && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          建议直接编辑已有记录，避免同一账号保存多份。
        </p>
      )}
    </div>
  );
}
