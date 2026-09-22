// Chrome/Edge 密码 CSV 导入：选文件 → 解析 → 去重预览（新增/重复/无效）→ 批量导入。
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { getState, importEntries, subscribe } from "../vault";
import { parseBrowserExport, parseCsv } from "../csv";
import { classifyImport, normalizeHost } from "../match";
import type { ImportedEntry, VaultEntry } from "../types";
import { hostToast, readFileAsBytes, smallBtnClass, primaryBtnClass, subtleTextClass } from "../ui";

interface ImportCsvProps {
  onDone: () => void;
}

interface Preview {
  fresh: ImportedEntry[];
  dups: Array<{ existing: VaultEntry; incoming: ImportedEntry }>;
  skipped: Array<{ line: number; reason: string }>;
  warnings: string[];
}

export function ImportCsv({ onDone }: ImportCsvProps) {
  const st = useSyncExternalStore(subscribe, getState);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [freshSel, setFreshSel] = useState<Set<number>>(new Set());
  const [overSel, setOverSel] = useState<Set<string>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);

  const load = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setError(null);
    setPreview(null);
    setBusy(true);
    try {
      const bytes = await readFileAsBytes(file);
      const text = new TextDecoder().decode(bytes);
      const { rows, warnings } = parseCsv(text);
      const parsed = parseBrowserExport(rows);
      const { fresh, dups } = classifyImport(st.entries ?? [], parsed.entries);
      setPreview({ fresh, dups, skipped: parsed.skipped, warnings });
      setFreshSel(new Set(fresh.map((_, i) => i)));
      setOverSel(new Set());
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    if (!preview) return { addN: 0, updN: 0 };
    return { addN: freshSel.size, updN: overSel.size };
  }, [preview, freshSel, overSel]);

  const confirmImport = (): void => {
    if (!preview || totals.addN + totals.updN === 0) return;
    const fresh = preview.fresh.filter((_, i) => freshSel.has(i));
    const overwrites = preview.dups
      .filter((d) => overSel.has(d.existing.id))
      .map((d) => ({ existingId: d.existing.id, data: d.incoming }));
    const { added, updated } = importEntries(fresh, overwrites);
    const skippedN = preview.skipped.length + (preview.fresh.length - fresh.length) + (preview.dups.length - overwrites.length);
    hostToast("导入完成", `新增 ${added} 条，更新 ${updated} 条，跳过 ${skippedN} 条`, "success");
    onDone();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">导入浏览器密码</h2>
        <span className={subtleTextClass}>支持 Chrome / Edge 导出的密码 CSV</span>
      </div>

      {/* 第一步：选文件 */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          在 Chrome/Edge 的「设置 → 密码 → 导出密码」中保存 CSV 文件后，在此选择该文件。
          文件在导入后不会被保留，可立即删除。
        </p>
        <button className={`${smallBtnClass} h-9`} onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          选择 CSV 文件
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            void load(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* 第二步：预览 */}
      {preview && (
        <div className="space-y-4">
          {preview.warnings.map((w) => (
            <div key={w} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {w}
            </div>
          ))}

          {preview.fresh.length > 0 && (
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="text-xs font-medium">新增（{freshSel.size}/{preview.fresh.length}）</span>
                <button
                  className={smallBtnClass}
                  onClick={() =>
                    setFreshSel(freshSel.size === preview.fresh.length ? new Set() : new Set(preview.fresh.map((_, i) => i)))
                  }
                >
                  {freshSel.size === preview.fresh.length ? "全不选" : "全选"}
                </button>
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {preview.fresh.map((d, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2 text-xs">
                    <input
                      type="checkbox"
                      checked={freshSel.has(i)}
                      onChange={() => {
                        const next = new Set(freshSel);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        setFreshSel(next);
                      }}
                      className="accent-[hsl(var(--primary))]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.name}</div>
                      <div className="truncate text-muted-foreground">
                        {d.username}
                        {d.url ? ` · ${normalizeHost(d.url) || d.url}` : " · 应用"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.dups.length > 0 && (
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-2.5 text-xs font-medium">
                与已有记录重复（{preview.dups.length}）——勾选「覆盖」才会更新
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {preview.dups.map(({ existing, incoming }) => {
                  const id = existing.id;
                  const pwChanged = incoming.password !== existing.password;
                  return (
                    <li key={id} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <input
                        type="checkbox"
                        checked={overSel.has(id)}
                        onChange={() => {
                          const next = new Set(overSel);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          setOverSel(next);
                        }}
                        className="accent-[hsl(var(--primary))]"
                        title="用导入内容覆盖现有记录"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{incoming.name}</div>
                        <div className="truncate text-muted-foreground">
                          {incoming.username}
                          {pwChanged ? " · 密码不同" : " · 密码相同"}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">覆盖</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {preview.skipped.length > 0 && (
            <div className="rounded-lg border border-border bg-card px-4 py-2.5 text-xs">
              <button className="text-muted-foreground" onClick={() => setShowSkipped((v) => !v)}>
                无效行 {preview.skipped.length} 条{showSkipped ? " ▴" : " ▾"}
              </button>
              {showSkipped && (
                <ul className="mt-2 space-y-0.5 text-muted-foreground">
                  {preview.skipped.map((s) => (
                    <li key={s.line}>
                      第 {s.line} 行：{s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button className={smallBtnClass} onClick={onDone}>
              取消
            </button>
            <button className={primaryBtnClass} disabled={totals.addN + totals.updN === 0} onClick={confirmImport}>
              导入（新增 {totals.addN} · 更新 {totals.updN}）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
