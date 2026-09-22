/**
 * 密码保险库插件（自包含模块，不依赖宿主运行时代码）。
 * 导出 mount/unmount，由宿主注入工具工作区；样式用 Tailwind + 宿主 CSS 变量。
 *
 * 架构：模块级 vault store（vault.ts）跨页面切换存活（宿主 moduleCache），
 * 默认离开页面即锁定（lockOnLeave）；解锁期间明文只存在于内存。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Loader2 } from "lucide-react";
import {
  boot,
  getState,
  lock,
  openNew,
  retrySave,
  setView,
  subscribe,
} from "./vault";
import { loadSettings } from "./settings";
import { hostToast, isFormDirty, setFormDirty } from "./ui";
import type { VaultView } from "./types";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { ImportCsv } from "./components/ImportCsv";
import { LockScreen } from "./components/LockScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { SetupScreen } from "./components/SetupScreen";
import { VaultHeader } from "./components/VaultHeader";
import { ConfirmDialog } from "./components/ConfirmDialog";

function useVaultState() {
  return useSyncExternalStore(subscribe, getState);
}

/* ---- 闲置自动锁定（挂钟计时：睡眠唤醒后自然超时即锁） ---- */

let lastActivity = Date.now();

function useAutoLock(ref: React.RefObject<HTMLElement | null>, enabled: boolean, timeoutMs: number): void {
  useEffect(() => {
    if (!enabled || timeoutMs <= 0) return;
    const el = ref.current;
    if (!el) return;
    lastActivity = Date.now();
    const mark = (): void => {
      lastActivity = Date.now();
    };
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    el.addEventListener("pointerdown", mark, opts);
    el.addEventListener("keydown", mark, opts);
    el.addEventListener("wheel", mark, opts);
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity > timeoutMs) {
        lock();
        hostToast("已自动锁定", "长时间无操作");
      }
    }, 5000);
    return () => {
      el.removeEventListener("pointerdown", mark, opts);
      el.removeEventListener("keydown", mark, opts);
      el.removeEventListener("wheel", mark, opts);
      window.clearInterval(timer);
    };
  }, [ref, enabled, timeoutMs]);
}

/* ---- 应用外壳 ---- */

function VaultApp() {
  const st = useVaultState();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [pendingView, setPendingView] = useState<VaultView | null>(null);
  const settings = loadSettings();

  useEffect(() => {
    void boot();
  }, []);

  useAutoLock(rootRef, st.status === "unlocked", settings.autoLockMinutes * 60_000);

  /** 视图切换统一入口：脏表单保护。 */
  const requestView = (v: VaultView): void => {
    if (v === "form") {
      openNew(); // 新增 = 清空 editingId 进入表单
      return;
    }
    if (st.view === "form" && isFormDirty()) {
      setPendingView(v);
      return;
    }
    setView(v);
  };

  const backToList = (): void => requestView("list");

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 提示条 */}
      {st.storageMode === "ls" && (
        <div className="border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning">
          浏览器开发模式：数据仅存于本页 localStorage，仅供调试。
        </div>
      )}
      {st.saveError && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1 truncate">{st.saveError}</span>
          <button
            className="shrink-0 rounded border border-destructive/50 px-2 py-0.5 transition-colors hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => retrySave()}
          >
            重试
          </button>
        </div>
      )}
      {st.notice && !st.saveError && (
        <div className="border-b border-warning/40 bg-warning/10 px-4 py-1.5 text-xs text-warning">
          {st.notice}
        </div>
      )}

      {st.status === "booting" && (
        <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载保险库…
        </div>
      )}
      {st.status === "no-vault" && <SetupScreen />}
      {st.status === "locked" && <LockScreen />}
      {st.status === "unlocked" && (
        <>
          <VaultHeader
            view={st.view}
            count={st.entries?.length ?? 0}
            query={query}
            onQueryChange={setQuery}
            onRequestView={requestView}
            onLock={lock}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {st.view === "list" && (
              <EntryList query={query} onNew={() => requestView("form")} onImport={() => requestView("import")} />
            )}
            {st.view === "form" && <EntryForm onBack={backToList} />}
            {st.view === "import" && <ImportCsv onDone={backToList} />}
            {st.view === "settings" && <SettingsPanel />}
          </div>
        </>
      )}

      <ConfirmDialog
        open={pendingView !== null}
        title="放弃未保存的修改？"
        description="当前表单内容尚未保存，离开将丢失修改。"
        confirmText="放弃修改"
        danger
        onCancel={() => setPendingView(null)}
        onConfirm={() => {
          setFormDirty(false);
          if (pendingView) setView(pendingView);
          setPendingView(null);
        }}
      />
    </div>
  );
}

/* ---- 插件生命周期 ---- */

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement | null = null;

export function mount(container: HTMLElement): void {
  host = document.createElement("div");
  host.className = "h-full";
  container.appendChild(host);
  root = createRoot(host);
  root.render(<VaultApp />);
}

export function unmount(): void {
  // 默认离开页面即锁定（设置可关）；剪贴板清除计时器模块级保留
  if (loadSettings().lockOnLeave) lock();
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}
