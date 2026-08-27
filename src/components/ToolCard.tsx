import { ArrowRight } from "lucide-react";
import type { ToolMeta } from "@/types/tool";
import { unmetRequires } from "@/lib/plugins";
import { useAppStore } from "@/store/useAppStore";
import { useToolsStore } from "@/store/useToolsStore";

/** 首页工具卡片（依赖能力未就绪时禁用）。 */
export function ToolCard({ meta }: { meta: ToolMeta }) {
  const openTool = useAppStore((s) => s.openTool);
  const capabilities = useToolsStore((s) => s.capabilities);
  const unmet = unmetRequires(meta.requires, capabilities);
  const Icon = meta.icon;
  return (
    <button
      onClick={() => openTool(meta.id)}
      disabled={unmet.length > 0}
      title={unmet.length > 0 ? "依赖能力未就绪，可到工具市场修复" : undefined}
      className="group flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{meta.name}</span>
          <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            v{meta.version}
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {meta.description}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
