// 设置面板：锁定策略、修改管理密码、备份/恢复/明文导出、删除保险库、安全说明。
import { useRef, useState, useSyncExternalStore } from "react";
import {
  DatabaseBackup,
  Download,
  FileWarning,
  FolderOpen,
  KeyRound,
  Loader2,
  Merge,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import {
  changeMaster,
  destroyVault,
  exportBackup,
  exportPlainCsv,
  getState,
  mergeBackup,
  replaceWithBackup,
  subscribe,
  verifyPassword,
} from "../vault";
import { isVaultFile } from "../crypto";
import { AUTO_LOCK_CHOICES_READONLY, CLIPBOARD_CHOICES_READONLY, loadSettings, saveSettings } from "../settings";
import type { VaultSettings } from "../types";
import {
  cardClass,
  hostToast,
  inputClass,
  primaryBtnClass,
  readFileAsBytes,
  smallBtnClass,
  subtleTextClass,
} from "../ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { StrengthMeter } from "./StrengthMeter";

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} p-5`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

const selectClass = `${inputClass} h-8 w-auto`;

export function SettingsPanel() {
  const st = useSyncExternalStore(subscribe, getState);

  /* ---- 锁定与剪贴板设置 ---- */
  const [settings, setSettings] = useState<VaultSettings>(() => loadSettings());
  const updateSetting = (patch: Partial<VaultSettings>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  /* ---- 修改管理密码 ---- */
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const submitChangePw = async (): Promise<void> => {
    setPwError(null);
    if (newPw.length < 8) {
      setPwError("新密码至少 8 个字符");
      return;
    }
    if (newPw !== newPw2) {
      setPwError("两次输入的新密码不一致");
      return;
    }
    setPwBusy(true);
    try {
      if (!(await verifyPassword(curPw))) {
        setPwError("当前管理密码错误");
        return;
      }
      await changeMaster(newPw);
      setCurPw("");
      setNewPw("");
      setNewPw2("");
      hostToast("管理密码已修改", "旧备份仍需旧密码解锁，建议立即导出新备份", "success");
    } catch (e) {
      setPwError(`修改失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setPwBusy(false);
    }
  };

  /* ---- 备份 / 恢复 ---- */
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const doBackup = async (): Promise<void> => {
    setBackupBusy(true);
    try {
      setBackupPath(await exportBackup());
      hostToast("加密备份已导出", undefined, "success");
    } catch (e) {
      hostToast("备份失败", String((e as Error)?.message ?? e), "error");
    } finally {
      setBackupBusy(false);
    }
  };

  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceBytes, setReplaceBytes] = useState<Uint8Array | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const pickRestoreFile = async (file: File | undefined): Promise<Uint8Array | null> => {
    if (!file) return null;
    const bytes = await readFileAsBytes(file);
    if (!isVaultFile(bytes)) {
      hostToast("所选文件不是保险库备份", "缺少加密参数", "error");
      return null;
    }
    return bytes;
  };

  const mergeRef = useRef<HTMLInputElement>(null);
  const [mergeFile, setMergeFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [mergePw, setMergePw] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);

  const doMerge = async (): Promise<void> => {
    if (!mergeFile) return;
    setMergeBusy(true);
    try {
      const { added, updated, keptCurrent } = await mergeBackup(mergeFile.bytes, mergePw);
      hostToast("合并完成", `新增 ${added}，更新 ${updated}，保留现有 ${keptCurrent}`, "success");
      setMergeFile(null);
      setMergePw("");
    } catch (e) {
      hostToast("合并失败", String((e as Error)?.message ?? e), "error");
    } finally {
      setMergeBusy(false);
    }
  };

  /* ---- 明文 CSV 导出 ---- */
  const [plainAck, setPlainAck] = useState(false);
  const [plainPw, setPlainPw] = useState("");
  const [plainBusy, setPlainBusy] = useState(false);
  const [plainPath, setPlainPath] = useState<string | null>(null);
  const doPlainExport = async (): Promise<void> => {
    setPlainBusy(true);
    try {
      if (!(await verifyPassword(plainPw))) {
        hostToast("管理密码错误", "已取消导出", "error");
        return;
      }
      setPlainPath(await exportPlainCsv());
      hostToast("明文 CSV 已导出", "请及时转移并删除该文件", "warning");
    } catch (e) {
      hostToast("导出失败", String((e as Error)?.message ?? e), "error");
    } finally {
      setPlainBusy(false);
    }
  };

  /* ---- 删除保险库 ---- */
  const [confirmDestroy, setConfirmDestroy] = useState(false);
  const [destroyBusy, setDestroyBusy] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      {/* 锁定与剪贴板 */}
      <Section icon={<ShieldAlert className="h-4 w-4" />} title="安全设置">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs">闲置自动锁定</span>
          <select
            className={selectClass}
            value={settings.autoLockMinutes}
            onChange={(e) => updateSetting({ autoLockMinutes: Number(e.target.value) })}
          >
            {AUTO_LOCK_CHOICES_READONLY.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "永不" : `${m} 分钟`}
              </option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-xs">离开工具页立即锁定（推荐）</span>
          <input
            type="checkbox"
            checked={settings.lockOnLeave}
            onChange={(e) => updateSetting({ lockOnLeave: e.target.checked })}
            className="h-4 w-4 accent-[hsl(var(--primary))]"
          />
        </label>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs">复制密码后自动清剪贴板</span>
          <select
            className={selectClass}
            value={settings.clipboardClearSec}
            onChange={(e) => updateSetting({ clipboardClearSec: Number(e.target.value) })}
          >
            {CLIPBOARD_CHOICES_READONLY.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? "不清除" : `${s} 秒`}
              </option>
            ))}
          </select>
        </div>
        <p className={subtleTextClass}>
          自动清除是尽力而为：若期间窗口失焦导致无法读取剪贴板，会跳过本次清除（不会覆盖你后来复制的内容）。
        </p>
      </Section>

      {/* 修改管理密码 */}
      <Section icon={<KeyRound className="h-4 w-4" />} title="修改管理密码">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">当前管理密码</label>
            <input type="password" className={inputClass} value={curPw} onChange={(e) => { setCurPw(e.target.value); setPwError(null); }} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">新密码</label>
              <input type="password" className={inputClass} value={newPw} onChange={(e) => { setNewPw(e.target.value); setPwError(null); }} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">确认新密码</label>
              <input type="password" className={inputClass} value={newPw2} onChange={(e) => { setNewPw2(e.target.value); setPwError(null); }} />
            </div>
          </div>
          <StrengthMeter password={newPw} />
          {pwError && <div className="text-xs text-destructive">{pwError}</div>}
          <div className="flex justify-end">
            <button
              className={primaryBtnClass}
              disabled={pwBusy || !curPw || !newPw || !newPw2}
              onClick={() => void submitChangePw()}
            >
              {pwBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              修改密码
            </button>
          </div>
        </div>
      </Section>

      {/* 备份与恢复 */}
      <Section icon={<DatabaseBackup className="h-4 w-4" />} title="备份与恢复">
        <div className="flex flex-wrap items-center gap-2">
          <button className={smallBtnClass} onClick={() => void doBackup()} disabled={backupBusy}>
            {backupBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            导出加密备份
          </button>
          <button className={smallBtnClass} onClick={() => replaceRef.current?.click()}>
            <FolderOpen className="h-3.5 w-3.5" />
            从备份恢复（覆盖）
          </button>
          <button className={smallBtnClass} onClick={() => mergeRef.current?.click()}>
            <Merge className="h-3.5 w-3.5" />
            从备份合并
          </button>
          <span className={subtleTextClass}>加密备份 = 完整密文副本，需管理密码才能打开</span>
        </div>
        {backupPath && (
          <div className="break-all rounded-md border border-border bg-background/50 px-3 py-2 text-xs">
            <span className="text-muted-foreground">备份已写入：</span>
            <code className="font-mono">{backupPath}</code>
            <button
              className={`${smallBtnClass} ml-2 h-6`}
              onClick={() => void navigator.clipboard.writeText(backupPath).then(() => hostToast("路径已复制", undefined, "success"))}
            >
              复制路径
            </button>
          </div>
        )}

        {mergeFile && (
          <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
            <div className="text-xs">
              合并 <span className="font-medium">{mergeFile.name}</span>（同账号取较新者，不会删除现有记录）
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                className={inputClass}
                placeholder="该备份当时的管理密码"
                value={mergePw}
                onChange={(e) => setMergePw(e.target.value)}
              />
              <button className={primaryBtnClass} disabled={mergeBusy || !mergePw} onClick={() => void doMerge()}>
                {mergeBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                执行合并
              </button>
              <button className={smallBtnClass} onClick={() => { setMergeFile(null); setMergePw(""); }}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 明文导出（最大泄漏面 → 双确认） */}
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-warning">
            <FileWarning className="h-4 w-4" />
            明文 CSV 导出（不加密，任何拿到文件的人都能看到密码）
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={plainAck}
              onChange={(e) => setPlainAck(e.target.checked)}
              className="accent-[hsl(var(--primary))]"
            />
            我知晓导出文件是明文的，导出后会及时删除
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              className={inputClass}
              placeholder="输入管理密码确认"
              value={plainPw}
              onChange={(e) => setPlainPw(e.target.value)}
              disabled={!plainAck}
            />
            <button
              className={smallBtnClass}
              disabled={!plainAck || !plainPw || plainBusy}
              onClick={() => void doPlainExport()}
            >
              {plainBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              导出
            </button>
          </div>
          {plainPath && (
            <div className="break-all text-xs">
              <span className="text-muted-foreground">已写入：</span>
              <code className="font-mono">{plainPath}</code>
            </div>
          )}
        </div>

        <input
          ref={replaceRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void (async () => {
              const bytes = await pickRestoreFile(e.target.files?.[0]);
              if (bytes) setReplaceBytes(bytes);
            })();
            e.target.value = "";
          }}
        />
        <input
          ref={mergeRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void (async () => {
              const f = e.target.files?.[0];
              if (!f) return;
              const bytes = await pickRestoreFile(f);
              if (bytes) setMergeFile({ name: f.name, bytes });
            })();
            e.target.value = "";
          }}
        />
      </Section>

      {/* 数据与危险操作 */}
      <Section icon={<Trash2 className="h-4 w-4" />} title="数据">
        <div className="text-xs">
          <span className="text-muted-foreground">存储位置：</span>
          <code className="break-all font-mono">{st.storageDir || "(浏览器模式)"}</code>
          {st.storageMode === "fs" && (
            <button
              className={`${smallBtnClass} ml-2 h-6`}
              onClick={() => void navigator.clipboard.writeText(st.storageDir).then(() => hostToast("路径已复制", undefined, "success"))}
            >
              复制
            </button>
          )}
        </div>
        <p className={subtleTextClass}>
          {st.storageMode === "fs"
            ? "vault.json 主文件 + .bak 副本 + backup/ 加密备份都在该目录。整机同步/备份软件会带走这些密文文件（可接受），但请勿把该目录放进网盘明文分享。"
            : "当前为浏览器开发模式，数据仅存于本页 localStorage。"}
        </p>
        <div className="flex justify-start border-t border-border pt-4">
          <button
            className={`${smallBtnClass} border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive`}
            onClick={() => setConfirmDestroy(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除保险库全部数据
          </button>
        </div>
      </Section>

      {/* 安全与威胁模型说明 */}
      <details className={`${cardClass} p-5`}>
        <summary className="cursor-pointer text-sm font-semibold">安全与威胁模型说明</summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            凭据以 AES-256-GCM 加密，密钥由管理密码经 PBKDF2-SHA256（600,000 次迭代）派生，
            不落盘、不上传。本保险库防护的是「密文文件被拷走后的离线窃取」。
          </p>
          <p>
            它<b>不能</b>防护：已植入本机的恶意软件（可读内存、记录键盘，任何本地密码管理器皆然），
            以及同宿主内其他恶意插件（宿主文件原语当前无逐插件沙箱）。解锁期间明文与密钥存在于内存中，
            锁定后仅解除引用等待回收，无法主动擦零。
          </p>
          <p>
            剪贴板对前台程序可见，自动清除是尽力而为。文件外层的条数与更新时间未加密（锁定页展示用）。
            管理密码忘记 = 数据永久无法恢复，请定期导出加密备份并妥善保存。
          </p>
        </div>
      </details>

      <ConfirmDialog
        open={replaceBytes !== null}
        title="用备份覆盖当前保险库？"
        description={`当前 ${st.entries?.length ?? 0} 条记录将被备份内容替换，恢复后需使用【备份当时】的管理密码解锁。此操作不可撤销。`}
        confirmText="覆盖恢复"
        danger
        busy={replaceBusy}
        onCancel={() => setReplaceBytes(null)}
        onConfirm={() => {
          void (async () => {
            if (!replaceBytes) return;
            setReplaceBusy(true);
            try {
              await replaceWithBackup(replaceBytes);
              hostToast("备份已恢复", "请用备份当时的管理密码解锁", "success");
            } catch (e) {
              hostToast("恢复失败", String((e as Error)?.message ?? e), "error");
            } finally {
              setReplaceBusy(false);
              setReplaceBytes(null);
            }
          })();
        }}
      />

      <ConfirmDialog
        open={confirmDestroy}
        title="删除保险库全部数据？"
        description="将删除全部凭据、加密备份文件（backup/ 目录）与 .bak 副本。明文导出的 CSV 不会被删除。此操作不可撤销。"
        confirmText="永久删除"
        danger
        requirePassword
        requireText="DELETE"
        busy={destroyBusy}
        onCancel={() => setConfirmDestroy(false)}
        onConfirm={() => {
          void (async () => {
            setDestroyBusy(true);
            try {
              await destroyVault();
              hostToast("保险库已删除", "可重新设置管理密码", "success");
            } catch (e) {
              hostToast("删除失败", String((e as Error)?.message ?? e), "error");
            } finally {
              setDestroyBusy(false);
              setConfirmDestroy(false);
            }
          })();
        }}
      />
    </div>
  );
}
