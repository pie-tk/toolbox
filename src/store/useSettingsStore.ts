import { create } from "zustand";
import { persist } from "zustand/middleware";

/** 默认源：GitHub Pages（推送后约 1 分钟生效，不受 CDN 分支缓存影响）。
 *  备选：jsDelivr CDN（国内可达性好，但分支缓存更新慢）
 *  https://cdn.jsdelivr.net/gh/pie-tk/toolbox-registry@main/registry.json */
export const DEFAULT_REGISTRY_URL =
  "https://pie-tk.github.io/toolbox-registry/registry.json";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 240;

interface SettingsState {
  /** 工具市场 registry.json 的地址（GitHub Pages / Releases / 本地开发服务器）。 */
  registryUrl: string;
  sidebarWidth: number;
  setRegistryUrl: (url: string) => void;
  setSidebarWidth: (width: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      registryUrl: DEFAULT_REGISTRY_URL,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      setRegistryUrl: (registryUrl) => set({ registryUrl }),
      setSidebarWidth: (sidebarWidth) =>
        set({
          sidebarWidth: Math.min(
            SIDEBAR_MAX_WIDTH,
            Math.max(SIDEBAR_MIN_WIDTH, Math.round(sidebarWidth))
          ),
        }),
    }),
    {
      name: "toolbox-settings",
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsState> | undefined;
        // v0 → v1：本地 dev 地址迁移为远程地址。
        if (
          version < 1 &&
          state?.registryUrl === "http://localhost:1420/registry.json"
        ) {
          state.registryUrl = DEFAULT_REGISTRY_URL;
        }
        // v1 → v2：jsDelivr 默认源更换为 GitHub Pages（分支缓存更新过慢）。
        if (
          version < 2 &&
          state?.registryUrl ===
            "https://cdn.jsdelivr.net/gh/pie-tk/toolbox-registry@main/registry.json"
        ) {
          state.registryUrl = DEFAULT_REGISTRY_URL;
        }
        return state as SettingsState;
      },
    }
  )
);
