// 凭据列表：搜索过滤、显隐密码、复制（密码带自动清剪贴板）、编辑/删除。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Monitor,
  Pencil,
  SearchX,
  Trash2,
  User,
} from "lucide-react";
import { deleteEntry, getState, openEdit, subscribe } from "../vault";
import type { VaultEntry } from "../types";
import { filterEntries } from "../match";
import { copyWithAutoClear } from "../clipboard";
import { loadSettings } from "../settings";
import { fmtDateTime, hostToast, iconBtnClass, smallBtnClass } from "../ui";
import { ConfirmDialog } from "./ConfirmDialog";

interface EntryListProps {
  query: string;
  onNew: () => void;
  onImport: () => void;
}

export function EntryList({ query, onNew, onImport }: EntryListProps) {
  const st = useSyncExternalStore(subscribe, getState);
  const entries = st.entries ?? [];
  const filtered = useMemo(() => filterEntries(entries, query), [entries, query]);

  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<{ id: string; kind: "user" | "pass" } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VaultEntry | null>(null);

  // 条目集变化（删除等）后清理悬空状态
  useEffect(() => {
    const ids = new Set(entries.map((e) => e.id));
    setRevealed((s) => new Set(Array.from(s).filter((id) => ids.has(id))));
    setExpanded((s) => new Set(Array.from(s).filter((id) => ids.has(id))));
  }, [entries]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void): void => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const copy = async (entry: VaultEntry, kind: "user" | "pass"): Promise<void> => {
    const text = kind === "user" ? entry.username : entry.password;
    if (!text) {
      hostToast(kind === "user" ? "该记录没有账号" : "该记录没有密码", undefined, "warning");
      return;
    }
    const settings = loadSettings();
    const ok = await copyWithAutoClear(text, kind === "pass" ? settings.clipboardClearSec : 0);
    if (ok) {
      setCopied({ id: entry.id, kind });
      if (kind === "pass" && settings.clipboardClearSec > 0) {
        hostToast("密码已复制", `${settings.clipboardClearSec} 秒后自动清除剪贴板`, "success");
      }
    } else {
      hostToast("复制失败", "剪贴板不可用", "error");
    }
  };

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="max-w-sm space-y-3 rounded-lg border border-border bg-card p-6 text-center">
          <div className="text-sm font-medium">还没有保存任何凭据</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            手动添加，或把 Chrome/Edge 导出的密码 CSV 一次性导入进来。
          </p>
          <div className="flex justify-center gap-2">
            <button className={smallBtnClass} onClick={onNew}>
              手动添加
            </button>
            <button className={smallBtnClass} onClick={onImport}>
              导入浏览器密码
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 p-4">
      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-muted-foreground">
          <SearchX className="h-6 w-6" />
          <span className="text-xs">没有匹配「{query}」的记录（搜索不包含密码字段）</span>
        </div>
      )}

      {filtered.map((e) => {
        const isOpen = expanded.has(e.id);
        const showPw = revealed.has(e.id);
        return (
          <div key={e.id} className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                onClick={() => toggle(expanded, e.id, setExpanded)}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  {e.kind === "web" ? (
                    <Globe className="h-4 w-4 text-primary" />
                  ) : (
                    <Monitor className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{e.username || "(无账号)"}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {showPw ? (
                      <code className="font-mono text-foreground">{e.password}</code>
                    ) : (
                      "••••••••"
                    )}
                  </div>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              <div className="flex shrink-0 items-center">
                <button
                  className={iconBtnClass}
                  title="复制账号"
                  onClick={() => void copy(e, "user")}
                >
                  {copied?.id === e.id && copied.kind === "user" ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  className={iconBtnClass}
                  title="复制密码"
                  onClick={() => void copy(e, "pass")}
                >
                  {copied?.id === e.id && copied.kind === "pass" ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  className={iconBtnClass}
                  title={showPw ? "隐藏密码" : "显示密码"}
                  onClick={() => toggle(revealed, e.id, setRevealed)}
                >
                  {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button className={iconBtnClass} title="编辑" onClick={() => openEdit(e.id)}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  className={`${iconBtnClass} hover:text-destructive`}
                  title="删除"
                  onClick={() => setPendingDelete(e)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-xs text-muted-foreground">
                <div>
                  <span className="mr-2 inline-block w-16">网址</span>
                  <span className="break-all text-foreground">{e.url || "—"}</span>
                </div>
                <div>
                  <span className="mr-2 inline-block w-16">账号</span>
                  <span className="break-all text-foreground">{e.username || "—"}</span>
                </div>
                <div>
                  <span className="mr-2 inline-block w-16">密码</span>
                  <code className="break-all font-mono text-foreground">
                    {showPw ? e.password : "••••••••（点右侧眼睛显示）"}
                  </code>
                </div>
                {e.note && (
                  <div>
                    <span className="mr-2 inline-block w-16 align-top">备注</span>
                    <span className="inline-block break-all whitespace-pre-wrap text-foreground">{e.note}</span>
                  </div>
                )}
                <div className="pt-1 text-[11px]">
                  创建于 {fmtDateTime(e.createdAt)} · 更新于 {fmtDateTime(e.updatedAt)}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`删除「${pendingDelete?.name ?? ""}」？`}
        description={
          <>
            账号 <span className="font-mono">{pendingDelete?.username || "(无)"}</span>
            的凭据将被永久删除，无法恢复。
          </>
        }
        confirmText="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteEntry(pendingDelete.id);
            hostToast("已删除", pendingDelete.name, "success");
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
