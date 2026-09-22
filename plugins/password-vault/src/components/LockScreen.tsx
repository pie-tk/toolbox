// 解锁界面：管理密码输入 + 防爆破退避 + 文件损坏错误态 + 从备份恢复入口。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, FolderOpen, KeyRound, Loader2 } from "lucide-react";
import { backoffRemainingMs, getState, replaceWithBackup, subscribe, unlock } from "../vault";
import { isVaultFile, WrongPasswordError } from "../crypto";
import { fmtDateTime, hostToast, inputClass, primaryBtnClass, readFileAsBytes, smallBtnClass } from "../ui";
import { ConfirmDialog } from "./ConfirmDialog";

export function LockScreen() {
  const st = useSyncExternalStore(subscribe, getState);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [restoreBytes, setRestoreBytes] = useState<Uint8Array | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 退避倒计时刷新
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, []);

  const backoff = backoffRemainingMs();
  const damaged = st.error !== null;

  const submit = async (): Promise<void> => {
    if (!pw || busy || backoff > 0) return;
    setBusy(true);
    setErr(null);
    try {
      await unlock(pw);
      // 成功 → 状态机切换视图
    } catch (e) {
      setErr(
        e instanceof WrongPasswordError
          ? `管理密码错误${backoffRemainingMs() > 0 ? `，请等待 ${Math.ceil(backoffRemainingMs() / 1000)} 秒后重试` : ""}`
          : `解锁失败：${String((e as Error)?.message ?? e)}`,
      );
      setPw("");
    } finally {
      setBusy(false);
    }
  };

  const pickRestoreFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const bytes = await readFileAsBytes(file);
      if (!isVaultFile(bytes)) {
        hostToast("所选文件不是保险库备份", "缺少加密参数，无法恢复", "error");
        return;
      }
      setRestoreBytes(bytes);
    } catch (e) {
      hostToast("读取备份文件失败", String((e as Error)?.message ?? e), "error");
    }
  };

  const doRestore = async (): Promise<void> => {
    if (!restoreBytes) return;
    setRestoreBusy(true);
    try {
      await replaceWithBackup(restoreBytes);
      hostToast("备份已恢复", "请使用备份当时的管理密码解锁", "success");
    } catch (e) {
      hostToast("恢复失败", String((e as Error)?.message ?? e), "error");
    } finally {
      setRestoreBusy(false);
      setRestoreBytes(null);
    }
  };

  const meta = st.fileMeta;

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full ${damaged ? "bg-destructive/15" : "bg-primary/15"}`}
          >
            {damaged ? (
              <AlertTriangle className="h-6 w-6 text-destructive" />
            ) : (
              <KeyRound className="h-6 w-6 text-primary" />
            )}
          </div>
          <h2 className="text-base font-semibold">{damaged ? "保险库文件损坏" : "保险库已锁定"}</h2>
          {!damaged && meta && (
            <p className="text-xs text-muted-foreground">
              {meta.entryCount > 0
                ? `${meta.entryCount} 条记录 · 更新于 ${fmtDateTime(meta.updatedAt)}`
                : "空保险库"}
            </p>
          )}
        </div>

        {damaged ? (
          <div className="space-y-4">
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
              {st.error}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              主文件与 .bak 副本均无法解析。为避免数据被覆盖，不会自动重建——请从加密备份恢复。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="password"
              className={inputClass}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="输入管理密码解锁"
              autoFocus
              disabled={backoff > 0}
            />
            {backoff > 0 && (
              <div className="text-xs text-warning">
                连续失败，请等待 {Math.ceil(backoff / 1000)} 秒后重试
              </div>
            )}
            {err && <div className="text-xs text-destructive">{err}</div>}
            <button className={`${primaryBtnClass} w-full`} disabled={!pw || busy || backoff > 0} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "解锁"}
            </button>
          </div>
        )}

        <div className="flex flex-col items-center gap-2 border-t border-border pt-4">
          <button className={`${smallBtnClass} h-7`} onClick={() => fileRef.current?.click()}>
            <FolderOpen className="h-3.5 w-3.5" />
            从加密备份恢复
          </button>
          {st.storageDir && <span className="max-w-full truncate text-[11px] text-muted-foreground">{st.storageDir}</span>}
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void pickRestoreFile(e.target.files?.[0]);
              e.target.value = ""; // 允许重复选同一文件
            }}
          />
        </div>
      </div>

      <ConfirmDialog
        open={restoreBytes !== null}
        title="用备份覆盖当前保险库？"
        description="当前保险库的全部记录将被备份内容替换。恢复后需使用【备份当时】的管理密码解锁。此操作不可撤销。"
        confirmText="覆盖恢复"
        danger
        busy={restoreBusy}
        onConfirm={() => void doRestore()}
        onCancel={() => setRestoreBytes(null)}
      />
    </div>
  );
}
