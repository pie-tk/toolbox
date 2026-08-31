/**
 * GLM Key 测试插件（自包含模块，不依赖宿主运行时代码）。
 * 输入智谱 Coding Plan Key → 发起最简对话 → 展示回复；支持按间隔定时自动测试。
 * 样式使用 Tailwind 类 + 宿主 CSS 变量，主题自动跟随宿主。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarClock,
  CheckCircle2,
  Eraser,
  History,
  Hourglass,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plus,
  Timer,
  X,
  XCircle,
} from "lucide-react";
import {
  DEFAULT_MODEL,
  MODEL_PRESETS,
  PROTOCOLS,
  PROTOCOL_LABELS,
  type KeyEntry,
  type Protocol,
  nextKeyName,
  normalizeTime,
  nextOccurrence,
  parseTimeOfDay,
  runTest,
  type StoredConfig,
  type TestRecord,
  loadConfig,
  saveConfig,
} from "./core";

/* ---- 小组件 ---- */

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const smallBtnClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 select-none";

const primaryBtnClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 select-none";

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 text-card-foreground">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function maskKey(key: string): string {
  if (key.length <= 10) return key.slice(0, 2) + "***";
  return `${key.slice(0, 6)}***${key.slice(-4)}`;
}

/** 单行 key 编辑：名称点击后变为输入框；本体为 password 输入。 */
function KeyRow({
  entry,
  canDelete,
  onChange,
  onDelete,
}: {
  entry: KeyEntry;
  canDelete: boolean;
  onChange: (next: KeyEntry) => void;
  onDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(entry.name);
  useEffect(() => setDraftName(entry.name), [entry.name]);

  const commitName = () => {
    setEditingName(false);
    const name = draftName.trim();
    if (name && name !== entry.name) onChange({ ...entry, name });
  };

  return (
    <div className="flex items-center gap-2">
      {editingName ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") {
              setDraftName(entry.name);
              setEditingName(false);
            }
          }}
          className="h-9 w-24 shrink-0 rounded-md border border-input bg-background px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <button
          onClick={() => setEditingName(true)}
          title="点击修改名称"
          className="flex h-9 w-24 shrink-0 items-center justify-between gap-1 rounded-md border border-dashed px-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <span className="truncate">{entry.name}</span>
          <Pencil className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      )}
      <input
        type="password"
        autoComplete="off"
        value={entry.key}
        onChange={(e) => onChange({ ...entry, key: e.target.value })}
        placeholder="粘贴智谱 Coding Plan API Key"
        className={`min-w-0 flex-1 font-mono ${inputClass}`}
      />
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {entry.key.trim() ? maskKey(entry.key) : "未填写"}
      </span>
      {canDelete && (
        <button
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          title="删除该 Key"
          onClick={onDelete}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

function ResultView({ record }: { record: TestRecord }) {
  if (record.ok) {
    return (
      <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Key 可用</span>
          <span className="text-xs font-normal text-muted-foreground">
            {record.model} · {PROTOCOL_LABELS[record.protocol]} · {record.elapsedMs} ms
            {record.usage?.totalTokens !== undefined &&
              ` · ${record.usage.totalTokens} tokens`}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-all text-sm">{record.reply}</div>
      </div>
    );
  }
  const limited = record.limited === true;
  return (
    <div
      className={
        limited
          ? "space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400"
          : "space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      }
    >
      <div className="flex items-center gap-2 font-medium">
        {limited ? (
          <Hourglass className="h-4 w-4 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0" />
        )}
        <span>{limited ? "Key 有效，但已触发限额" : "测试失败"}</span>
        <span className="text-xs font-normal opacity-80">
          {record.model} · {record.elapsedMs} ms
        </span>
      </div>
      <div className="break-all font-mono text-xs opacity-90">{record.error}</div>
      {limited && (
        <div className="text-xs opacity-80">
          认证已通过，说明 Key 本身有效；等限额重置后再测即可正常对话。
        </div>
      )}
    </div>
  );
}

/* ---- 主界面 ---- */

function GlmKeyTestTool() {
  const [cfg, setCfg] = useState<StoredConfig>(() => loadConfig());
  const [testing, setTesting] = useState(false);
  const [last, setLast] = useState<TestRecord | null>(
    () => loadConfig().history[0] ?? null
  );
  /** 下次定时触发时间（epoch ms）；null = 未启用。 */
  const [nextAt, setNextAt] = useState<number | null>(null);

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const testingRef = useRef(testing);
  testingRef.current = testing;
  /** 定时回调需要最新版 cfg/testing，但 interval 只建一次 → 经 ref 转发。 */

  const update = useCallback((patch: Partial<StoredConfig>) => {
    setCfg((prev) => {
      const next = { ...prev, ...patch };
      saveConfig(next);
      return next;
    });
  }, []);

  const pushHistory = useCallback((records: TestRecord[]) => {
    setCfg((prev) => {
      const next = { ...prev, history: [...records.slice().reverse(), ...prev.history].slice(0, 200) };
      saveConfig(next);
      return next;
    });
  }, []);

  /** 执行一轮测试：遍历所有已填写 key（手动/定时共用）；并发时跳过。 */
  const doTest = useCallback(
    async (trigger: TestRecord["trigger"]) => {
      if (testingRef.current) return;
      const current = cfgRef.current;
      const entries = current.keys.filter((k) => k.key.trim());
      if (entries.length === 0) {
        const record: TestRecord = {
          at: Date.now(),
          elapsedMs: 0,
          ok: false,
          error: "未填写任何 API Key",
          trigger,
          keyName: "",
          model: current.model,
          protocol: current.protocol,
        };
        setLast(record);
        pushHistory([record]);
        return;
      }
      setTesting(true);
      try {
        // 串行测试：避免并发触发服务端频控，也让历史按发起顺序落库。
        const records: TestRecord[] = [];
        for (const entry of entries) {
          const record = await runTest(
            { key: entry.key, keyName: entry.name, protocol: current.protocol, model: current.model },
            trigger
          );
          records.push(record);
          setLast(record);
        }
        pushHistory(records);
      } finally {
        setTesting(false);
      }
    },
    [pushHistory]
  );

  /* 定时器：每天多个固定时刻触发，随 scheduleEnabled / scheduleTimes 重建。 */
  useEffect(() => {
    if (!cfg.scheduleEnabled || cfg.scheduleTimes.length === 0) {
      setNextAt(null);
      return;
    }
    const times = cfg.scheduleTimes
      .map((t) => parseTimeOfDay(t))
      .filter((t): t is { h: number; m: number } => t !== null);
    if (times.length === 0) {
      setNextAt(null);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const target = nextOccurrence(times);
      setNextAt(target);
      // 前台标签页 setTimeout 上限约 24.8 天，一天的延迟完全在安全范围内。
      timer = setTimeout(() => {
        void doTest("scheduled");
        arm();
      }, Math.max(target - Date.now(), 0));
    };

    arm();
    return () => clearTimeout(timer);
  }, [cfg.scheduleEnabled, cfg.scheduleTimes, doTest]);

  /* unmount 前保存一次配置。 */
  useEffect(() => {
    const handler = () => saveConfig(cfgRef.current);
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    if (nextAt === null) {
      setCountdown("");
      return;
    }
    const fmt = () => {
      const d = new Date(nextAt);
      const p = (n: number) => String(n).padStart(2, "0");
      const remain = Math.max(0, nextAt - Date.now());
      const s = Math.ceil(remain / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      setCountdown(
        `${p(d.getHours())}:${p(d.getMinutes())}（${
          h > 0 ? `${h}时${m}分后` : m > 0 ? `${m}分${sec}秒后` : `${sec}秒后`
        }）`
      );
    };
    fmt();
    const t = setInterval(fmt, 1000);
    return () => clearInterval(t);
  }, [nextAt]);

  /** 历史筛选的 key 名称；null = 全部。选项来自历史中出现过的名称。 */
  const [filterName, setFilterName] = useState<string | null>(null);
  const historyNames = useMemo(() => {
    const names: string[] = [];
    for (const r of cfg.history) {
      if (r.keyName && !names.includes(r.keyName)) names.push(r.keyName);
    }
    return names;
  }, [cfg.history]);
  // 筛选名可能已被历史清空覆盖，失效时自动回到「全部」。
  useEffect(() => {
    if (filterName !== null && !historyNames.includes(filterName)) setFilterName(null);
  }, [historyNames, filterName]);
  const shownHistory = useMemo(
    () => (filterName === null ? cfg.history : cfg.history.filter((r) => r.keyName === filterName)),
    [cfg.history, filterName]
  );

  /* key 列表行编辑。 */
  const setKeys = useCallback((keys: StoredConfig["keys"]) => {
    update({ keys });
  }, [update]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* 左列：配置 + 测试 */}
      <div className="space-y-4">
        <Section title="Key 与测试" icon={<KeyRound className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  Coding Plan API Key 列表（仅保存在本地；点击名称可修改）
                </label>
                <button
                  className={smallBtnClass}
                  onClick={() =>
                    setKeys([...cfg.keys, { name: nextKeyName(cfg.keys), key: "" }])
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加 Key
                </button>
              </div>
              <div className="space-y-2">
                {cfg.keys.map((entry, idx) => (
                  <KeyRow
                    key={idx}
                    entry={entry}
                    canDelete={cfg.keys.length > 1}
                    onChange={(next) => {
                      const keys = [...cfg.keys];
                      keys[idx] = next;
                      setKeys(keys);
                    }}
                    onDelete={() => setKeys(cfg.keys.filter((_, i) => i !== idx))}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">协议</label>
                <select
                  value={cfg.protocol}
                  onChange={(e) =>
                    update({ protocol: e.target.value as Protocol })
                  }
                  className={inputClass}
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p} value={p}>
                      {PROTOCOL_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">模型</label>
                <input
                  list="glm-model-presets"
                  value={cfg.model}
                  onChange={(e) => update({ model: e.target.value.trim() })}
                  placeholder={DEFAULT_MODEL}
                  className={`font-mono ${inputClass}`}
                />
                <datalist id="glm-model-presets">
                  {MODEL_PRESETS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                className={primaryBtnClass}
                onClick={() => void doTest("manual")}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {testing ? "测试中…" : "立即测试"}
              </button>
              <span className="text-xs text-muted-foreground">
                依次测试全部已填写的 Key（共 {cfg.keys.filter((k) => k.key.trim()).length} 个）
              </span>
            </div>

            {last && !testing && <ResultView record={last} />}
          </div>
        </Section>

        <Section title="定时测试" icon={<Timer className="h-4 w-4 text-muted-foreground" />}>
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={cfg.scheduleEnabled}
                onChange={(e) => update({ scheduleEnabled: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              启用定时自动测试
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  每天触发时间（可设多个）
                </span>
                <button
                  className={smallBtnClass}
                  onClick={() => {
                    // 顺延 30 分钟生成下一个默认时刻，避免重复
                    const last = cfg.scheduleTimes[cfg.scheduleTimes.length - 1] ?? "12:30";
                    const t = parseTimeOfDay(last);
                    const next = t
                      ? new Date(2020, 0, 1, t.h, t.m + 30)
                      : new Date(2020, 0, 1, 13, 0);
                    const v = `${String(next.getHours()).padStart(2, "0")}:${String(
                      next.getMinutes()
                    ).padStart(2, "0")}`;
                    update({ scheduleTimes: [...cfg.scheduleTimes, v] });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加时间
                </button>
              </div>
              {cfg.scheduleTimes.length === 0 && (
                <div className="text-xs text-muted-foreground">（无触发时间，请至少添加一个）</div>
              )}
              {/* 横向排列，按时间升序（scheduleTimes 始终保持排序不变量）。 */}
              <div className="flex flex-wrap items-center gap-2">
                {cfg.scheduleTimes.map((time, idx) => (
                  <div
                    key={idx}
                    className="group flex items-center rounded-md border border-input bg-background pl-2 pr-1"
                  >
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!normalizeTime(v)) return;
                        const times = [...cfg.scheduleTimes];
                        times[idx] = v;
                        update({ scheduleTimes: [...new Set(times)].sort() });
                      }}
                      className="h-8 border-0 bg-transparent px-0 font-mono text-sm focus-visible:outline-none focus-visible:ring-0"
                    />
                    {cfg.scheduleTimes.length > 1 && (
                      <button
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                        title="删除该时间"
                        onClick={() =>
                          update({
                            scheduleTimes: cfg.scheduleTimes.filter((_, i) => i !== idx),
                          })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {cfg.scheduleEnabled
                ? cfg.scheduleTimes.length > 0
                  ? `已开启：每天 ${cfg.scheduleTimes.join("、")} 自动测试，下次 ${countdown}（仅工具打开期间生效）`
                  : "已开启，但未设置触发时间"
                : "关闭中。开启后每天在设定时刻自动发送测试消息并记录结果。"}
            </div>
          </div>
        </Section>
      </div>

      {/* 右列：历史 */}
      <Section title="测试历史" icon={<History className="h-4 w-4 text-muted-foreground" />}>
        {cfg.history.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            暂无记录，点击「立即测试」开始
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Key 筛选：</span>
                <button
                  onClick={() => setFilterName(null)}
                  className={
                    filterName === null
                      ? "rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                      : "rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  }
                >
                  全部
                </button>
                {historyNames.map((name) => (
                  <button
                    key={name}
                    onClick={() => setFilterName(filterName === name ? null : name)}
                    className={
                      filterName === name
                        ? "rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground"
                        : "rounded-full border border-input bg-background px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                    }
                    title={filterName === name ? "点击取消筛选" : "筛选该 Key"}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button
                className={smallBtnClass}
                onClick={() => update({ history: [] })}
                title="清空历史"
              >
                <Eraser className="h-3.5 w-3.5" />
                清空
              </button>
            </div>
            {shownHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                该 Key 暂无记录
              </div>
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {shownHistory.map((r, i) => (
                  <div
                    key={`${r.at}-${i}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-xs"
                  >
                    {r.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : r.limited ? (
                      <Hourglass className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                    )}
                    {r.keyName && (
                      <span className="max-w-24 shrink-0 truncate rounded bg-secondary px-1.5 py-0.5 font-medium">
                        {r.keyName}
                      </span>
                    )}
                    <span className="w-36 shrink-0 font-mono text-muted-foreground">
                      {fmtTime(r.at)}
                    </span>
                    <span className="w-16 shrink-0 text-muted-foreground">
                      {r.trigger === "scheduled" ? "定时" : "手动"}
                    </span>
                    <span
                      className={
                        r.limited && !r.ok
                          ? "min-w-0 flex-1 truncate text-amber-600 dark:text-amber-400"
                          : "min-w-0 flex-1 truncate"
                      }
                      title={r.ok ? r.reply : r.error}
                    >
                      {r.ok ? r.reply : r.error}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{r.elapsedMs}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---- 插件生命周期 ---- */

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;

export function mount(container: HTMLElement): void {
  host = document.createElement("div");
  container.appendChild(host);
  root = createRoot(host);
  root.render(<GlmKeyTestTool />);
}

export function unmount(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
