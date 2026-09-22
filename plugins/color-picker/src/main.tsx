/**
 * 取色器插件（自包含模块，不依赖宿主运行时代码）。
 * 屏幕取色：点击「屏幕取色」→ 宿主 screen_cursor_set 把系统光标整体换成吸管 →
 * 轮询 screen_sample（全局鼠标位置 + 屏幕像素色）→ 色盘游标与颜色信息实时联动；
 * 左键确认取色（可选自动复制 HEX），Esc / 右键取消。
 * 色盘为标准 HSV 模型（饱和度/明度方形 + 色相条），支持拖拽手动调色。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Pipette } from "lucide-react";
import {
  hexToRgb,
  hsvToRgb,
  nearestCssName,
  parseColor,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  toHex,
  toIntValue,
  type HSV,
  type RGB,
} from "./color";
import { pipetteCursor } from "./cursor";

/* ---- 宿主 screen_sample 的返回结构（camelCase） ---- */

interface Sample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  valid: boolean;
  lmb: boolean;
  rmb: boolean;
  esc: boolean;
}

const LS_HISTORY = "toolbox-color-picker-history";
const LS_LAST = "toolbox-color-picker-last";
const LS_AUTOCOPY = "toolbox-color-picker-autocopy";
const HISTORY_MAX = 30;

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

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
          ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-success transition-colors hover:bg-accent"
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
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5">
      {/* 标签自适应宽度，值紧跟其后，不留固定空白列 */}
      <div className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 select-text break-all font-mono text-sm">{value}</div>
      {hint && <div className="shrink-0 font-mono text-xs text-muted-foreground">{hint}</div>}
      <CopyButton text={value} />
    </div>
  );
}

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const smallBtnClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 select-none";

/* ---- 色盘 ---- */

function SatValueArea({
  hsv,
  color,
  onChange,
}: {
  hsv: HSV;
  color: string;
  onChange: (next: HSV) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const apply = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 100;
    const v = (1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))) * 100;
    onChange({ ...hsv, s, v });
  };
  return (
    <div
      ref={ref}
      className="relative aspect-square w-full max-w-[280px] cursor-crosshair touch-none rounded-md border border-border"
      style={{
        background:
          "linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), " +
          `hsl(${hsv.h}, 100%, 50%)`,
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) apply(e.clientX, e.clientY);
      }}
    >
      {/* 游标：指到哪里，颜色就落在哪里（屏幕取色时实时跟随） */}
      <div
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: color }}
      />
    </div>
  );
}

function HueBar({ hsv, onChange }: { hsv: HSV; onChange: (next: HSV) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const apply = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 360;
    onChange({ ...hsv, h });
  };
  return (
    <div
      ref={ref}
      className="relative h-4 w-full max-w-[280px] cursor-pointer touch-none rounded-full border border-border"
      style={{
        background:
          "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) apply(e.clientX);
      }}
    >
      <div
        className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
        style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
      />
    </div>
  );
}

/* ---- 相对亮度：预览色块上的文字取黑/白 ---- */

function luminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/* ---- 工具 UI ---- */

function ColorPickerTool() {
  const [hsv, setHsv] = useState<HSV>(() => {
    const saved = localStorage.getItem(LS_LAST);
    return rgbToHsv((saved && hexToRgb(saved)) || { r: 30, g: 144, b: 255 });
  });
  const rgb = useMemo(() => hsvToRgb(hsv), [hsv]);
  const hex = toHex(rgb);

  const [picking, setPicking] = useState(false);
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [autoCopy, setAutoCopy] = useState(() => localStorage.getItem(LS_AUTOCOPY) !== "0");
  const [hexInput, setHexInput] = useState(hex);

  /** 取色取消时要恢复的取色前颜色。 */
  const restoreRef = useRef<HSV | null>(null);
  /** 取色循环内读最新开关值，避免 mid-pick 重启循环。 */
  const autoCopyRef = useRef(autoCopy);
  useEffect(() => {
    autoCopyRef.current = autoCopy;
  }, [autoCopy]);

  useEffect(() => {
    localStorage.setItem(LS_LAST, hex);
    setHexInput(hex);
  }, [hex]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const pushHistory = (h: string) =>
    setHistory((prev) => {
      const next = [h, ...prev.filter((x) => x !== h)].slice(0, HISTORY_MAX);
      localStorage.setItem(LS_HISTORY, JSON.stringify(next));
      return next;
    });

  const applyHex = (h: string) => {
    const parsed = hexToRgb(h);
    if (parsed) setHsv(rgbToHsv(parsed));
  };

  /* ---- 屏幕取色循环：picking=true 期间轮询宿主采样原语 ---- */

  useEffect(() => {
    if (!picking) return;
    let armed = false; // 需要先观察到按键全部抬起，防止启动按钮的那次按下被当成取色
    let busy = false; // 上一次 invoke 未返回时跳过本拍，避免请求堆积
    let stopped = false;
    let timer = 0;

    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      setLive(null);
      setPicking(false);
    };

    const tick = async () => {
      if (stopped || busy) return;
      busy = true;
      try {
        const s = await invoke<Sample>("screen_sample");
        if (stopped) return;
        if (s.valid) {
          setHsv(rgbToHsv({ r: s.r, g: s.g, b: s.b }));
          setLive({ x: s.x, y: s.y });
        }
        if (!armed) {
          if (!s.lmb && !s.rmb) armed = true;
        } else if (s.lmb) {
          const h = toHex({ r: s.r, g: s.g, b: s.b });
          stop();
          pushHistory(h);
          if (autoCopyRef.current) {
            void copyText(h).then((ok) => setFlash(ok ? `已复制 ${h}` : `已取色 ${h}（复制失败）`));
          } else {
            setFlash(`已取色 ${h}`);
          }
          return;
        }
        if (s.esc || s.rmb) {
          stop();
          if (restoreRef.current) setHsv(restoreRef.current);
          setFlash("已取消取色");
        }
      } catch (e) {
        stop();
        setFlash(`取色失败：${e instanceof Error ? e.message : String(e)}`);
      } finally {
        busy = false;
      }
    };

    (async () => {
      // 光标替换为吸管（旧宿主 / 非 Windows 失败时降级为原光标继续取色）
      try {
        const c = pipetteCursor();
        await invoke("screen_cursor_set", {
          rgba: Array.from(c.rgba),
          width: c.width,
          height: c.height,
          hotspotX: c.hotspotX,
          hotspotY: c.hotspotY,
        });
      } catch {
        /* 降级：保持原光标 */
      }
      if (!stopped) timer = window.setInterval(tick, 16);
    })();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      invoke("screen_cursor_reset").catch(() => {});
    };
  }, [picking]);

  const startPick = () => {
    if (picking) return;
    restoreRef.current = hsv;
    setFlash(null);
    setPicking(true);
  };

  /* ---- 颜色信息（多格式） ---- */

  const info = useMemo(() => {
    const hsl = rgbToHsl(rgb);
    const cmyk = rgbToCmyk(rgb);
    const name = nearestCssName(rgb);
    const R = Math.round;
    return [
      { label: "HEX", value: hex.toUpperCase() },
      { label: "RGB", value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
      { label: "HSL", value: `hsl(${R(hsl.h)}, ${R(hsl.s)}%, ${R(hsl.l)}%)` },
      { label: "HSV / HSB", value: `hsv(${R(hsv.h)}, ${R(hsv.s)}%, ${R(hsv.v)}%)` },
      {
        label: "CMYK",
        value: `cmyk(${R(cmyk.c)}%, ${R(cmyk.m)}%, ${R(cmyk.y)}%, ${R(cmyk.k)}%)`,
      },
      { label: "十进制", value: String(toIntValue(rgb)) },
      { label: "0x 十六进制", value: `0x${hex.slice(1).toUpperCase()}` },
      { label: "CSS 名称", value: name.name, hint: `≈ ${name.hex}` },
    ];
  }, [rgb, hsv, hex]);

  const name = useMemo(() => nearestCssName(rgb), [rgb]);

  return (
    <div className="space-y-4">
      <Section title="屏幕取色">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={startPick}
              disabled={picking}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 select-none"
            >
              <Pipette className="h-4 w-4" />
              {picking ? "取色中…" : "屏幕取色"}
            </button>
            <button
              onClick={() =>
                setAutoCopy((v) => {
                  const nv = !v;
                  localStorage.setItem(LS_AUTOCOPY, nv ? "1" : "0");
                  return nv;
                })
              }
              className={`${smallBtnClass} ${autoCopy ? "text-success" : "text-muted-foreground"}`}
              title="取色确认后自动把 HEX 复制到剪贴板"
            >
              {autoCopy ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              取色后自动复制 HEX
            </button>
          </div>

          {picking && (
            <div className="flex items-center gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              <span className="shrink-0 font-mono">{live ? `(${live.x}, ${live.y})` : "移动鼠标…"}</span>
              <span className="font-mono font-semibold">{hex.toUpperCase()}</span>
              <span className="ml-auto text-muted-foreground">左键取色 · Esc / 右键取消</span>
            </div>
          )}
          {!picking && (
            <p className="text-xs text-muted-foreground">
              点击后光标变为吸管，指向屏幕任意位置：色盘与颜色信息实时跟随，左键确认取色，Esc / 右键取消。
            </p>
          )}
          {flash && (
            <div className="rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              {flash}
            </div>
          )}
        </div>
      </Section>

      <Section title="色盘 · 颜色信息">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* 左：HSV 色盘（饱和度/明度方形 + 色相条） */}
          <div className="w-full max-w-[280px] shrink-0 space-y-4">
            <SatValueArea hsv={hsv} color={hex} onChange={setHsv} />
            <HueBar hsv={hsv} onChange={setHsv} />
          </div>

          {/* 右：预览 + 输入 + 多格式信息，填充色盘右侧剩余空间 */}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-border"
                style={{ backgroundColor: hex }}
              >
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: luminance(rgb) > 0.35 ? "#000" : "#fff" }}
                >
                  预览
                </span>
              </div>
              <div className="min-w-0">
                <div className="font-mono text-xl font-semibold">{hex.toUpperCase()}</div>
                <div className="text-xs text-muted-foreground">
                  rgb({rgb.r}, {rgb.g}, {rgb.b}) · ≈ {name.name}
                </div>
              </div>
              <input
                value={hexInput}
                onChange={(e) => {
                  setHexInput(e.target.value);
                  const parsed = parseColor(e.target.value);
                  if (parsed) setHsv(rgbToHsv(parsed));
                }}
                placeholder="输入 #HEX / #RGB 或 rgb(r, g, b) 直接调色"
                className={`ml-auto w-full max-w-[280px] font-mono ${inputClass}`}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {info.map((row) => (
                <ValueRow key={row.label} label={row.label} value={row.value} hint={row.hint} />
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="历史记录">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {history.length === 0 && (
              <span className="text-xs text-muted-foreground">暂无记录，屏幕取色确认后自动保存</span>
            )}
            {history.map((h) => (
              <button
                key={h}
                onClick={() => applyHex(h)}
                title={h}
                className="h-7 w-7 rounded-md border border-border transition-transform hover:scale-110"
                style={{ backgroundColor: h }}
              />
            ))}
          </div>
          {history.length > 0 && (
            <button
              onClick={() => {
                setHistory([]);
                localStorage.removeItem(LS_HISTORY);
              }}
              className={smallBtnClass}
            >
              清空
            </button>
          )}
        </div>
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
  root.render(<ColorPickerTool />);
}

export function unmount(): void {
  // 取色循环由组件卸载时的 useEffect cleanup 终止（清定时器 + 恢复系统光标）
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
