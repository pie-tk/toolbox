import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  getCapability,
  loadPluginModule,
  loadPluginStyle,
  type InstalledRecord,
  type PluginModule,
} from "@/lib/plugins";
import { cn } from "@/lib/utils";

/**
 * 外部插件挂载点：注入样式 → 动态 import module.js → mount(container, ctx)。
 * ctx 提供共享能力访问（capability(id)），卸载时调用插件的 unmount 并清空容器。
 */
export function ExternalToolMount({
  record,
  layout,
}: {
  record: InstalledRecord;
  layout?: "card" | "fullscreen";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    let mod: PluginModule | null = null;

    (async () => {
      try {
        await loadPluginStyle(record);
        mod = await loadPluginModule(record);
        if (cancelled) return;
        mod.mount(el, { capability: getCapability });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      try {
        mod?.unmount?.();
      } catch {
        /* ignore */
      }
      el.innerHTML = "";
    };
  }, [record]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={AlertTriangle}
          title="插件加载失败"
          description={`${record.manifest.name}（v${record.version}）：${error}。可在工具市场重新安装。`}
        />
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className={cn(layout === "fullscreen" && "h-full")}
    />
  );
}
