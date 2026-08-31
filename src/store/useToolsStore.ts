import { create } from "zustand";
import {
  listInstalled,
  manifestToMeta,
  startBackgroundPlugins,
  type InstalledRecord,
} from "@/lib/plugins";
import { invoke } from "@tauri-apps/api/core";
import { builtinTools } from "@/tools/registry";
import type { ToolMeta } from "@/types/tool";

/**
 * 工具注册表（运行时）：内置工具（静态）+ 外部插件（从安装目录读取 manifest），
 * 以及已安装的共享能力（wasm）。市场安装/卸载后调用 refresh() 自动更新。
 */
interface ToolsState {
  records: Record<string, InstalledRecord>;
  capabilities: Record<string, InstalledRecord>;
  metas: ToolMeta[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useToolsStore = create<ToolsState>((set) => ({
  records: {},
  capabilities: {},
  metas: builtinTools.map((t) => t.meta),
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [installed, caps] = await Promise.all([
        listInstalled(),
        invoke<InstalledRecord[]>("capability_list_installed"),
      ]);
      const records: Record<string, InstalledRecord> = {};
      for (const rec of installed) records[rec.id] = rec;
      const capabilities: Record<string, InstalledRecord> = {};
      for (const rec of caps) capabilities[rec.id] = rec;
      const metas = [
        ...builtinTools.map((t) => t.meta),
        ...installed.map((r) => manifestToMeta(r.manifest)),
      ];
      set({ records, capabilities, metas, loading: false });
      // 启动声明 background 的插件（应用启动与市场安装后都会走 refresh，幂等）。
      void startBackgroundPlugins(Object.values(records));
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },
}));
