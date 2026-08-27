import { Trash2 } from "lucide-react";
import type { ImageEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Thumbnail } from "./Thumbnail";
import { useDraftsStore } from "@/store/useDraftsStore";
import { useSelectionStore } from "@/store/useSelectionStore";
import { COL_TEMPLATE } from "./ImageTable";

interface ImageRowProps {
  entry: ImageEntry;
  highlighted: boolean;
  dimmed: boolean;
  onDelete: (id: string) => void;
}

export function ImageRow({
  entry,
  highlighted,
  dimmed,
  onDelete,
}: ImageRowProps) {
  const draft = useDraftsStore((s) => s.drafts[entry.id]);
  const setDraft = useDraftsStore((s) => s.setDraft);
  const deleteChecked = useSelectionStore((s) => s.deleteIds.has(entry.id));
  const reverseChecked = useSelectionStore((s) => s.reverseIds.has(entry.id));
  const toggleDelete = useSelectionStore((s) => s.toggleDelete);
  const toggleReverse = useSelectionStore((s) => s.toggleReverse);

  const value = draft ?? entry.name;
  const changed = draft !== undefined && draft.trim() !== entry.name;

  return (
    <div
      className={cn(
        "grid h-[70px] w-full items-center gap-2 border-b border-border/50 px-3 transition-colors",
        COL_TEMPLATE,
        highlighted
          ? "bg-primary/15 ring-1 ring-inset ring-primary/50"
          : "hover:bg-accent/40",
        dimmed && "opacity-40"
      )}
    >
      <div className="flex justify-center">
        <Checkbox
          checked={deleteChecked}
          onChange={() => toggleDelete(entry.id)}
          aria-label="勾选批量删除"
        />
      </div>
      <Thumbnail entry={entry} size={60} />

      <span className="truncate text-sm font-medium" title={entry.name}>
        {entry.name}
      </span>

      <Input
        value={value}
        onChange={(e) => setDraft(entry.id, e.target.value)}
        spellCheck={false}
        className={cn(
          "h-8 text-sm",
          changed && "border-primary ring-1 ring-primary/40"
        )}
        aria-label="修改名称"
      />

      <div className="flex justify-center">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(entry.id)}
          aria-label="删除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <span className="text-center text-sm tabular-nums text-muted-foreground">
        {entry.resolutionCount}
      </span>

      <div className="flex justify-center">
        <Checkbox
          checked={reverseChecked}
          onChange={() => toggleReverse(entry.id)}
          aria-label="勾选批量反转"
        />
      </div>
    </div>
  );
}
