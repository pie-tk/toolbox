import { Search, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToolCard } from "@/components/ToolCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { fuzzyMatch } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useToolsStore } from "@/store/useToolsStore";
import { CATEGORY_LABELS, CATEGORY_ORDER, type ToolMeta } from "@/types/tool";

function matches(meta: ToolMeta, query: string): boolean {
  return (
    fuzzyMatch(query, meta.name) ||
    meta.keywords.some((k) => fuzzyMatch(query, k)) ||
    fuzzyMatch(query, meta.id)
  );
}

export function HomePage() {
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const openMarketplace = useAppStore((s) => s.openMarketplace);
  const metas = useToolsStore((s) => s.metas);
  const filtered = metas.filter((t) => matches(t, search));

  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-8 p-8">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">工具箱</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索工具名称、关键词…"
            className="pl-9"
          />
        </div>
      </div>

      {metas.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            icon={Store}
            title="还没有安装任何工具"
            description="到工具市场浏览并下载需要的工具，安装后会出现在这里"
          />
          <div className="flex justify-center">
            <Button onClick={openMarketplace}>
              <Store className="h-4 w-4" />
              去工具市场
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="没有匹配的工具" description="换个关键词试试，或到工具市场看看还有什么" />
      ) : (
        CATEGORY_ORDER.map((category) => {
          const tools = filtered.filter((t) => t.category === category);
          if (tools.length === 0) return null;
          return (
            <section key={category} className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tools.map((meta) => (
                  <ToolCard key={meta.id} meta={meta} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
