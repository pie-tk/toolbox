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
  ChevronDown,
  CloudDownload,
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
  MODEL_PRESETS,
  PROTOCOLS,
  PROTOCOL_LABELS,
  type KeyEntry,
  type Protocol,
  fetchModels,
  getNextFireAt,
  getLastRound,
  isBackgroundActive,
  markBackgroundStarted,
  nextKeyName,
  normalizeTime,
  onSchedulerUpdate,
  parseTimeOfDay,
  runTest,
  setLastRound as setLastRoundModule,
  setToastGate,
  shutdownBackground,
  syncScheduler,
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

/** 模型选择：自由输入 + 点击下拉按钮展开列表（倒序，最新在上）。 */
function ModelSelect({
  value,
  models,
  presets,
  onChange,
}: {
  value: string;
  /** 已拉取的模型列表（空 = 未拉取，回退预设）。 */
  models: string[];
  presets: readonly string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* 点外部 / Esc 关闭。 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const list = useMemo(() => {
    const source = models.length > 0 ? models : presets;
    return [...new Set(source)].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );
  }, [models, presets]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={presets[0]}
          className={`min-w-0 flex-1 font-mono ${inputClass}`}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title="选择模型"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-lg">
          <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {models.length > 0 ? `已获取 ${models.length} 个模型（新版本在前）` : "预设模型（可点右侧按钮获取完整列表）"}
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {list.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">（无模型）</div>
            )}
            {list.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                className={
                  m === value
                    ? "flex w-full items-center justify-between gap-2 bg-primary/10 px-3 py-1.5 text-left font-mono text-sm text-primary"
                    : "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-sm transition-colors hover:bg-accent"
                }
              >
                <span className="min-w-0 truncate">{m}</span>
                {m === value && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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

/** 一轮结果按状态分组：同状态同错误信息的 key 归为一行展示。 */
interface ResultGroup {
  status: "ok" | "limited" | "fail";
  names: string[];
  /** ok：可用（回复「…」）；失败：原始错误信息。 */
  message: string;
}

function buildGroups(records: TestRecord[]): ResultGroup[] {
  const map = new Map<string, ResultGroup>();
  for (const r of records) {
    const status: ResultGroup["status"] = r.ok ? "ok" : r.limited ? "limited" : "fail";
    const key = r.ok ? "ok" : `${status}|${r.error ?? ""}`;
    let g = map.get(key);
    if (!g) {
      let message: string;
      if (r.ok) {
        const reply = (r.reply ?? "").replace(/\s+/g, " ").slice(0, 24);
        message = reply ? `可用 · 回复「${reply}」` : "可用";
      } else {
        message = r.error ?? "失败";
      }
      g = { status, names: [], message };
      map.set(key, g);
    }
    if (r.keyName) g.names.push(r.keyName);
  }
  const order = { ok: 0, limited: 1, fail: 2 } as const;
  return [...map.values()].sort((a, b) => order[a.status] - order[b.status]);
}

const GROUP_STYLE: Record<
  ResultGroup["status"],
  { icon: typeof CheckCircle2; text: string; label: string }
> = {
  ok: { icon: CheckCircle2, text: "text-emerald-500", label: "可用" },
  limited: {
    icon: Hourglass,
    text: "text-amber-600 dark:text-amber-400",
    label: "限额中",
  },
  fail: { icon: XCircle, text: "text-destructive", label: "失败" },
};

function RoundResultView({ records, testing }: { records: TestRecord[]; testing: boolean }) {
  const groups = buildGroups(records);
  const counts = {
    ok: records.filter((r) => r.ok).length,
    limited: records.filter((r) => !r.ok && r.limited).length,
    fail: records.filter((r) => !r.ok && !r.limited).length,
  };
  return (
    <div className="space-y-2 rounded-md border border-border bg-background/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">本轮 {records.length} 个 Key：</span>
        {counts.ok > 0 && <span className="font-medium text-emerald-500">✓ {counts.ok} 可用</span>}
        {counts.limited > 0 && (
          <span className="font-medium text-amber-600 dark:text-amber-400">
            ⏳ {counts.limited} 限额
          </span>
        )}
        {counts.fail > 0 && (
          <span className="font-medium text-destructive">✗ {counts.fail} 失败</span>
        )}
        {testing && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-1.5">
        {groups.map((g, i) => {
          const style = GROUP_STYLE[g.status];
          const Icon = style.icon;
          const message = g.message.length > 100 ? `${g.message.slice(0, 100)}…` : g.message;
          return (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Icon className={`h-3.5 w-3.5 shrink-0 ${style.text}`} />
              {g.names.length > 0 ? (
                g.names.map((n) => (
                  <span
                    key={n}
                    className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium"
                    title={n}
                  >
                    {n}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">（未命名）</span>
              )}
              <span
                className={`min-w-0 break-all font-mono text-xs ${style.text}`}
                title={g.message}
              >
                {message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- 主界面 ---- */

function GlmKeyTestTool() {
  const [cfg, setCfg] = useState<StoredConfig>(() => loadConfig());
  const [testing, setTesting] = useState(false);
  /** 最近一轮全部记录（逐 key 实时更新；后台触发时经调度器事件同步）。 */
  const [lastRound, setLastRound] = useState<TestRecord[]>(() => getLastRound() ?? []);
  /** 下次定时触发时间（epoch ms）；null = 未启用。来自模块级调度器。 */
  const [nextAt, setNextAt] = useState<number | null>(() => getNextFireAt());

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const testingRef = useRef(testing);
  testingRef.current = testing;
  /** 定时回调需要最新版 cfg/testing，但 interval 只建一次 → 经 ref 转发。 */

  const update = useCallback((patch: Partial<StoredConfig>) => {
    const next = { ...cfgRef.current, ...patch };
    cfgRef.current = next;
    saveConfig(next);
    setCfg(next);
    // 配置变化 → 重排模块级定时器（后台与页面打开时都存活）。
    syncScheduler();
  }, []);

  const pushHistory = useCallback((records: TestRecord[]) => {
    const next = {
      ...cfgRef.current,
      history: [...records.slice().reverse(), ...cfgRef.current.history].slice(0, 200),
    };
    cfgRef.current = next;
    saveConfig(next);
    setCfg(next);
  }, []);

  /** 执行一轮测试：遍历所有已填写 key（手动触发；定时走模块级 fireScheduled）。 */
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
        setLastRound([record]);
        setLastRoundModule([record]);
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
          // 逐 key 实时刷新本轮结果分组展示。
          setLastRound([...records]);
        }
        setLastRoundModule(records);
        pushHistory(records);
      } finally {
        setTesting(false);
      }
    },
    [pushHistory]
  );

  /* 页面打开时确保模块级调度器按当前配置排定（老宿主首次打开工具的入口）；
   * 并订阅调度器事件：后台触发写入历史 / 重排后同步界面。 */
  useEffect(() => {
    syncScheduler();
    setNextAt(getNextFireAt());
    const off = onSchedulerUpdate(() => {
      const fresh = loadConfig();
      cfgRef.current = fresh;
      setCfg(fresh);
      setNextAt(getNextFireAt());
      const round = getLastRound();
      if (round) setLastRound(round);
    });
    return off;
  }, []);

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

  /** 模型列表拉取状态与提示。 */
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsHint, setModelsHint] = useState<
    { kind: "idle" } | { kind: "ok"; source: string } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const fetchModelList = useCallback(async () => {
    const current = cfgRef.current;
    const first = current.keys.find((k) => k.key.trim());
    if (!first) {
      setModelsHint({ kind: "error", message: "未填写任何 API Key" });
      return;
    }
    setFetchingModels(true);
    try {
      const result = await fetchModels(first.key, current.protocol);
      if (result.ok) {
        update({ models: result.models });
        setModelsHint({ kind: "ok", source: result.source ?? "" });
      } else {
        setModelsHint({ kind: "error", message: result.error ?? "未知错误" });
      }
    } finally {
      setFetchingModels(false);
    }
  }, [update]);

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
                <div className="flex gap-2">
                  <ModelSelect
                    value={cfg.model}
                    models={cfg.models}
                    presets={MODEL_PRESETS}
                    onChange={(model) => update({ model })}
                  />
                  <button
                    className={`${primaryBtnClass} h-9 shrink-0 px-3 text-xs`}
                    onClick={() => void fetchModelList()}
                    disabled={fetchingModels}
                    title="用第一个已填写的 Key 从智谱拉取可用模型列表"
                  >
                    {fetchingModels ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="h-3.5 w-3.5" />
                    )}
                    {fetchingModels ? "获取中" : "获取模型列表"}
                  </button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {modelsHint.kind === "ok" && (
                    <span className="text-emerald-500">
                      已获取 {cfg.models.length} 个模型（{modelsHint.source}），点击 ↓ 选择
                    </span>
                  )}
                  {modelsHint.kind === "error" && (
                    <span className="text-destructive">获取失败：{modelsHint.message}</span>
                  )}
                  {modelsHint.kind === "idle" &&
                    (cfg.models.length > 0
                      ? `已有 ${cfg.models.length} 个模型，点击 ↓ 选择`
                      : "可点击右侧按钮拉取模型列表，或直接输入模型名")}
                </div>
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

            {lastRound.length > 0 && (
              <RoundResultView records={lastRound} testing={testing} />
            )}
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
                  ? `已开启：每天 ${cfg.scheduleTimes.join("、")} 自动测试，下次 ${countdown}。${
                      isBackgroundActive()
                        ? "后台运行中：ToolBox 启动后即生效，无需停留在本页。"
                        : "提示：当前宿主版本不支持冷启动后台；本次运行中打开过本工具后，切走页面也会继续触发。"
                    }`
                  : "已开启，但未设置触发时间"
                : "关闭中。开启后每天在设定时刻自动发送测试消息并记录结果；结果会弹通知（页面打开时仅刷新历史）。"}
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
/** 页面可见性（toast 门控：用户停留本页时不弹通知）。 */
let pageVisible = false;
setToastGate(() => pageVisible);

export function mount(container: HTMLElement): void {
  pageVisible = true;
  host = document.createElement("div");
  container.appendChild(host);
  root = createRoot(host);
  root.render(<GlmKeyTestTool />);
}

export function unmount(): void {
  pageVisible = false;
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  /* 注意：不停止模块级调度器——定时测试在后台继续（这正是本插件的核心能力）。
   * 只有宿主 stopBackground（卸载）才停。 */
}

/** 宿主启动/安装后调用（manifest.background: true）。 */
export function startBackground(): void {
  markBackgroundStarted();
}

/** 宿主卸载前调用。 */
export function stopBackground(): void {
  shutdownBackground();
}
