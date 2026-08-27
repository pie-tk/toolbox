import type { ComponentType } from "react";

/** 工具分类，侧边栏与首页按此分组展示。 */
export type ToolCategory =
  | "time"
  | "text"
  | "developer"
  | "file"
  | "image"
  | "other";

export interface ToolMeta {
  /** 唯一 ID（kebab-case），也是路由与插件目录名。 */
  id: string;
  name: string;
  version: string;
  description: string;
  category: ToolCategory;
  /** 搜索关键词。 */
  keywords: string[];
  icon: ComponentType<{ className?: string }>;
  /** builtin: 随主程序编译；external: 从市场下载安装。 */
  source: "builtin" | "external";
  /** 依赖的共享能力 ID（未就绪时禁止打开，可一键修复）。 */
  requires?: string[];
  /**
   * card: 标准工作区（头部 + 边距，适合轻量工具）；
   * fullscreen: 填满内容区，适合自带完整布局的重型工具。
   */
  layout?: "card" | "fullscreen";
}

/**
 * 一个已安装的工具模块。第二阶段的外部工具（下载 → 校验 → 安装）
 * 加载后同样以 ToolModule 的形式合并进注册表，对 UI 层完全透明。
 */
export interface ToolModule {
  meta: ToolMeta;
  component: ComponentType;
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  time: "时间",
  text: "文本",
  developer: "开发",
  file: "文件",
  image: "图像",
  other: "其他",
};

export const CATEGORY_ORDER: ToolCategory[] = [
  "time",
  "text",
  "developer",
  "file",
  "image",
  "other",
];
