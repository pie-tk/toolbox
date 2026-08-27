import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ReactNode } from "react";
import { useScan } from "@/hooks/useScan";
import { useSearchStore } from "@/store/useSearchStore";
import { cn, fuzzyMatch } from "@/lib/utils";
import { ImageRow } from "./ImageRow";
import { Spinner } from "./ui/spinner";

/** Shared grid template for header + rows (7 columns, parity with the original). */
export const COL_TEMPLATE =
  "grid-cols-[44px_76px_minmax(110px,1fr)_minmax(110px,1fr)_60px_64px_48px]";

const ROW_HEIGHT = 70;

function Centered({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}

export function ImageTable({
  dir,
  onDelete,
}: {
  dir: string;
  onDelete: (id: string) => void;
}) {
  const { data, isLoading, isError } = useScan(dir);
  const entries = data?.entries ?? [];

  const query = useSearchStore((s) => s.query);
  const setMatches = useSearchStore((s) => s.setMatches);
  const highlightedId = useSearchStore((s) => s.highlightedId);

  const matchIds = useMemo(() => {
    if (!query) return null;
    return new Set(
      entries.filter((e) => fuzzyMatch(query, e.name)).map((e) => e.id)
    );
  }, [query, entries]);

  // Publish matches to the store (drives SearchBar count + next/prev).
  useEffect(() => {
    setMatches(matchIds ? Array.from(matchIds) : []);
  }, [matchIds, setMatches]);

  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    entries.forEach((e, i) => map.set(e.id, i));
    return map;
  }, [entries]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Jump-scroll to the highlighted search match.
  useEffect(() => {
    if (!highlightedId) return;
    const idx = indexById.get(highlightedId);
    if (idx !== undefined) {
      rowVirtualizer.scrollToIndex(idx, { align: "center" });
    }
  }, [highlightedId, indexById, rowVirtualizer]);

  if (isLoading) {
    return <Centered icon={<Spinner className="h-6 w-6" />} text="正在扫描资源目录…" />;
  }
  if (isError) {
    return <Centered text="扫描失败：请检查目录路径与权限。" />;
  }
  if (entries.length === 0) {
    return (
      <Centered text="该目录下没有 mipmap-* / drawable-* 图片。" />
    );
  }

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "grid items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground",
          COL_TEMPLATE
        )}
      >
        <span className="text-center" title="批量删除">
          批删
        </span>
        <span>预览</span>
        <span>图片名称</span>
        <span>修改名称</span>
        <span>删除</span>
        <span className="text-center">分辨率</span>
        <span className="text-center" title="批量反转">
          反转
        </span>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto scrollbar-thin">
        <div
          className="relative w-full"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {virtualItems.map((virtualItem) => {
            const entry = entries[virtualItem.index];
            return (
              <div
                key={entry.id}
                data-index={virtualItem.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <ImageRow
                  entry={entry}
                  highlighted={highlightedId === entry.id}
                  dimmed={!!matchIds && !matchIds.has(entry.id)}
                  onDelete={onDelete}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
