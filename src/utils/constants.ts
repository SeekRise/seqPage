/**
 * 内置常量：搜索引擎、可关闭的默认项、图标选项、默认设置与演示数据。
 *
 * 搜索引擎集中在此处维护，组件中不得再散落硬编码的搜索地址。
 */
import type {
  AppSettings,
  BackgroundConfig,
  SearchEngine,
} from '@/types';
import { SCHEMA_VERSION } from '@/types';

/** 内置搜索引擎列表（地址模板统一维护，新增只需在此追加） */
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    urlTemplate: 'https://www.google.com/search?q={query}',
    icon: '🔍',
  },
  {
    id: 'bing',
    name: 'Bing',
    urlTemplate: 'https://www.bing.com/search?q={query}',
    icon: '🅱️',
  },
  {
    id: 'baidu',
    name: '百度',
    urlTemplate: 'https://www.baidu.com/s?wd={query}',
    icon: '百',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    urlTemplate: 'https://duckduckgo.com/?q={query}',
    icon: '🦆',
  },
  {
    id: 'github',
    name: 'GitHub',
    urlTemplate: 'https://github.com/search?q={query}',
    keyword: 'gh',
    icon: '🐙',
  },
  {
    id: 'mdn',
    name: 'MDN',
    urlTemplate: 'https://developer.mozilla.org/zh-CN/search?q={query}',
    keyword: 'mdn',
    icon: '📘',
  },
  {
    id: 'npm',
    name: 'npm',
    urlTemplate: 'https://www.npmjs.com/search?q={query}',
    keyword: 'npm',
    icon: '📦',
  },
] as const;

/** 默认搜索引擎 id */
export const DEFAULT_SEARCH_ENGINE_ID = 'google';

/** 按 id 查找搜索引擎，找不到时回退到默认引擎 */
export function findSearchEngine(id: string): SearchEngine {
  return (
    SEARCH_ENGINES.find((engine) => engine.id === id) ??
    SEARCH_ENGINES.find((engine) => engine.id === DEFAULT_SEARCH_ENGINE_ID) ??
    SEARCH_ENGINES[0]
  );
}

/** 按关键词前缀查找搜索引擎（如 gh vue） */
export function findSearchEngineByKeyword(keyword: string): SearchEngine | undefined {
  const value = keyword.toLowerCase();
  return SEARCH_ENGINES.find((engine) => engine.keyword?.toLowerCase() === value);
}

/** 用查询词填充搜索地址模板 */
export function buildSearchUrl(engine: SearchEngine, query: string): string {
  return engine.urlTemplate.replace('{query}', encodeURIComponent(query));
}

/** 背景默认配置 */
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  type: 'solid',
  color: '#eef2f8',
  gradientFrom: '#eaf1fb',
  gradientTo: '#dfe7f3',
  imageUrl: '',
  panelOpacity: 1,
  radius: 12,
};

/** 设置默认值 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultSearchEngine: DEFAULT_SEARCH_ENGINE_ID,
  defaultOpenMode: 'newTab',
  showDescription: true,
  cardDensity: 'comfortable',
  sidebarPosition: 'right',
  background: { ...DEFAULT_BACKGROUND },
  recentVisitsEnabled: true,
  searchHistoryEnabled: true,
  contextMenuEnabled: true,
  shortcutsEnabled: true,
  remoteFavicon: true,
  recentVisitsLimit: 30,
};

/** 深色模式下的默认背景（与浅色主题区分） */
export const DARK_BACKGROUND: BackgroundConfig = {
  type: 'solid',
  color: '#161a22',
  gradientFrom: '#171c26',
  gradientTo: '#10131a',
  imageUrl: '',
  panelOpacity: 1,
  radius: 12,
};

/** 分区可选主题色 */
export const SECTION_COLORS: readonly string[] = [
  '#3B6FE0',
  '#00A3A3',
  '#1E9E5A',
  '#E08A1E',
  '#D9534F',
  '#8E5BD9',
  '#0E7490',
  '#4F46E5',
  '#64748B',
];

/** 内置图标名（配合 SvgIcon 组件使用），也允许用户输入 emoji */
export const BUILTIN_ICONS: readonly string[] = [
  'briefcase',
  'code',
  'shield',
  'home',
  'star',
  'clock',
  'grid',
  'book',
  'cloud',
  'database',
  'terminal',
  'wrench',
  'chart',
  'globe',
  'lock',
  'server',
  'activity',
  'search',
  'users',
  'calendar',
  'mail',
  'image',
  'video',
  'music',
  'file',
  'folder',
  'link',
  'plus',
];

/** 新建页面时轮换使用的图标，避免所有页面长得一样 */
export const PAGE_ICON_ROTATION: readonly string[] = [
  'briefcase',
  'code',
  'shield',
  'home',
  'star',
  'grid',
  'book',
  'globe',
];

/** 导出文件大小上限：5 MB（防止导入异常文件导致页面卡死） */
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

/** 各字段长度上限（导入校验与表单校验共用） */
export const FIELD_LIMITS = {
  pageName: 40,
  sectionName: 40,
  websiteName: 80,
  websiteUrl: 2048,
  websiteDescription: 300,
  iconUrl: 4096,
  maxPages: 100,
  maxSectionsPerPage: 200,
  maxWebsitesPerSection: 500,
  maxRecentVisits: 200,
} as const;

/** 存储 schema 版本（从 types 重新导出，便于服务层引用） */
export { SCHEMA_VERSION };
