import { create } from "zustand";
import { checkForUpdate } from "@/lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";

/** 应用更新状态（非持久化）：启动 / 进入设置页 / 每 6 小时自动检查，
 *  侧边栏与设置页共享同一份结果。 */
interface UpdaterState {
  update: Update | null;
  checking: boolean;
  /** 最近一次检查完成的时间戳（ms）；null 表示从未检查过。 */
  lastCheckedAt: number | null;
  check: () => Promise<Update | null>;
}

export const useUpdaterStore = create<UpdaterState>()((set, get) => ({
  update: null,
  checking: false,
  lastCheckedAt: null,
  check: async () => {
    if (get().checking) return get().update;
    set({ checking: true });
    const up = await checkForUpdate();
    set({ update: up, checking: false, lastCheckedAt: Date.now() });
    return up;
  },
}));
