// 首次使用：设置管理密码并创建保险库。
import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { setupVault } from "../vault";
import { hostToast, inputClass, primaryBtnClass } from "../ui";
import { StrengthMeter } from "./StrengthMeter";

const MIN_LEN = 8;

export function SetupScreen() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = pw.length >= MIN_LEN && pw === pw2 && !busy;

  const submit = async (): Promise<void> => {
    if (pw.length < MIN_LEN) {
      setError(`管理密码至少 ${MIN_LEN} 个字符`);
      return;
    }
    if (pw !== pw2) {
      setError("两次输入不一致");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setupVault(pw);
      hostToast("保险库已创建", "请牢记管理密码——它无法找回，忘记即数据不可恢复", "success");
    } catch (e) {
      setError(`创建失败：${String((e as Error)?.message ?? e)}`);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-md space-y-5 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-base font-semibold">创建密码保险库</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            所有凭据以 AES-256-GCM 加密保存在本机，不上传任何服务器。
            管理密码不会存储，也无法找回——忘记即数据不可恢复。
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">管理密码</label>
            <input
              type="password"
              className={inputClass}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setError(null);
              }}
              placeholder={`至少 ${MIN_LEN} 个字符`}
              autoFocus
            />
          </div>
          <StrengthMeter password={pw} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium">确认管理密码</label>
            <input
              type="password"
              className={inputClass}
              value={pw2}
              onChange={(e) => {
                setPw2(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) void submit();
              }}
              placeholder="再输入一次"
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <button className={`${primaryBtnClass} w-full`} disabled={!valid} onClick={() => void submit()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "创建保险库"}
        </button>

        <div className="flex items-start gap-2 rounded-md border border-border bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <div>
            建议管理密码不要与任何已保存的账号密码相同；创建后可在"设置"中导出加密备份，
            以防文件损坏或意外删除。
          </div>
        </div>
      </div>
    </div>
  );
}
