import { create } from "zustand";
import { fetchRegistry, type RegistryDoc } from "@/lib/plugins";

/**
 * 工具市场数据缓存：registry 数据保存在 store 中，离开页面不丢失；
 * 再次进入时先渲染缓存内容，同时后台刷新（stale-while-revalidate）。
 */
interface MarketState {
  doc: RegistryDoc | null;
  loadedAt: number | null;
  /** 上次成功加载所用源地址（源变化时清空旧数据）。 */
  url: string;
  error: string | null;
  fetching: boolean;
  fetch: (url: string) => Promise<void>;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  doc: null,
  loadedAt: null,
  url: "",
  error: null,
  fetching: false,
  fetch: async (url) => {
    if (get().fetching) return;
    if (get().url && get().url !== url) {
      set({ doc: null, loadedAt: null, url: "", error: null });
    }
    set({ fetching: true });
    try {
      const doc = await fetchRegistry(url);
      set({ doc, loadedAt: Date.now(), url, error: null, fetching: false });
    } catch (e) {
      // 保留旧数据继续展示，仅记录错误
      set({ error: e instanceof Error ? e.message : String(e), fetching: false });
    }
  },
}));
