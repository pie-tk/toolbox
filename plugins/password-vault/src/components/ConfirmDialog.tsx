// 通用危险操作确认弹窗：支持"输入指定文本"与"验证管理密码"两档加固。
import { useEffect, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { verifyPassword } from "../vault";
import { dangerBtnClass, inputClass, smallBtnClass } from "../ui";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** 需要输入该文本（如 DELETE）才能确认。 */
  requireText?: string;
  /** 需要输入管理密码并通过验证才能确认。 */
  requirePassword?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  danger = false,
  requireText,
  requirePassword = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setPassword("");
      setPwError(null);
      setChecking(false);
    }
  }, [open]);

  if (!open) return null;

  const textOk = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();

  const handleConfirm = async (): Promise<void> => {
    if (requirePassword) {
      setChecking(true);
      setPwError(null);
      const ok = await verifyPassword(password);
      setChecking(false);
      if (!ok) {
        setPwError("管理密码错误");
        return;
      }
    }
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start gap-3">
          {danger && (
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && (
              <div className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</div>
            )}
          </div>
        </div>

        {requireText && (
          <div className="mt-4 space-y-1.5">
            <label className="text-xs text-muted-foreground">
              输入 <span className="font-mono font-semibold text-foreground">{requireText}</span> 以确认
            </label>
            <input
              className={`${inputClass} font-mono`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              autoFocus
            />
          </div>
        )}

        {requirePassword && (
          <div className="mt-4 space-y-1.5">
            <label className="text-xs text-muted-foreground">当前管理密码</label>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPwError(null);
              }}
              autoFocus={!requireText}
            />
            {pwError && <div className="text-xs text-destructive">{pwError}</div>}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className={smallBtnClass} onClick={onCancel} disabled={busy || checking}>
            取消
          </button>
          <button
            className={danger ? dangerBtnClass : smallBtnClass}
            onClick={() => void handleConfirm()}
            disabled={busy || checking || !textOk || (requirePassword && !password)}
          >
            {checking ? "验证中…" : busy ? "处理中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
