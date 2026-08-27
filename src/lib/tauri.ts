import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
}

let cached: Promise<AppInfo | null> | null = null;

/** 获取应用信息；在纯浏览器（非 Tauri）环境下返回 null。 */
export function getAppInfo(): Promise<AppInfo | null> {
  if (!cached) {
    cached = invoke<AppInfo>("app_info").catch(() => null);
  }
  return cached;
}
