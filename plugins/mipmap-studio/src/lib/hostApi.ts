// 宿主注入的运行上下文（mount 时设置）：共享能力 + 文件原语。
// 重型图像处理走 image-core 能力（wasm，与其他工具共享一份实例）。

export interface ImageCoreApi {
  probe(bytes: Uint8Array): { width: number; height: number; format: string };
  thumbnail(bytes: Uint8Array, maxW?: number, maxH?: number): Uint8Array;
  flip(bytes: Uint8Array): Uint8Array;
  convert(
    bytes: Uint8Array,
    format: 0 | 1 | 2,
    quality?: number,
    maxDim?: number
  ): Uint8Array;
}

interface HostContext {
  capability<T = unknown>(capId: string): Promise<T>;
}

let ctx: HostContext | null = null;

/** 由插件入口（main.tsx mount）调用。 */
export function setHostContext(c: HostContext): void {
  ctx = c;
}

/** 获取共享的 image-core 能力实例（全局一份）。 */
export async function imageCore(): Promise<ImageCoreApi> {
  if (!ctx) throw new Error("宿主上下文未初始化");
  return ctx.capability<ImageCoreApi>("image-core");
}
