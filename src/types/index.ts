/**
 * My Navi 数据模型定义
 *
 * 设计原则：
 * - 所有实体使用稳定唯一 ID（时间戳 + 随机串），绝不用数组下标当业务 ID。
 * - 排序使用独立的 order 字段（升序，数字越小越靠前）。
 * - 关联关系显式声明：Section.pageId、Website.pageId + Website.sectionId。
 * - 通过 schemaVersion 管理配置版本，便于未来迁移。
 */

/** 当前配置结构版本。修改数据结构时同步 +1 并在 storage 中补充迁移逻辑。 */
export const SCHEMA_VERSION = 1;

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 卡片紧凑程度 */
export type CardDensity = 'compact' | 'comfortable' | 'loose';

/** 侧边导航栏的位置（用户可在设置中调整） */
export type SidebarPosition = 'left' | 'right';

/** 网站默认打开方式 */
export type OpenMode = 'newTab' | 'currentTab';

/** 网站图标来源类型 */
export type IconType = 'auto' | 'url' | 'text';

/** 导航页面（右侧栏中的独立工作空间） */
export interface NavigationPage {
  id: string;
  name: string;
  /** 图标：内置图标名或 emoji 字符 */
  icon: string;
  /** 排序位置 */
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** 分区（隶属于某个导航页面） */
export interface Section {
  id: string;
  pageId: string;
  name: string;
  /** 图标：内置图标名或 emoji 字符 */
  icon: string;
  /** 主题色（十六进制），用于图标底色 */
  color: string;
  order: number;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 网站卡片（隶属于某个分区，同时冗余记录 pageId 便于校验与统计） */
export interface Website {
  id: string;
  pageId: string;
  sectionId: string;
  name: string;
  url: string;
  description: string;
  /** 用户自定义图标地址；为空时由 iconType 决定取值方式 */
  icon: string;
  iconType: IconType;
  openInNewTab: boolean;
  favorite: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
}

/** 背景配置 */
export interface BackgroundConfig {
  /** 背景类型：纯色 / 渐变 / 自定义图片 URL */
  type: 'solid' | 'gradient' | 'image';
  /** type=solid 时的颜色 */
  color: string;
  /** type=gradient 时的两个颜色 */
  gradientFrom: string;
  gradientTo: string;
  /** type=image 时的图片地址（支持 http(s)/data:image） */
  imageUrl: string;
  /** 卡片面板背景不透明度 0.4 ~ 1 */
  panelOpacity: number;
  /** 卡片圆角 0 ~ 20 */
  radius: number;
}

/** 应用设置 */
export interface AppSettings {
  theme: ThemeMode;
  /** 顶部搜索栏使用的默认搜索引擎 id */
  defaultSearchEngine: string;
  defaultOpenMode: OpenMode;
  showDescription: boolean;
  cardDensity: CardDensity;
  /** 侧边导航栏显示在左侧还是右侧 */
  sidebarPosition: SidebarPosition;
  background: BackgroundConfig;
  recentVisitsEnabled: boolean;
  searchHistoryEnabled: boolean;
  /** 是否启用卡片/分区/页面的右键菜单 */
  contextMenuEnabled: boolean;
  /** 是否启用键盘快捷键（/ 聚焦搜索、Ctrl+K 等） */
  shortcutsEnabled: boolean;
  /** 是否为网站卡片请求远程 favicon（关闭后完全离线） */
  remoteFavicon: boolean;
  /** 最近访问记录保留条数上限 */
  recentVisitsLimit: number;
}

/** 最近访问记录（只记录本扩展主动发起的导航） */
export interface RecentVisit {
  id: string;
  websiteId: string;
  name: string;
  url: string;
  icon: string;
  iconType: IconType;
  pageId: string;
  sectionId: string;
  visitedAt: number;
}

/** 完整配置快照（导入导出的结构） */
export interface NaviState {
  schemaVersion: number;
  pages: NavigationPage[];
  sections: Section[];
  websites: Website[];
  settings: AppSettings;
  recentVisits: RecentVisit[];
}

/** 导出文件结构（在 NaviState 基础上增加元信息） */
export interface ExportPayload {
  app: 'my-navi';
  schemaVersion: number;
  exportedAt: string;
  /** 是否包含最近访问记录 */
  includesRecentVisits: boolean;
  data: NaviState;
}

/** 导入校验结果 */
export interface ImportValidation {
  ok: boolean;
  /** 面向用户的错误说明（ok=false 时一定有值） */
  message: string;
  /** 成功解析并规范化后的数据 */
  state: NaviState | null;
  /** 非致命提示，例如「已自动修复 N 条无效数据」 */
  warnings: string[];
  /** 统计信息，用于确认弹窗展示 */
  stats: {
    pages: number;
    sections: number;
    websites: number;
    recentVisits: number;
  } | null;
}

/** 本地导航搜索结果 */
export interface SearchResult {
  website: Website;
  page: NavigationPage | undefined;
  section: Section | undefined;
  /** 命中的字段，用于结果高亮说明 */
  matchedFields: string[];
}

/** 搜索引擎定义 */
export interface SearchEngine {
  id: string;
  name: string;
  /** 查询地址模板，使用 {query} 占位 */
  urlTemplate: string;
  /** 关键词快捷前缀，如 gh 对应 Github */
  keyword?: string;
  /** 图标字符（emoji），避免依赖远程图标资源 */
  icon: string;
}

/** 通用上下文菜单项 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  /** 危险操作使用警示样式 */
  danger?: boolean;
  disabled?: boolean;
  /** 分隔线 */
  divider?: boolean;
  /** 快捷键提示文案 */
  hint?: string;
  onSelect?: () => void;
}

/** 存储写入结果 */
export interface SaveResult {
  ok: boolean;
  message?: string;
}

/** 数据完整性检查报告 */
export interface IntegrityReport {
  /** 被清理的孤立分区数量 */
  orphanSections: number;
  /** 被清理的孤立网站数量 */
  orphanWebsites: number;
  /** 被重新归属分区的网站数量 */
  reassignedWebsites: number;
  /** 被修复的非法 URL 数量 */
  invalidUrls: number;
  /** 被重新编号的排序字段数量 */
  reordered: number;
}
