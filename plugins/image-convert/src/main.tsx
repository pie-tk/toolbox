/**
 * 图片格式转换插件：与 Mipmap Studio 共用 image-core 能力（wasm）——
 * 安装过任一图工具后，本工具不会再重复下载图像处理能力。
 */
import { useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileImage, FolderOpen, Loader2, Trash2 } from "lucide-react";

/* ---- 宿主上下文 ---- */

interface ImageCoreApi {
  probe(bytes: Uint8Array): { width: number; height: number; format: string };
  convert(
    bytes: Uint8Array,
    format: 0 | 1 | 2,
    quality?: number,
    maxDim?: number
  ): Uint8Array;
}

let capFn: ((id: string) => Promise<unknown>) | null = null;
const imageCore = () => {
  if (!capFn) throw new Error("宿主上下文未初始化");
  return capFn("image-core") as Promise<ImageCoreApi>;
};

/* ---- 宿主文件原语 ---- */

async function readBytes(path: string): Promise<Uint8Array> {
  const raw = await invoke<ArrayBuffer | Uint8Array>("fs_read_bytes", { path });
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}
const writeBytes = (path: string, data: Uint8Array) =>
  invoke<void>("fs_write_bytes", { path, data });
const fsExists = (path: string) => invoke<boolean>("fs_exists", { path });
const fsCreateDirAll = (path: string) => invoke<void>("fs_create_dir_all", { path });

/* ---- 工具函数 ---- */

function baseName(path: string): string {
  const p = path.replace(/\\/g, "/");
  return p.slice(p.lastIndexOf("/") + 1);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const EXT_OF: Record<string, string> = { PNG: "png", JPEG: "jpg", WEBP: "webp" };

/* ---- UI ---- */

interface Item {
  path: string;
  bytes: Uint8Array;
  info: { width: number; height: number; format: string };
}

const btn =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 select-none";
const primaryBtn = btn.replace(
  "border border-input bg-background",
  "bg-primary text-primary-foreground hover:bg-primary/90"
);
const inputCls =
  "flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 text-card-foreground">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<"PNG" | "JPEG" | "WEBP">("WEBP");
  const [quality, setQuality] = useState(85);
  const [maxDim, setMaxDim] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const totalIn = useMemo(() => items.reduce((n, i) => n + i.bytes.length, 0), [items]);

  async function pick() {
    setResult(null);
    const picked = await openDialog({
      multiple: true,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    const cap = await imageCore();
    const loaded: Item[] = [];
    for (const path of paths) {
      try {
        const bytes = await readBytes(path);
        loaded.push({ path, bytes, info: cap.probe(bytes) });
      } catch {
        /* 跳过无法读取/解码的文件 */
      }
    }
    setItems(loaded);
  }

  async function convert() {
    if (items.length === 0 || busy) return;
    const outDir = await openDialog({ directory: true, multiple: false });
    if (typeof outDir !== "string") return;
    setBusy(true);
    setResult(null);
    try {
      const cap = await imageCore();
      await fsCreateDirAll(outDir);
      const fmtCode = format === "PNG" ? 0 : format === "JPEG" ? 1 : 2;
      const ext = EXT_OF[format];
      let ok = 0;
      let bytesOut = 0;
      const failures: string[] = [];
      for (const item of items) {
        try {
          const out = cap.convert(item.bytes, fmtCode as 0 | 1 | 2, quality, maxDim);
          const stem = baseName(item.path).replace(/\.[^.]+$/, "");
          let dst = `${outDir.replace(/[\\/]+$/, "")}/${stem}.${ext}`;
          let n = 1;
          while (await fsExists(dst)) {
            dst = `${outDir.replace(/[\\/]+$/, "")}/${stem} (${n}).${ext}`;
            n += 1;
          }
          await writeBytes(dst, out);
          ok += 1;
          bytesOut += out.length;
        } catch (e) {
          failures.push(baseName(item.path));
        }
      }
      setResult(
        `已转换 ${ok}/${items.length} 个文件（${formatBytes(totalIn)} → ${formatBytes(bytesOut)}）${
          failures.length > 0 ? `，失败：${failures.slice(0, 5).join("、")}` : ""
        }`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section title="选择图片">
        <div className="flex items-center gap-2">
          <button className={btn} onClick={pick} disabled={busy}>
            <FileImage className="h-4 w-4" /> 选择文件
          </button>
          {items.length > 0 && (
            <button className={btn} onClick={() => setItems([])} disabled={busy}>
              <Trash2 className="h-4 w-4" /> 清空
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {items.length > 0
              ? `${items.length} 个文件 · ${formatBytes(totalIn)}`
              : "支持 PNG / JPEG / WebP / GIF"}
          </span>
        </div>
        {items.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {items.map((item) => (
              <div
                key={item.path}
                className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 text-xs last:border-0"
              >
                <FileImage className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{baseName(item.path)}</span>
                <span className="shrink-0 text-muted-foreground">
                  {item.info.width}×{item.info.height} · {item.info.format.toLowerCase()} ·{" "}
                  {formatBytes(item.bytes.length)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="输出设置">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            格式
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as "PNG" | "JPEG" | "WEBP")}
              className={inputCls}
            >
              <option value="WEBP">WebP（无损）</option>
              <option value="JPEG">JPEG</option>
              <option value="PNG">PNG</option>
            </select>
          </label>
          {format === "JPEG" && (
            <label className="flex items-center gap-2 text-sm">
              质量
              <input
                type="range"
                min={10}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
              <span className="w-8 text-right font-mono text-xs">{quality}</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            最长边
            <input
              type="number"
              min={0}
              value={maxDim}
              onChange={(e) => setMaxDim(Math.max(0, Number(e.target.value) || 0))}
              className={`${inputCls} w-24`}
            />
            <span className="text-xs text-muted-foreground">px（0 = 原尺寸）</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={primaryBtn}
            onClick={convert}
            disabled={items.length === 0 || busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {busy ? "转换中…" : "选择目录并转换"}
          </button>
          {result && <span className="text-xs text-muted-foreground">{result}</span>}
        </div>
      </Section>
    </div>
  );
}

/* ---- 插件生命周期 ---- */

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;

export function mount(
  container: HTMLElement,
  ctx?: { capability<T = unknown>(capId: string): Promise<T> }
): void {
  if (ctx) capFn = ctx.capability;
  host = document.createElement("div");
  container.appendChild(host);
  root = createRoot(host);
  root.render(<App />);
}

export function unmount(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
