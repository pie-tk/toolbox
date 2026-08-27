import { AlertTriangle } from "lucide-react";
import { Button } from "./ui/button";
import { useConfirmStore } from "@/store/useConfirmStore";

/** App-global confirmation dialog driven by the confirm store. */
export function ConfirmDialog() {
  const open = useConfirmStore((s) => s.open);
  const options = useConfirmStore((s) => s.options);
  const close = useConfirmStore((s) => s.close);
  if (!open) return null;
  const destructive = options.destructive;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in"
      onClick={() => close(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          )}
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">
              {options.title}
            </h3>
            {options.description && (
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                {options.description}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => close(false)}>
            {options.cancelText ?? "取消"}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={() => close(true)}
          >
            {options.confirmText ?? "确定"}
          </Button>
        </div>
      </div>
    </div>
  );
}
