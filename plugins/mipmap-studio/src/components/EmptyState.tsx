import { FolderOpen, Layers } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-muted-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-border/60">
        <Layers className="h-9 w-9" />
      </div>
      <div>
        <div className="text-lg font-semibold text-foreground">Mipmap Studio</div>
        <div className="mt-1 text-sm">选择 Android 项目的 res 目录，或直接将文件夹拖入窗口</div>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <FolderOpen className="h-3.5 w-3.5" />
        支持 mipmap-* / drawable-* 资源图片
      </div>
    </div>
  );
}
