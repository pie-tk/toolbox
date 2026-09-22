// 新增/编辑凭据表单：含"该网站已有记录"提示、生成器、强度条、脏表单保护。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Trash2, Wand2 } from "lucide-react";
import { getState, subscribe, addEntry, deleteEntry, openEdit, updateEntry } from "../vault";
import type { VaultEntry } from "../types";
import { findSimilar, normalizeHost } from "../match";
import { hostToast, inputClass, primaryBtnClass, smallBtnClass, setFormDirty } from "../ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { DuplicateHint } from "./DuplicateHint";
import { GeneratorPanel } from "./GeneratorPanel";
import { StrengthMeter } from "./StrengthMeter";

interface Draft {
  name: string;
  kind: "web" | "app";
  url: string;
  username: string;
  password: string;
  note: string;
}

const EMPTY_DRAFT: Draft = { name: "", kind: "web", url: "", username: "", password: "", note: "" };

function draftFromEntry(e: VaultEntry): Draft {
  return { name: e.name, kind: e.kind, url: e.url, username: e.username, password: e.password, note: e.note };
}

interface EntryFormProps {
  onBack: () => void;
}

export function EntryForm({ onBack }: EntryFormProps) {
  const st = useSyncExternalStore(subscribe, getState);
  const editing = st.entries?.find((e) => e.id === st.editingId) ?? null;

  const [draft, setDraft] = useState<Draft>(() => (editing ? draftFromEntry(editing) : { ...EMPTY_DRAFT }));
  const [initialJson, setInitialJson] = useState(() => JSON.stringify(editing ? draftFromEntry(editing) : EMPTY_DRAFT));
  const [showPw, setShowPw] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLoad, setConfirmLoad] = useState<VaultEntry | null>(null);

  // 切换编辑目标（含 DuplicateHint 载入、表单内点"新增"）→ 重新初始化 draft
  useEffect(() => {
    const e = st.entries?.find((x) => x.id === st.editingId);
    const next = e ? draftFromEntry(e) : { ...EMPTY_DRAFT };
    setDraft(next);
    setInitialJson(JSON.stringify(next));
    setErrors([]);
  }, [st.editingId]);

  // 脏标记：与初始值比对（空表单返回不算"未保存修改"）
  useEffect(() => {
    setFormDirty(JSON.stringify(draft) !== initialJson);
  }, [draft, initialJson]);

  // URL / 名称防抖 → 重复提示
  const [debouncedUrl, setDebouncedUrl] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedUrl(draft.url);
      setDebouncedName(draft.name);
    }, 300);
    return () => window.clearTimeout(t);
  }, [draft.url, draft.name]);

  const similar = useMemo(
    () =>
      findSimilar(st.entries ?? [], {
        host: normalizeHost(debouncedUrl),
        nameKey: debouncedName,
        excludeId: st.editingId,
      }),
    [st.entries, debouncedUrl, debouncedName, st.editingId],
  );

  const patch = (p: Partial<Draft>): void => setDraft((d) => ({ ...d, ...p }));

  const save = (): void => {
    const errs: string[] = [];
    if (!draft.name.trim()) errs.push("名称不能为空");
    if (draft.kind === "web" && !draft.url.trim()) errs.push("网址不能为空（应用类型可留空）");
    if (!draft.password) errs.push("密码不能为空");
    setErrors(errs);
    if (errs.length > 0) return;
    const data = {
      name: draft.name.trim(),
      kind: draft.kind,
      url: draft.url.trim(),
      username: draft.username.trim(),
      password: draft.password,
      note: draft.note.trim(),
    };
    if (editing) {
      updateEntry(editing.id, data);
      hostToast("已保存修改", data.name, "success");
    } else {
      addEntry(data);
      hostToast("已添加凭据", data.name, "success");
    }
    setFormDirty(false);
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{editing ? "编辑凭据" : "新增凭据"}</h2>
        {editing && (
          <button
            className={`${smallBtnClass} border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        )}
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        {/* 类型切换 */}
        <div className="flex gap-2">
          {(["web", "app"] as const).map((k) => (
            <button
              key={k}
              className={`${smallBtnClass} ${draft.kind === k ? "border-primary/60 bg-primary/10 text-primary" : ""}`}
              onClick={() => patch({ kind: k })}
            >
              {k === "web" ? "网站" : "应用"}
            </button>
          ))}
          <span className="self-center text-xs text-muted-foreground">
            {draft.kind === "web" ? "浏览器里登录的网站" : "桌面/手机应用"}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">名称 *</label>
            <input
              className={inputClass}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={draft.kind === "web" ? "如 GitHub" : "如 微信"}
              autoFocus={!editing}
            />
          </div>
          {draft.kind === "web" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">网址 *</label>
              <input
                className={inputClass}
                value={draft.url}
                onChange={(e) => patch({ url: e.target.value })}
                placeholder="如 github.com"
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">网址（可选）</label>
              <input
                className={inputClass}
                value={draft.url}
                onChange={(e) => patch({ url: e.target.value })}
                placeholder="留空"
              />
            </div>
          )}
        </div>

        {/* 重复提示（名称/网址输入后 300ms 出现） */}
        <DuplicateHint
          similar={similar}
          editing={editing !== null}
          onLoad={(e) => setConfirmLoad(e)}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium">账号</label>
          <input
            className={inputClass}
            value={draft.username}
            onChange={(e) => patch({ username: e.target.value })}
            placeholder="用户名 / 邮箱 / 手机号（可选）"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">密码 *</label>
            <div className="flex items-center gap-1">
              <button
                className={smallBtnClass}
                onClick={() => setShowGen((v) => !v)}
                title="密码生成器"
              >
                <Wand2 className="h-3.5 w-3.5" />
                生成器
              </button>
              <button
                className={smallBtnClass}
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? "隐藏密码" : "显示密码"}
              >
                {showPw ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <input
            type={showPw ? "text" : "password"}
            className={`${inputClass} font-mono`}
            value={draft.password}
            onChange={(e) => patch({ password: e.target.value })}
            placeholder="输入或生成密码"
          />
          <StrengthMeter password={draft.password} />
        </div>

        {showGen && (
          <GeneratorPanel
            onUse={(pw) => {
              patch({ password: pw });
              setShowPw(true);
            }}
          />
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium">备注</label>
          <textarea
            className={`${inputClass} h-20 resize-none py-2`}
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
            placeholder="如：安全问题答案、恢复码（可选）"
          />
        </div>

        {errors.length > 0 && (
          <ul className="space-y-0.5 text-xs text-destructive">
            {errors.map((e) => (
              <li key={e}>· {e}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button
            className={smallBtnClass}
            onClick={() => {
              setFormDirty(false);
              onBack();
            }}
          >
            取消
          </button>
          <button className={primaryBtnClass} onClick={save}>
            {editing ? "保存修改" : "添加"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`删除「${draft.name || "未命名"}」？`}
        description="该凭据将被永久删除，无法恢复。"
        confirmText="删除"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (editing) deleteEntry(editing.id);
          setFormDirty(false);
          setConfirmDelete(false);
          hostToast("已删除", draft.name, "success");
        }}
      />

      <ConfirmDialog
        open={confirmLoad !== null}
        title={`载入「${confirmLoad?.name ?? ""}」编辑？`}
        description="当前表单未保存的内容将被丢弃，切换为编辑该已有记录。"
        confirmText="载入编辑"
        onCancel={() => setConfirmLoad(null)}
        onConfirm={() => {
          if (confirmLoad) {
            setFormDirty(false);
            openEdit(confirmLoad.id);
          }
          setConfirmLoad(null);
        }}
      />
    </div>
  );
}
