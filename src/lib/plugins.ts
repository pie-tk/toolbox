import { invoke } from "@tauri-apps/api/core";
import { Binary, Braces, Clock, Hash, Home, Image, Images, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import type { ToolCategory, ToolMeta } from "@/types/tool";

/** ---- 与 Rust plugin 模块约定的 IPC 类型（camelCase） ---- */

export interface PluginManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description: string;
  category: ToolCategory;
  keywords?: string[];
  /** 图标名，宿主映射为 lucide 组件。 */
  icon?: string;
  layout?: "card" | "fullscreen";
  entry: string;
  style?: string;
  minAppVersion?: string;
  /** 依赖的共享能力：{ "<能力id>": "<版本范围>" }，安装时自动补齐。 */
  requires?: Record<string, string>;
}

export interface RegistryPackage {
  file: string;
  sha256: string;
  size: number;
}

export interface RegistryTool {
  manifest: PluginManifest;
  package: RegistryPackage;
}

export interface RegistryDoc {
  schemaVersion: number;
  generatedAt: string;
  tools: RegistryTool[];
  /** schemaVersion 2 起支持共享能力（wasm），与工具同构。 */
  capabilities: RegistryTool[];
}

export interface InstalledRecord {
  id: string;
  version: string;
  rootDir: string;
  manifest: PluginManifest;
}

/** ---- 插件模块契约：module.js 的导出 ---- */

/** 插件运行上下文：宿主注入的受控能力（共享 wasm 能力、宿主桥）。 */
export interface PluginContext {
  /** 获取共享能力（如 image-core）：全局仅实例化一份，多工具复用。 */
  capability<T = unknown>(capId: string): Promise<T>;
}

export interface PluginModule {
  mount(container: HTMLElement, ctx?: PluginContext): void;
  unmount?(): void;
}

/** ---- 图标注册表：manifest 中的图标名 → lucide 组件 ---- */

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  clock: Clock,
  images: Images,
  image: Image,
  braces: Braces,
  hash: Hash,
  binary: Binary,
  home: Home,
};

export function iconFromName(name?: string): ComponentType<{ className?: string }> {
  return (name && ICONS[name]) || Wrench;
}

export function manifestToMeta(m: PluginManifest): ToolMeta {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    category: m.category,
    keywords: m.keywords ?? [],
    icon: iconFromName(m.icon),
    source: "external",
    layout: m.layout ?? "card",
    requires: Object.keys(m.requires ?? {}),
  };
}

/** 工具依赖中尚未就绪的能力（返回 ID 列表，空数组 = 可用）。 */
export function unmetRequires(
  requires: string[] | undefined,
  capabilities: Record<string, unknown>
): string[] {
  return (requires ?? []).filter((id) => !capabilities[id]);
}

/** ---- IPC 封装 ---- */

export function fetchRegistry(url: string): Promise<RegistryDoc> {
  return invoke<RegistryDoc>("plugin_fetch_registry", { url });
}

export function installTool(registryUrl: string, toolId: string): Promise<InstalledRecord> {
  return invoke<InstalledRecord>("plugin_install", { registryUrl, toolId });
}

/** 修复工具缺失的依赖能力（能力目录被删/损坏时）。 */
export function repairCapabilities(
  registryUrl: string,
  toolId: string
): Promise<InstalledRecord[]> {
  return invoke<InstalledRecord[]>("plugin_repair_capabilities", { registryUrl, toolId });
}

export function uninstallTool(toolId: string): Promise<void> {
  return invoke<void>("plugin_uninstall", { toolId });
}

export function listInstalled(): Promise<InstalledRecord[]> {
  return invoke<InstalledRecord[]>("plugin_list_installed");
}

/** ---- 模块加载：读文件 → blob URL → 动态 import（绕开跨源限制） ---- */

// 缓存键带版本：插件更新安装后新版本自然失效，旧版本模块不会继续被喂给页面。
const moduleCache = new Map<string, PluginModule>();

export async function loadPluginModule(record: InstalledRecord): Promise<PluginModule> {
  const cacheKey = `${record.id}@${record.version}`;
  const cached = moduleCache.get(cacheKey);
  if (cached) return cached;
  const js = await invoke<string>("plugin_read_file", {
    toolId: record.id,
    file: record.manifest.entry,
  });
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule;
    if (typeof mod.mount !== "function") {
      throw new Error(`插件 ${record.id} 缺少 mount 导出`);
    }
    moduleCache.set(cacheKey, mod);
    return mod;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 注入插件样式（同 id 重复安装时替换旧样式）。 */
export async function loadPluginStyle(record: InstalledRecord): Promise<void> {
  const style = record.manifest.style;
  if (!style) return;
  const css = await invoke<string>("plugin_read_file", {
    toolId: record.id,
    file: style,
  });
  const tagId = `plugin-style-${record.id}`;
  let tag = document.getElementById(tagId) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = tagId;
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

/** 卸载后清理缓存的模块与样式。 */
export function evictPlugin(id: string): void {
  // 缓存键为 id@version，同时兼容历史裸 id 键
  for (const key of [...moduleCache.keys()]) {
    if (key === id || key.startsWith(`${id}@`)) moduleCache.delete(key);
  }
  document.getElementById(`plugin-style-${id}`)?.remove();
}

/** ---- 共享能力加载：wasm 实例化一次，跨工具复用 ---- */

const capabilityCache = new Map<string, unknown>();

/** 获取共享能力实例（bridge.js 导出的对象，含 init 后的 wasm API）。 */
export async function getCapability<T = unknown>(capId: string): Promise<T> {
  const cached = capabilityCache.get(capId);
  if (cached) return cached as T;

  const bridgeSrc = await invoke<string>("capability_read_file", {
    capId,
    file: "bridge.js",
  });
  const url = URL.createObjectURL(new Blob([bridgeSrc], { type: "text/javascript" }));
  let bridge: { init(bytes: Uint8Array): Promise<void> };
  try {
    bridge = (await import(/* @vite-ignore */ url)) as {
      init(bytes: Uint8Array): Promise<void>;
    };
    URL.revokeObjectURL(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }

  // wasm 二进制走原始 IPC 通道（ArrayBuffer / Uint8Array）。
  const raw = await invoke<ArrayBuffer | Uint8Array>("capability_read_wasm", { capId });
  const wasmBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  await bridge.init(wasmBytes);

  capabilityCache.set(capId, bridge);
  return bridge as T;
}

/** 卸载能力后清理实例（重装新版本时需要重新实例化）。 */
export function evictCapability(capId: string): void {
  capabilityCache.delete(capId);
}
