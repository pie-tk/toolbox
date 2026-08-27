/**
 * 时间戳转换插件（自包含模块，不依赖宿主运行时代码）。
 * 导出 mount/unmount，由宿主注入到工具工作区。
 * 样式使用 Tailwind 类 + 宿主 CSS 变量，主题自动跟随宿主。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Check, Copy } from "lucide-react";
import {
  UNIT_LABELS,
  dayOfWeekCN,
  dayOfYear,
  formatLocal,
  formatUtc,
  parseTimestampInput,
  relativeTime,
  toDatetimeLocal,
  toIso,
} from "./time";

/* ---- 小组件（自包含，不引用宿主组件） ---- */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      onClick={async () => {
        if (await copyText(text)) setCopied(true);
      }}
      title="复制"
      className={
        copied
          ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-emerald-400 transition-colors hover:bg-accent"
          : "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      }
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 text-card-foreground">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ValueRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2">
      <div className="w-24 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 break-all font-mono text-sm">{value}</div>
      {hint && <div className="shrink-0 text-xs text-muted-foreground">{hint}</div>}
      <CopyButton text={value} />
    </div>
  );
}

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const smallBtnClass =
  "inline-flex h-8 items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 select-none";

/* ---- 工具 UI ---- */

function NowCard() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const d = new Date(now);
  return (
    <Section title="当前时间">
      <div className="space-y-3">
        <div>
          <div className="font-mono text-3xl font-semibold tracking-tight">
            {formatLocal(d, { ms: true })}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {dayOfWeekCN(d)} · 第 {dayOfYear(d)} 天 · {formatUtc(d)} UTC
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ValueRow label="秒级时间戳" value={String(Math.floor(now / 1000))} />
          <ValueRow label="毫秒级时间戳" value={String(now)} />
        </div>
      </div>
    </Section>
  );
}

function StampToDateCard() {
  const [raw, setRaw] = useState("");
  const parsed = useMemo(() => parseTimestampInput(raw), [raw]);

  const fill = (ms: number, unit: "s" | "ms") =>
    setRaw(String(unit === "s" ? Math.floor(ms / 1000) : ms));

  return (
    <Section title="时间戳 → 时间">
      <div className="space-y-3">
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="输入 Unix 时间戳（秒 / 毫秒 / 微秒自动识别）或日期字符串"
          className={`font-mono ${inputClass}`}
        />
        <div className="flex flex-wrap gap-2">
          <button className={smallBtnClass} onClick={() => fill(Date.now(), "s")}>
            现在 · 秒
          </button>
          <button className={smallBtnClass} onClick={() => fill(Date.now(), "ms")}>
            现在 · 毫秒
          </button>
          <button className={smallBtnClass} onClick={() => setRaw("0")}>
            纪元 0
          </button>
        </div>

        {parsed?.ok === false && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {parsed.error}
          </div>
        )}

        {parsed?.ok && (
          <div className="grid grid-cols-1 gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>已识别为</span>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 font-medium text-primary">
                {UNIT_LABELS[parsed.unit]}
                {parsed.unit !== "date" ? "时间戳" : ""}
              </span>
            </div>
            <ValueRow label="本地时间" value={formatLocal(parsed.date, { ms: true })} />
            <ValueRow label="UTC 时间" value={formatUtc(parsed.date, { ms: true })} />
            <ValueRow label="ISO 8601" value={toIso(parsed.date)} />
            <ValueRow
              label="秒级时间戳"
              value={String(Math.floor(parsed.date.getTime() / 1000))}
            />
            <ValueRow label="毫秒级时间戳" value={String(parsed.date.getTime())} />
            <ValueRow
              label="相对时间"
              value={relativeTime(parsed.date)}
              hint={dayOfWeekCN(parsed.date)}
            />
            <ValueRow label="年内天数" value={`第 ${dayOfYear(parsed.date)} 天`} />
          </div>
        )}
      </div>
    </Section>
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function DateToStampCard() {
  const [value, setValue] = useState(() => toDatetimeLocal(new Date()));
  const date = useMemo(() => (value ? new Date(value) : null), [value]);
  const valid = date !== null && !Number.isNaN(date.getTime());

  const presets: Array<{ label: string; date: () => Date }> = [
    { label: "现在", date: () => new Date() },
    { label: "今天 00:00", date: () => startOfDay(new Date()) },
    {
      label: "昨天 00:00",
      date: () => {
        const d = startOfDay(new Date());
        d.setDate(d.getDate() - 1);
        return d;
      },
    },
    {
      label: "本周一 00:00",
      date: () => {
        const d = startOfDay(new Date());
        const day = (d.getDay() + 6) % 7;
        d.setDate(d.getDate() - day);
        return d;
      },
    },
  ];

  return (
    <Section title="时间 → 时间戳">
      <div className="space-y-3">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`font-mono ${inputClass}`}
        />
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              className={smallBtnClass}
              onClick={() => setValue(toDatetimeLocal(p.date()))}
            >
              {p.label}
            </button>
          ))}
        </div>

        {valid && date && (
          <div className="grid grid-cols-1 gap-2">
            <ValueRow label="本地时间" value={formatLocal(date, { ms: true })} />
            <ValueRow label="秒级时间戳" value={String(Math.floor(date.getTime() / 1000))} />
            <ValueRow label="毫秒级时间戳" value={String(date.getTime())} />
            <ValueRow label="ISO 8601" value={toIso(date)} />
          </div>
        )}
      </div>
    </Section>
  );
}

function TimestampTool() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <NowCard />
        <DateToStampCard />
      </div>
      <StampToDateCard />
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
  root.render(<TimestampTool />);
}

export function unmount(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
