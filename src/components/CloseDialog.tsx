import { useState } from "react";
import { Check, LogOut, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CloseAction } from "@/store/useSettingsStore";

/** 点击窗口关闭按钮时的询问弹窗：最小化到托盘 / 退出应用，可记住选择。 */
export function CloseDialog({
  onChoose,
  onCancel,
}: {
  onChoose: (action: CloseAction, remember: boolean) => void;
  onCancel: () => void;
}) {
  const [remember, setRemember] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="w-[24rem] space-y-4 rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold">关闭 ToolBox</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              要最小化到系统托盘继续运行，还是直接退出？
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            title="取消"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onChoose("minimize", remember)}
            className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
          >
            <Minimize2 className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-medium">最小化到托盘</div>
              <div className="text-xs text-muted-foreground">后台保持运行</div>
            </div>
          </button>
          <button
            onClick={() => onChoose("exit", remember)}
            className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
          >
            <LogOut className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-medium">退出应用</div>
              <div className="text-xs text-muted-foreground">结束运行并退出</div>
            </div>
          </button>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground">
          <span
            role="checkbox"
            aria-checked={remember}
            tabIndex={0}
            onClick={() => setRemember((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                setRemember((v) => !v);
              }
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded border bg-background transition-colors"
          >
            {remember && <Check className="h-3 w-3 text-primary" />}
          </span>
          记住我的选择（可在 设置 → 关闭行为 中修改）
        </label>
      </div>
    </div>
  );
}
