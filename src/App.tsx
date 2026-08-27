import { useEffect, useState } from "react";
import { AlertTriangle, SearchX, Wrench } from "lucide-react";
import { toast } from "sonner";
import { checkForUpdate } from "@/lib/updater";
import { Sidebar } from "@/components/Sidebar";
import { EmptyState } from "@/components/EmptyState";
import { ExternalToolMount } from "@/components/ExternalToolMount";
import { Button } from "@/components/ui/button";
import { HomePage } from "@/pages/HomePage";
import { MarketplacePage } from "@/pages/MarketplacePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { cn } from "@/lib/utils";
import { repairCapabilities, unmetRequires } from "@/lib/plugins";
import { useAppStore } from "@/store/useAppStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useToolsStore } from "@/store/useToolsStore";
import { getBuiltinTool } from "@/tools/registry";

/** 依赖能力未就绪：不加载插件，提供一键修复。 */
function CapabilityGate({ toolId, requires }: { toolId: string; requires: string[] }) {
  const registryUrl = useSettingsStore((s) => s.registryUrl);
  const refreshTools = useToolsStore((s) => s.refresh);
  const [repairing, setRepairing] = useState(false);

  const repair = async () => {
    setRepairing(true);
    try {
      await repairCapabilities(registryUrl, toolId);
      await refreshTools();
      toast.success("能力已就绪");
    } catch (e) {
      toast.error(`修复失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-4 text-center">
        <EmptyState
          icon={AlertTriangle}
          title="缺少运行能力"
          description={`本工具依赖的能力（${requires.join("、")}）未就绪，可能已损坏或被清理。点击修复将重新下载缺失部分。`}
        />
        <div className="flex justify-center">
          <Button onClick={repair} disabled={repairing}>
            <Wrench className="h-4 w-4" />
            {repairing ? "修复中…" : "一键修复"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 工具工作区：内置工具直接渲染组件；外部插件挂载到容器（能力未就绪时拦截）。 */
function ToolWorkspace({ toolId }: { toolId: string }) {
  const records = useToolsStore((s) => s.records);
  const capabilities = useToolsStore((s) => s.capabilities);
  const metas = useToolsStore((s) => s.metas);
  const meta = metas.find((t) => t.id === toolId);
  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={SearchX}
          title="工具不存在"
          description={`没有找到 ID 为「${toolId}」的工具，可能已被卸载`}
        />
      </div>
    );
  }
  const record = records[toolId];
  const builtin = getBuiltinTool(toolId);
  if (!record && !builtin) return null;

  // 打开门槛：依赖能力全部就绪才允许加载插件。
  const unmet = unmetRequires(meta.requires, capabilities);
  if (unmet.length > 0) return <CapabilityGate toolId={toolId} requires={unmet} />;

  const content = record ? (
    <ExternalToolMount record={record} layout={meta.layout} />
  ) : (
    (() => {
      const Component = builtin!.component;
      return <Component />;
    })()
  );

  if (meta.layout === "fullscreen") {
    return <div className="h-full animate-fade-in">{content}</div>;
  }
  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-6 p-8">
      <header className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <meta.icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold leading-tight">
            {meta.name}
            <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              v{meta.version}
            </span>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
        </div>
      </header>
      {content}
    </div>
  );
}

export default function App() {
  const view = useAppStore((s) => s.view);
  const setWidth = useSettingsStore((s) => s.setSidebarWidth);
  const refreshTools = useToolsStore((s) => s.refresh);
  const [dragging, setDragging] = useState(false);

  // 启动时加载已安装的外部插件，并静默检查应用更新。
  useEffect(() => {
    refreshTools();
    checkForUpdate().then((up) => {
      if (up) toast.info(`发现新版本 v${up.version}，可到「设置 → 关于与更新」安装`);
    });
  }, [refreshTools]);

  // 拖拽分隔条调整侧边栏宽度。
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => setWidth(e.clientX);
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, setWidth]);

  useEffect(() => {
    document.body.classList.toggle("resizing-sidebar", dragging);
    return () => document.body.classList.remove("resizing-sidebar");
  }, [dragging]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <div
        onPointerDown={() => setDragging(true)}
        role="separator"
        aria-orientation="vertical"
        className={cn(
          "w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/60",
          dragging && "bg-primary"
        )}
      />
      <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
        {view.type === "home" && <HomePage />}
        {view.type === "marketplace" && <MarketplacePage />}
        {view.type === "settings" && <SettingsPage />}
        {view.type === "tool" && <ToolWorkspace toolId={view.toolId} />}
      </main>
    </div>
  );
}
