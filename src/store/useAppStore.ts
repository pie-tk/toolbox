import { create } from "zustand";

export type View =
  | { type: "home" }
  | { type: "marketplace" }
  | { type: "settings" }
  | { type: "tool"; toolId: string };

interface AppState {
  view: View;
  /** 首页搜索词（放 store 中以便与市场页等共享）。 */
  search: string;
  openHome: () => void;
  openMarketplace: () => void;
  openSettings: () => void;
  openTool: (toolId: string) => void;
  setSearch: (search: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: { type: "home" },
  search: "",
  openHome: () => set({ view: { type: "home" } }),
  openMarketplace: () => set({ view: { type: "marketplace" } }),
  openSettings: () => set({ view: { type: "settings" } }),
  openTool: (toolId) => set({ view: { type: "tool", toolId } }),
  setSearch: (search) => set({ search }),
}));
