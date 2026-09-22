// 密码生成器：长度 + 字符集，生成结果可直接填充进表单。
import { useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { generatePassword } from "../generator";
import type { GenOptions } from "../types";
import { hostToast, smallBtnClass } from "../ui";

interface GeneratorPanelProps {
  onUse: (password: string) => void;
}

export function GeneratorPanel({ onUse }: GeneratorPanelProps) {
  const [opts, setOpts] = useState<GenOptions>({ length: 20, lower: true, upper: true, digits: true, symbols: true });
  const [result, setResult] = useState<string>("");

  const gen = (): void => setResult(generatePassword(opts));

  const toggle = (k: "lower" | "upper" | "digits" | "symbols"): void => {
    setOpts((o) => {
      const next = { ...o, [k]: !o[k] };
      // 至少保留一类，避免生成空池
      if (!next.lower && !next.upper && !next.digits && !next.symbols) next.lower = true;
      return next;
    });
  };

  const checks: Array<{ key: "lower" | "upper" | "digits" | "symbols"; label: string }> = [
    { key: "lower", label: "小写 a-z" },
    { key: "upper", label: "大写 A-Z" },
    { key: "digits", label: "数字 0-9" },
    { key: "symbols", label: "符号 !@#" },
  ];

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/50 p-3">
      <div className="flex items-center gap-3">
        <label className="shrink-0 text-xs text-muted-foreground">长度</label>
        <input
          type="range"
          min={8}
          max={64}
          value={opts.length}
          onChange={(e) => setOpts((o) => ({ ...o, length: Number(e.target.value) }))}
          className="h-1.5 flex-1 accent-[hsl(var(--primary))]"
        />
        <span className="w-8 text-right font-mono text-xs">{opts.length}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {checks.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input type="checkbox" checked={opts[c.key]} onChange={() => toggle(c.key)} className="accent-[hsl(var(--primary))]" />
            {c.label}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button className={smallBtnClass} onClick={gen}>
          <RefreshCw className="h-3.5 w-3.5" />
          生成
        </button>
        {result && (
          <>
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-card px-2 py-1.5 font-mono text-xs">
              {result}
            </code>
            <button
              className={smallBtnClass}
              title="复制"
              onClick={() => {
                void navigator.clipboard.writeText(result).then(() => hostToast("已复制", undefined, "success"));
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button className={smallBtnClass} onClick={() => onUse(result)}>
              使用
            </button>
          </>
        )}
      </div>
    </div>
  );
}
