/**
 * Mipmap Studio 插件（自包含模块）。
 * 从 mipmap-studio 项目整体迁移：完整 UI + react-query + toast，
 * Rust 能力（扫描/重命名/缩略图协议等）由宿主提供。
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { ImageTable } from "@/components/ImageTable";
import { SearchBar } from "@/components/SearchBar";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { TopBar } from "@/components/TopBar";
import { useProgressListener } from "@/hooks/useProgress";
import { useImageOps } from "@/hooks/useImageOps";
import { confirmDialog } from "@/store/useConfirmStore";
import { setHostContext } from "@/lib/hostApi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function MipmapStudioApp() {
  const [dir, setDir] = useState("");
  useProgressListener();
  const ops = useImageOps(dir);

  // Drag-and-drop a folder anywhere onto the window to open it.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWebviewWindow();
    appWindow
      .onDragDropEvent((event) => {
        const payload = event.payload as
          | { type?: string; paths?: string[] }
          | null;
        if (payload?.type === "drop" && payload.paths && payload.paths.length > 0) {
          setDir(payload.paths[0]);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);
    return () => unlisten?.();
  }, []);

  async function handleDelete(id: string) {
    const ok = await confirmDialog({
      title: "删除图片",
      description: `确定删除「${id}」及其所有分辨率版本？此操作可撤销。`,
      destructive: true,
      confirmText: "删除",
    });
    if (ok) ops.remove.mutate([id]);
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TopBar dir={dir} onPick={setDir} />
      <Toolbar dir={dir} />
      <SearchBar />
      <main className="min-h-0 flex-1">
        {dir ? (
          <ImageTable dir={dir} onDelete={handleDelete} />
        ) : (
          <EmptyState />
        )}
      </main>
      <StatusBar dir={dir} />
      <ConfirmDialog />
      <Toaster position="bottom-right" theme="system" richColors closeButton />
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
  if (ctx) setHostContext(ctx);
  host = document.createElement("div");
  host.className = "h-full";
  container.appendChild(host);
  root = createRoot(host);
  root.render(
    <QueryClientProvider client={queryClient}>
      <MipmapStudioApp />
    </QueryClientProvider>
  );
}

export function unmount(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
