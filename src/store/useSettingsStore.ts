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

/** 历史源记录上限。 */
const REGISTRY_HISTORY_LIMIT = 10;

interface SettingsState {
  /** 工具市场 registry.json 的地址（GitHub Pages / Releases / 本地开发服务器）。 */
  registryUrl: string;
  /** 使用过的 registry 地址（新的在前，去重，上限 10 条）。 */
  registryHistory: string[];
  sidebarWidth: number;
  setRegistryUrl: (url: string) => void;
  removeRegistryHistory: (url: string) => void;
  clearRegistryHistory: () => void;
  setSidebarWidth: (width: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      registryUrl: DEFAULT_REGISTRY_URL,
      registryHistory: [],
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      setRegistryUrl: (registryUrl) =>
        set((state) => {
          const url = registryUrl.trim();
          const history = [
            url,
            ...state.registryHistory.filter((u) => u !== url),
          ].slice(0, REGISTRY_HISTORY_LIMIT);
          return { registryUrl: url, registryHistory: history };
        }),
      removeRegistryHistory: (url) =>
        set((state) => ({
          registryHistory: state.registryHistory.filter((u) => u !== url),
        })),
      clearRegistryHistory: () => set({ registryHistory: [] }),
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
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        // v0 → v1：本地 dev 地址迁移为远程地址。
        if (
          version < 1 &&
          state.registryUrl === "http://localhost:1420/registry.json"
        ) {
          state.registryUrl = DEFAULT_REGISTRY_URL;
        }
        // v1 → v2：jsDelivr 默认源更换为 GitHub Pages（分支缓存更新过慢）。
        if (
          version < 2 &&
          state.registryUrl ===
            "https://cdn.jsdelivr.net/gh/pie-tk/toolbox-registry@main/registry.json"
        ) {
          state.registryUrl = DEFAULT_REGISTRY_URL;
        }
        // v2 → v3：新增历史源记录，老用户当前源回填为第一条记录。
        if (version < 3) {
          const prev = state.registryHistory;
          const url = state.registryUrl;
          state.registryHistory = Array.isArray(prev)
            ? prev
            : url
              ? [url]
              : [];
        }
        return state as SettingsState;
      },
    }
  )
);
