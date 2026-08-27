import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useSearchStore } from "@/store/useSearchStore";

export function SearchBar() {
  const query = useSearchStore((s) => s.query);
  const setQuery = useSearchStore((s) => s.setQuery);
  const next = useSearchStore((s) => s.next);
  const prev = useSearchStore((s) => s.prev);
  const matches = useSearchStore((s) => s.matches);
  const clear = useSearchStore((s) => s.clear);
  const count = matches.length;
  const hasQuery = query.length > 0;

  return (
    <div className="flex items-center gap-2 border-b bg-card px-4 py-2">
      <div className="relative w-full max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索图片名称（支持模糊匹配，回车跳转）"
          className="h-8 pl-8 pr-8"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.shiftKey ? prev() : next();
            } else if (e.key === "Escape") {
              clear();
            }
          }}
        />
        {hasQuery && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="清除搜索"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="w-20 text-xs tabular-nums text-muted-foreground">
        {hasQuery ? `${count} 个匹配` : ""}
      </div>

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => prev()}
        disabled={count === 0}
        aria-label="上一个匹配"
        title="上一个 (Shift+Enter)"
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => next()}
        disabled={count === 0}
        aria-label="下一个匹配"
        title="下一个 (Enter)"
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  );
}
