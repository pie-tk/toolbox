import type { ToolModule } from "@/types/tool";

/**
 * 内置工具：随主程序编译发布。
 * 当前为空——两个工具（时间戳转换、Mipmap Studio）已改为外部插件，
 * 从工具市场下载安装（见 plugins/ 目录与 npm run build:plugins）。
 */
export const builtinTools: ToolModule[] = [];

export function getBuiltinTool(id: string): ToolModule | undefined {
  return builtinTools.find((t) => t.meta.id === id);
}
