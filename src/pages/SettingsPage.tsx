import { useEffect, useState, type ReactNode } from "react";
import {
  Boxes,
  Check,
  Download,
  Loader2,
  Moon,
  RefreshCw,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatBytes } from "@/lib/utils";
import { getAppInfo } from "@/lib/tauri";
import {
  checkForUpdate,
  downloadAndInstall,
  relaunch,
  type Update,
} from "@/lib/updater";
import { uninstallTool } from "@/lib/plugins";
import {
  DEFAULT_REGISTRY_URL,
  useSettingsStore,
} from "@/store/useSettingsStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useToolsStore } from "@/store/useToolsStore";
import { CATEGORY_LABELS } from "@/types/tool";

function Section({ title, description, children }: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const registryUrl = useSettingsStore((s) => s.registryUrl);
  const setRegistryUrl = useSettingsStore((s) => s.setRegistryUrl);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.set);
  const records = useToolsStore((s) => s.records);
  const capabilities = useToolsStore((s) => s.capabilities);
  const metas = useToolsStore((s) => s.metas);
  const refreshTools = useToolsStore((s) => s.refresh);
  const [draftUrl, setDraftUrl] = useState(registryUrl);
  const [saved, setSaved] = useState(false);
  const [appInfo, setAppInfo] = useState<{
    version: string;
    platform: string;
    arch: string;
  } | null>(null);

  // 更新器状态
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 });

  const checkUpdate = async () => {
    setChecking(true);
    const up = await checkForUpdate();
    setUpdate(up);
    setChecked(true);
    setChecking(false);
  };

  const installUpdate = async () => {
    if (!update || installing) return;
    setInstalling(true);
    try {
      await downloadAndInstall(update, setProgress);
      toast.success("更新已安装，即将重启");
      await relaunch();
    } catch (e) {
      toast.error(`更新失败：${e instanceof Error ? e.message : String(e)}`);
      setInstalling(false);
    }
  };

  useEffect(() => {
    getAppInfo().then((info) => info && setAppInfo(info));
  }, []);

  useEffect(() => {
    setDraftUrl(registryUrl);
  }, [registryUrl]);

  const saveUrl = () => {
    setRegistryUrl(draftUrl.trim());
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const external = metas.filter((m) => m.source === "external");

  const handleUninstall = async (id: string) => {
    await uninstallTool(id);
    await refreshTools();
  };

  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-4 p-8">
      <h1 className="text-2xl font-semibold">设置</h1>

      <Section title="外观" description="切换界面明暗主题，偏好会自动保存。">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setTheme("light")}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
              theme === "light"
                ? "border-primary bg-primary/10"
                : "hover:bg-accent/50"
            )}
          >
            <Sun className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-medium">亮色模式</div>
              <div className="text-xs text-muted-foreground">浅色背景，适合明亮环境</div>
            </div>
            {theme === "light" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-4 text-left transition-colors",
              theme === "dark"
                ? "border-primary bg-primary/10"
                : "hover:bg-accent/50"
            )}
          >
            <Moon className="h-5 w-5 text-primary" />
            <div>
              <div className="text-sm font-medium">暗色模式</div>
              <div className="text-xs text-muted-foreground">深色背景，护眼</div>
            </div>
            {theme === "dark" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </button>
        </div>
      </Section>

      <Section
        title="工具源"
        description="工具市场的 registry.json 地址。可指向 GitHub Pages / jsDelivr，或本地开发服务器。"
      >
        <div className="flex gap-2">
          <Input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder={DEFAULT_REGISTRY_URL}
            className="font-mono text-xs"
          />
          <Button variant="outline" onClick={saveUrl} disabled={!draftUrl.trim()}>
            {saved ? <Check className="h-4 w-4" /> : null}
            {saved ? "已保存" : "保存"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="恢复默认地址"
            onClick={() => setDraftUrl(DEFAULT_REGISTRY_URL)}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-xs text-muted-foreground">
          当前源：<span className="font-mono">{registryUrl}</span>
        </div>
      </Section>

      <Section
        title="已安装工具与能力"
        description={`共 ${external.length} 个外部工具、${Object.keys(capabilities).length} 个共享能力，安装于应用所在目录的 plugins / capabilities 文件夹。`}
      >
        {Object.keys(capabilities).length > 0 && (
          <div className="space-y-2">
            {Object.values(capabilities).map((cap) => (
              <div
                key={cap.id}
                className="flex items-center gap-3 rounded-md border border-dashed bg-background/50 px-3 py-2"
              >
                <Boxes className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm">{cap.manifest.name ?? cap.id}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    v{cap.version}
                  </span>
                </div>
                <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  共享能力 · wasm
                </span>
              </div>
            ))}
          </div>
        )}
        {external.length === 0 ? (
          <div className="py-2 text-xs text-muted-foreground">
            暂无外部工具，可到工具市场下载安装。
          </div>
        ) : (
          <div className="space-y-2">
            {external.map((meta) => (
              <div
                key={meta.id}
                className="flex items-center gap-3 rounded-md border bg-background/50 px-3 py-2"
              >
                <meta.icon className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm">{meta.name}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    v{meta.version}
                  </span>
                  <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {CATEGORY_LABELS[meta.category]}
                  </span>
                </div>
                <span
                  className="truncate font-mono text-[10px] text-muted-foreground/60"
                  title={records[meta.id]?.rootDir}
                >
                  {records[meta.id]?.rootDir}
                </span>
                <Button variant="ghost" size="icon" title="卸载" onClick={() => handleUninstall(meta.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="关于与更新">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {appInfo
              ? `ToolBox v${appInfo.version} · ${appInfo.platform}-${appInfo.arch}`
              : "ToolBox"}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={checkUpdate}
              disabled={checking || installing}
            >
              {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              检查更新
            </Button>
            <Button variant="outline" size="sm" onClick={() => refreshTools()}>
              <RefreshCw className="h-3.5 w-3.5" />
              重新加载工具
            </Button>
          </div>
        </div>

        {update && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">
                  发现新版本 v{update.version}
                  <span className="ml-2 text-xs text-muted-foreground">
                    （当前 {appInfo ? `v${appInfo.version}` : "—"}）
                  </span>
                </div>
                {update.body && (
                  <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {update.body}
                  </div>
                )}
              </div>
              <Button size="sm" onClick={installUpdate} disabled={installing}>
                {installing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {installing ? "安装中…" : "下载并重启"}
              </Button>
            </div>
            {installing && progress.total > 0 && (
              <div className="space-y-1">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{
                      width: `${Math.min(100, (progress.downloaded / progress.total) * 100)}%`,
                    }}
                  />
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
                </div>
              </div>
            )}
          </div>
        )}
        {!update && checked && (
          <div className="text-xs text-muted-foreground">✓ 已是最新版本</div>
        )}
      </Section>
    </div>
  );
}
