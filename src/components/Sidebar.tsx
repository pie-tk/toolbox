import { useEffect, useState, type ComponentType } from "react";
import { Home, Moon, Settings, Store, Sun, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAppInfo } from "@/lib/tauri";
import { unmetRequires } from "@/lib/plugins";
import { useAppStore } from "@/store/useAppStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useThemeStore } from "@/store/useThemeStore";
import { useToolsStore } from "@/store/useToolsStore";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/types/tool";

/** 左侧导航：入口页 + 按分类分组的已安装工具（宽度可拖拽调整）。 */
export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const openHome = useAppStore((s) => s.openHome);
  const openMarketplace = useAppStore((s) => s.openMarketplace);
  const openSettings = useAppStore((s) => s.openSettings);
  const openTool = useAppStore((s) => s.openTool);
  const width = useSettingsStore((s) => s.sidebarWidth);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const metas = useToolsStore((s) => s.metas);
  const capabilities = useToolsStore((s) => s.capabilities);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    getAppInfo().then((info) => info && setVersion(info.version));
  }, []);

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    tools: metas.filter((t) => t.category === category),
  })).filter((g) => g.tools.length > 0);

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-r bg-card transition-[width] duration-0"
    >
      <div className="flex items-center gap-3 px-4 pb-4 pt-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Wrench className="h-5 w-5" />
        </div>
        <div className="truncate text-sm font-semibold leading-tight">ToolBox</div>
      </div>

      <nav className="space-y-1 px-2">
        <SidebarItem
          icon={Home}
          label="首页"
          active={view.type === "home"}
          onClick={openHome}
        />
        <SidebarItem
          icon={Store}
          label="工具市场"
          active={view.type === "marketplace"}
          onClick={openMarketplace}
        />
        <SidebarItem
          icon={Settings}
          label="设置"
          active={view.type === "settings"}
          onClick={openSettings}
        />
      </nav>

      <div className="mt-4 flex-1 overflow-y-auto px-2 scrollbar-thin">
        {groups.length > 0 && (
          <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
            全部工具
          </div>
        )}
        {groups.map((group) => (
          <div key={group.category} className="mb-2">
            <div className="px-2 pb-1 text-[11px] tracking-wide text-muted-foreground/70">
              {CATEGORY_LABELS[group.category]}
            </div>
            {group.tools.map((meta) => {
              const unmet = unmetRequires(meta.requires, capabilities);
              return (
                <SidebarItem
                  key={meta.id}
                  icon={meta.icon}
                  label={meta.name}
                  active={view.type === "tool" && view.toolId === meta.id}
                  disabled={unmet.length > 0}
                  title={unmet.length > 0 ? "依赖能力未就绪，点击市场页修复" : undefined}
                  onClick={() => openTool(meta.id)}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t p-2">
        <SidebarItem
          icon={theme === "dark" ? Sun : Moon}
          label={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
          active={false}
          onClick={toggleTheme}
        />
        <div className="px-2 pb-1 pt-2 text-xs text-muted-foreground">
          {version ? `ToolBox v${version}` : "ToolBox"}
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
