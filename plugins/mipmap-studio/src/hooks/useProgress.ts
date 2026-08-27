// 进度桥接：ops 直接驱动 progress store（原 Tauri 事件通道已移除）。
import { useEffect } from "react";
import { setProgressSink } from "@/lib/ops";
import { useProgressStore } from "@/store/useProgressStore";

export function useProgressListener(): void {
  const setActive = useProgressStore((s) => s.setActive);
  useEffect(() => {
    setProgressSink((e) => setActive(e));
    return () => setProgressSink(null);
  }, [setActive]);
}
