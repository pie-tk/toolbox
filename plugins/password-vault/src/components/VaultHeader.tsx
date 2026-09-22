// 顶栏：标题/条数 + 搜索 + 新增/导入/设置/手动锁定。
import { ArrowLeft, KeyRound, Lock, Plus, Search, Settings, Upload } from "lucide-react";
import type { VaultView } from "../types";
import { inputClass, primaryBtnClass, smallBtnClass } from "../ui";

interface VaultHeaderProps {
  view: VaultView;
  count: number;
  query: string;
  onQueryChange: (q: string) => void;
  /** 视图切换统一入口（带脏表单保护）。 */
  onRequestView: (view: VaultView) => void;
  onLock: () => void;
}

export function VaultHeader({ view, count, query, onQueryChange, onRequestView, onLock }: VaultHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        {view !== "list" && (
          <button className={smallBtnClass} title="返回列表" onClick={() => onRequestView("list")}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <KeyRound className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">密码保险库</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{count} 条</span>
      </div>

      <div className="relative ml-auto">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className={`${inputClass} h-8 w-52 pl-8`}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索名称 / 网址 / 账号 / 备注"
        />
      </div>

      <button className={smallBtnClass} onClick={() => onRequestView("import")} title="导入 Chrome/Edge 密码 CSV">
        <Upload className="h-3.5 w-3.5" />
        导入
      </button>
      <button className={smallBtnClass} onClick={() => onRequestView("settings")} title="设置">
        <Settings className="h-3.5 w-3.5" />
      </button>
      <button className={smallBtnClass} onClick={onLock} title="立即锁定">
        <Lock className="h-3.5 w-3.5" />
      </button>
      <button className={`${primaryBtnClass} h-8`} onClick={() => onRequestView("form")}>
        <Plus className="h-4 w-4" />
        新增凭据
      </button>
    </div>
  );
}
