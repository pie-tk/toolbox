import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Store,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { formatBytes } from "@/lib/utils";
import { getAppInfo } from "@/lib/tauri";
import {
  iconFromName,
  installTool,
  uninstallTool,
  unmetRequires,
  type RegistryTool,
} from "@/lib/plugins";
import { useAppStore } from "@/store/useAppStore";
import { useMarketStore } from "@/store/useMarketStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useToolsStore } from "@/store/useToolsStore";
import { CATEGORY_LABELS } from "@/types/tool";

interface InstallProgress {
  kind: string;
  stage: string;
  received: number;
  total: number;
}

type RowStatus = "not-installed" | "installed" | "updatable";

function stageLabel(stage: string): string {
  switch (stage) {
    case "verify":
      return "校验中";
    case "extract":
      return "解压中";
    case "install":
      return "安装中";
    default:
      return "处理中";
  }
}

/** 简易语义化版本比较：a >= b。 */
function versionGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export function MarketplacePage() {
  const registryUrl = useSettingsStore((s) => s.registryUrl);
  const records = useToolsStore((s) => s.records);
  const capabilities = useToolsStore((s) => s.capabilities);
  const refreshTools = useToolsStore((s) => s.refresh);
  const openTool = useAppStore((s) => s.openTool);
  const view = useAppStore((s) => s.view);

  const doc = useMarketStore((s) => s.doc);
  const loadedAt = useMarketStore((s) => s.loadedAt);
  const cachedUrl = useMarketStore((s) => s.url);
  const error = useMarketStore((s) => s.error);
  const fetching = useMarketStore((s) => s.fetching);
  const fetchMarket = useMarketStore((s) => s.fetch);

  const [installing, setInstalling] = useState<Record<string, InstallProgress>>({});
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("0.0.0");

  useEffect(() => {
    getAppInfo().then((info) => info && setAppVersion(info.version));
  }, []);

  // 进入页面：先展示缓存数据，同时后台刷新。
  useEffect(() => {
    fetchMarket(registryUrl);
  }, [fetchMarket, registryUrl]);

  // 安装进度事件（工具与其依赖能力的下载/校验/解压；能力部分静默进行）。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<InstallProgress & { id: string }>("plugin-install-progress", (event) => {
      const p = event.payload;
      setInstalling((prev) => ({
        ...prev,
        [p.id]: { kind: p.kind, stage: p.stage, received: p.received, total: p.total },
      }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const handleInstall = async (tool: RegistryTool) => {
    const id = tool.manifest.id;
    setInstalling((prev) => ({ ...prev, [id]: { kind: "tool", stage: "准备中", received: 0, total: 0 } }));
    try {
      const rec = await installTool(registryUrl, id);
      await refreshTools();
      toast.success(`已安装 ${tool.manifest.name} v${rec.version}`);
    } catch (e) {
      toast.error(`安装失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstalling((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleUninstall = async (tool: RegistryTool) => {
    const id = tool.manifest.id;
    setUninstalling(id);
    try {
      await uninstallTool(id);
      if (view.type === "tool" && view.toolId === id) {
        useAppStore.getState().openHome();
      }
      await refreshTools();
      toast.success(`已卸载 ${tool.manifest.name}`);
    } catch (e) {
      toast.error(`卸载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUninstalling(null);
    }
  };

  const statusOf = (tool: RegistryTool): RowStatus => {
    const rec = records[tool.manifest.id];
    if (!rec) return "not-installed";
    return rec.version === tool.manifest.version ? "installed" : "updatable";
  };

  /** 正在静默下载的能力（不单独展示，附在工具卡进度上）。 */
  const capIds = new Set(doc?.capabilities.map((c) => c.manifest.id) ?? []);
  const downloadingCaps = Object.entries(installing)
    .filter(([id]) => capIds.has(id))
    .map(([id, p]) => ({ id, p }));

  const progressLabel = (p: InstallProgress) => {
    if (p.stage === "download" && p.total > 0)
      return `${formatBytes(p.received)} / ${formatBytes(p.total)}`;
    if (p.stage === "download") return formatBytes(p.received);
    return stageLabel(p.stage);
  };

  const isCacheStale = cachedUrl === registryUrl && !!doc;

  return (
    <div className="mx-auto max-w-5xl animate-fade-in space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">工具市场</h1>
          {isCacheStale && loadedAt && !fetching && (
            <p className="mt-1 text-xs text-muted-foreground/60">
              更新于 {new Date(loadedAt).toLocaleTimeString()}，进入页面时自动刷新
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchMarket(registryUrl)} disabled={fetching}>
          {fetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          刷新
        </Button>
      </div>

      {error && !doc && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div>无法获取工具目录：{error}</div>
            <div className="text-xs opacity-80">
              请检查源地址是否可达（当前源：<span className="font-mono">{registryUrl}</span>），
              可在设置页修改，或点击右上角刷新重试。
            </div>
          </div>
        </div>
      )}
      {error && doc && (
        <p className="text-xs text-muted-foreground/60">
          刷新失败（{error}），当前展示的是缓存内容
        </p>
      )}

      {fetching && !doc && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border bg-card/50" />
          ))}
        </div>
      )}

      {doc && doc.tools.length === 0 && (
        <EmptyState icon={Store} title="目录为空" description="registry 中没有可用的工具" />
      )}

      {doc && doc.tools.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {doc.tools.map((tool) => {
            const m = tool.manifest;
            const Icon = iconFromName(m.icon);
            const status = statusOf(tool);
            const progress = installing[m.id];
            const isUninstalling = uninstalling === m.id;
            const rec = records[m.id];
            const unmet = rec
              ? unmetRequires(Object.keys(m.requires ?? {}), capabilities)
              : [];
            const hostOk =
              !m.minAppVersion || versionGte(appVersion, m.minAppVersion);

            return (
              <div
                key={m.id}
                className="flex animate-fade-in flex-col gap-3 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{m.name}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {CATEGORY_LABELS[m.category]}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        v{m.version}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        {formatBytes(tool.package.size)}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {m.description}
                    </div>
                  </div>
                </div>

                {progress && progress.stage === "download" && progress.total > 0 && (
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{
                        width: `${Math.min(100, (progress.received / progress.total) * 100)}%`,
                      }}
                    />
                  </div>
                )}

                <div className="mt-auto flex items-center justify-between border-t pt-3">
                  {progress ? (
                    <span className="flex items-center gap-2 text-xs text-primary">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {progressLabel(progress)}
                      {downloadingCaps.length > 0 && "（含共享能力）"}
                    </span>
                  ) : status === "installed" ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                      <Check className="h-3 w-3" />
                      已安装
                    </span>
                  ) : status === "updatable" ? (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">
                      可更新
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">未安装</span>
                  )}

                  {progress ? null : status === "installed" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openTool(m.id)}
                        disabled={unmet.length > 0}
                        title={unmet.length > 0 ? "依赖能力未就绪" : undefined}
                      >
                        打开
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isUninstalling}
                        onClick={() => handleUninstall(tool)}
                        title="卸载"
                      >
                        {isUninstalling ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ) : hostOk ? (
                    <Button size="sm" onClick={() => handleInstall(tool)}>
                      <Download className="h-3.5 w-3.5" />
                      {status === "updatable" ? "更新" : "下载"}
                    </Button>
                  ) : (
                    <span
                      className="text-xs text-muted-foreground/70"
                      title={`当前宿主 v${appVersion} 不满足要求`}
                    >
                      需 ToolBox ≥ v{m.minAppVersion}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
