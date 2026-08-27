import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import type { ImageEntry } from "@/lib/types";
import { thumbObjectUrl } from "@/lib/ops";
import { cn } from "@/lib/utils";

interface ThumbnailProps {
  entry: ImageEntry;
  size?: number;
  className?: string;
}

/**
 * 缩略图：读取文件字节 → image-core 能力（wasm）解码缩放 → blob URL，
 * 带路径+mtime LRU 缓存。虚拟表格只挂载可见行，不可见行不产生工作量。
 */
export function Thumbnail({ entry, size = 64, className }: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  const occurrence =
    entry.occurrences.find((o) => o.path === entry.previewPath) ??
    entry.occurrences[0];
  const mtime = occurrence?.modified ?? 0;
  const path = occurrence?.path ?? "";

  useEffect(() => {
    let cancelled = false;
    setErrored(false);
    setUrl(null);
    if (!path) return;
    thumbObjectUrl(path, mtime, Math.ceil(size * 1.5))
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setErrored(true));
    return () => {
      cancelled = true;
    };
  }, [path, mtime, size]);

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted",
        className
      )}
      style={{ width: size, height: size }}
    >
      {!url && !errored && <div className="absolute inset-0 animate-pulse bg-muted" />}
      {errored ? (
        <ImageOff className="h-5 w-5 text-muted-foreground" />
      ) : url ? (
        <img
          src={url}
          alt={entry.name}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain"
        />
      ) : null}
    </div>
  );
}
