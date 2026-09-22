// UI 基础设施：自包含样式常量（仿 timestamp 插件）、宿主 toast 桥、通用小工具。
import type { VaultView } from "./types";

/* ---- 样式常量（引用宿主 CSS 变量，自动跟随主题） ---- */

export const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const smallBtnClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 select-none";

export const primaryBtnClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-[color,background-color,transform] duration-200 active:scale-[0.98] hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 select-none";

export const dangerBtnClass =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-destructive/60 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-[color,background-color,border-color,transform] duration-200 active:scale-[0.98] hover:bg-destructive hover:text-destructive-foreground disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 select-none";

export const iconBtnClass =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] duration-150 active:scale-[0.98] hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

export const cardClass = "rounded-lg border border-border bg-card text-card-foreground";

export const subtleTextClass = "text-xs text-muted-foreground";

/* ---- 宿主 toast 桥（App.tsx 的 CustomEvent 约定） ---- */

export type ToastVariant = "success" | "error" | "warning" | "info";

export function hostToast(title: string, description?: string, variant: ToastVariant = "info"): void {
  try {
    window.dispatchEvent(
      new CustomEvent("toolbox-plugin-toast", { detail: { title, description, variant } }),
    );
  } catch {
    // 宿主桥不可用（纯浏览器 dev）→ 静默
  }
}

/* ---- 通用小工具 ---- */

export function fmtDateTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 账号打码展示：a***@x.com / ab***。 */
export function maskUsername(u: string): string {
  if (!u) return "(无账号)";
  const at = u.lastIndexOf("@");
  if (at > 0) {
    const name = u.slice(0, at);
    const domain = u.slice(at);
    if (name.length <= 1) return `*${domain}`;
    return `${name.slice(0, 1)}***${domain}`;
  }
  if (u.length <= 2) return `${u.slice(0, 1)}***`;
  return `${u.slice(0, 2)}***${u.slice(-1)}`;
}

/** <input type="file"> 选中的文件 → 字节（WebView2 与浏览器 dev 通用）。 */
export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

/* ---- 表单脏标记（跨组件：header 切视图前确认放弃） ---- */

let formDirty = false;

export function setFormDirty(v: boolean): void {
  formDirty = v;
}

export function isFormDirty(): boolean {
  return formDirty;
}

export function isVaultView(v: unknown): v is VaultView {
  return v === "list" || v === "form" || v === "import" || v === "settings";
}
