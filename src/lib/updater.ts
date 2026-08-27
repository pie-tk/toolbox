import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** 检查更新；网络不可达等异常静默返回 null（不打扰用户）。 */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    return null;
  }
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

/** 下载并安装更新（Windows NSIS：静默安装后由调用方触发重启）。 */
export async function downloadAndInstall(
  update: Update,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        break;
      case "Finished":
        break;
    }
    onProgress?.({ downloaded, total });
  });
}

export { relaunch };
export type { Update };
