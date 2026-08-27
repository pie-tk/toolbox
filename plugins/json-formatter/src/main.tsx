/**
 * JSON 格式化插件（自包含，无能力依赖）。
 * 格式化 / 压缩 / 校验（错误行号定位）/ 键排序 / 缩进切换 / 复制。
 */
import { useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Check, ChevronDown, Copy, Minimize2, Sparkles, Trash2, WrapText } from "lucide-react";

/* ---- 小工具 ---- */

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

/** 递归按字典序排序对象键（数组保持顺序）。 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)])
    );
  }
  return value;
}

/** 从 JSON.parse 错误信息中提取行列号。 */
function parseErrorPosition(text: string, message: string): { line: number; col: number } | null {
  const m = /position (\d+)/i.exec(message);
  if (!m) return null;
  const pos = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = pos - before.lastIndexOf("\n");
  return { line, col };
}

const cls = {
  btn: "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 select-none",
  primary: "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 select-none",
  textarea:
    "h-full w-full resize-none rounded-md border border-input bg-background p-3 font-mono text-xs leading-relaxed shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-5 text-card-foreground">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/* ---- 主界面 ---- */

type Indent = 2 | 4 | "tab";

function JsonFormatter() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [indent, setIndent] = useState<Indent>(2);
  const [sort, setSort] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  // 输入实时校验
  const validation = useMemo(() => {
    const text = input.trim();
    if (!text) return { state: "empty" as const };
    try {
      const value = JSON.parse(text);
      return { state: "valid" as const, value };
    } catch (e) {
      const pos = parseErrorPosition(input, e instanceof Error ? e.message : String(e));
      return {
        state: "invalid" as const,
        message: e instanceof Error ? e.message : String(e),
        pos,
      };
    }
  }, [input]);

  const indentStr = indent === "tab" ? "\t" : " ".repeat(indent);

  function process(minify: boolean) {
    if (validation.state !== "valid") return;
    const value = sort ? sortKeys(validation.value) : validation.value;
    setOutput(
      minify ? JSON.stringify(value) : JSON.stringify(value, null, indentStr)
    );
  }

  function handleCopy() {
    if (output && copyText(output)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }

  const lineCount = input ? input.split("\n").length : 0;

  return (
    <div className="space-y-4">
      <Section title="输入">
        <div className="flex flex-wrap items-center gap-2">
          <button className={cls.primary} onClick={() => process(false)} disabled={validation.state !== "valid"}>
            <Sparkles className="h-3.5 w-3.5" />
            格式化
          </button>
          <button className={cls.btn} onClick={() => process(true)} disabled={validation.state !== "valid"}>
            <Minimize2 className="h-3.5 w-3.5" />
            压缩
          </button>
          <button className={cls.btn} onClick={() => { setInput(""); setOutput(""); }} disabled={!input && !output}>
            <Trash2 className="h-3.5 w-3.5" />
            清空
          </button>

          <div className="mx-1 h-5 w-px bg-border" />

          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            缩进
            <span className="relative">
              <select
                value={String(indent)}
                onChange={(e) =>
                  setIndent(e.target.value === "tab" ? "tab" : (Number(e.target.value) as 2 | 4))
                }
                className="h-8 appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="2">2 空格</option>
                <option value="4">4 空格</option>
                <option value="tab">Tab</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={sort}
              onChange={(e) => setSort(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            键排序
          </label>
        </div>

        {validation.state === "invalid" && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            JSON 无效：{validation.message}
            {validation.pos && (
              <span className="ml-1 font-mono opacity-80">
                （第 {validation.pos.line} 行，第 {validation.pos.col} 列）
              </span>
            )}
          </div>
        )}
        {validation.state === "valid" && (
          <div className="text-xs text-emerald-400">✓ JSON 有效</div>
        )}

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='粘贴或输入 JSON，如 {"name": "toolbox", "version": 1}'
          spellCheck={false}
          className={cls.textarea}
          style={{ minHeight: 200 }}
        />
        <div className="text-right text-xs text-muted-foreground/60">
          {input.length.toLocaleString()} 字符 · {lineCount} 行
        </div>
      </Section>

      <Section title="输出">
        <div className="flex items-center justify-between">
          <button
            className={cls.btn}
            onClick={() => setWrap((w) => !w)}
            title="切换自动换行"
          >
            <WrapText className="h-3.5 w-3.5" />
            {wrap ? "自动换行：开" : "自动换行：关"}
          </button>
          <button className={cls.btn} onClick={handleCopy} disabled={!output}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <textarea
          value={output}
          readOnly
          placeholder="点击「格式化」或「压缩」后在这里显示结果"
          spellCheck={false}
          wrap={wrap ? "soft" : "off"}
          className={cls.textarea}
          style={{ minHeight: 200 }}
        />
        {output && (
          <div className="text-right text-xs text-muted-foreground/60">
            {output.length.toLocaleString()} 字符
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
  root.render(<JsonFormatter />);
}

export function unmount(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
