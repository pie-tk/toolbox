import { useEffect, useState } from "react";
import { HardDrive, ImageIcon } from "lucide-react";
import { useScan } from "@/hooks/useScan";
import { useProgressStore } from "@/store/useProgressStore";
import { appInfo } from "@/lib/commands";
import { formatBytes } from "@/lib/utils";
import type { AppInfo } from "@/lib/types";

const PHASE_LABEL: Record<string, string> = {
  rename: "重命名",
  delete: "删除",
  reverse: "反转",
};

export function StatusBar({ dir }: { dir: string }) {
  const { data } = useScan(dir);
  const active = useProgressStore((s) => s.active);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    appInfo()
      .then(setInfo)
      .catch(() => undefined);
  }, []);

  const entries = data?.entries ?? [];
  const totalFiles = entries.reduce((n, e) => n + e.occurrences.length, 0);
  const totalBytes = entries.reduce(
    (n, e) => n + e.occurrences.reduce((s, o) => s + o.sizeBytes, 0),
    0
  );

  const pct =
    active && active.total > 0
      ? Math.round((active.current / active.total) * 100)
      : 0;
  const phaseLabel = active ? PHASE_LABEL[active.phase] ?? active.phase : "";

  return (
    <footer className="flex items-center gap-4 border-t bg-card px-4 py-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <ImageIcon className="h-3.5 w-3.5" />
        {entries.length} 组 / {totalFiles} 个文件
      </span>
      <span className="flex items-center gap-1">
        <HardDrive className="h-3.5 w-3.5" />
        {formatBytes(totalBytes)}
      </span>

      {active && (
        <span className="flex items-center gap-2 text-primary">
          {phaseLabel}中… {active.current}/{active.total}
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </span>
        </span>
      )}

      <span className="ml-auto">
        v{info?.version ?? "0.1.0"} · {info?.platform ?? ""}
        {info?.arch ? ` · ${info.arch}` : ""}
      </span>
    </footer>
  );
}
