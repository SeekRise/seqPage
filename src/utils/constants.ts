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

/** 内置搜索引擎列表（地址模板统一维护，新增只需在此追加；图标为本地品牌 SVG） */
export const SEARCH_ENGINES: readonly SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    urlTemplate: 'https://www.google.com/search?q={query}',
    icon: 'brandGoogle',
    color: '#4285F4',
  },
  {
    id: 'bing',
    name: 'Bing',
    urlTemplate: 'https://www.bing.com/search?q={query}',
    icon: 'brandBing',
    color: '#008373',
  },
  {
    id: 'baidu',
    name: '百度',
    urlTemplate: 'https://www.baidu.com/s?wd={query}',
    icon: 'brandBaidu',
    color: '#2932E1',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    urlTemplate: 'https://duckduckgo.com/?q={query}',
    icon: 'brandDuckduckgo',
    color: '#DE5833',
  },
  {
    id: 'github',
    name: 'GitHub',
    urlTemplate: 'https://github.com/search?q={query}',
    keyword: 'gh',
    icon: 'brandGithub',
  },
  {
    id: 'mdn',
    name: 'MDN',
    urlTemplate: 'https://developer.mozilla.org/zh-CN/search?q={query}',
    keyword: 'mdn',
    icon: 'brandMdn',
  },
  {
    id: 'npm',
    name: 'npm',
    urlTemplate: 'https://www.npmjs.com/search?q={query}',
    keyword: 'npm',
    icon: 'brandNpm',
    color: '#CB3837',
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

/**
 * 浅色主题默认页面背景。
 * 与 `styles/variables.css` 的 `--bg-page` 必须保持一致（改一处同步另一处）。
 */
export const LIGHT_PAGE_COLOR = '#f5f6f8';

/** 背景默认配置 */
export const DEFAULT_BACKGROUND: BackgroundConfig = {
  type: 'solid',
  color: LIGHT_PAGE_COLOR,
  gradientFrom: '#eaf1fb',
  gradientTo: '#dfe7f3',
  imageUrl: '',
  panelOpacity: 1,
  radius: 12,
};

/**
 * 设置默认值。
 *
 * 注意 remoteFavicon 默认关闭：第三方 favicon 服务会发起跨站请求，
 * 默认不启用以保证「断网可用、不依赖在线服务」；用户可在设置中自行开启。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  defaultSearchEngine: DEFAULT_SEARCH_ENGINE_ID,
  defaultOpenMode: 'newTab',
  showDescription: true,
  cardDensity: 'comfortable',
  sidebarPosition: 'left',
  sidebarVisible: true,
  sidebarAutoHide: false,
  showClock: true,
  background: { ...DEFAULT_BACKGROUND },
  recentVisitsEnabled: true,
  searchHistoryEnabled: true,
  contextMenuEnabled: true,
  shortcutsEnabled: true,
  remoteFavicon: false,
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

/**
 * 背景图上传约束。
 *
 * 图片压缩后以 data URL 直接存进 `mynavi:state`（单一物理键），所以最终体积
 * 必须留足余量：chrome.storage.local 配额约 10 MB，且导出文件上限是 5 MB。
 * 最长边 1920 是「1080p 及以上铺满不糊」与「体积可控」的折中。
 */
export const BACKGROUND_IMAGE_LIMITS = {
  /** 原文件大小上限 */
  maxFileBytes: 8 * 1024 * 1024,
  /** 压缩后最长边（px） */
  maxEdge: 1920,
  /** 编码质量（WebP） */
  quality: 0.85,
  /** 压缩后 data URL 字符数上限（≈ 字节数） */
  maxDataUrlChars: 1.5 * 1024 * 1024,
} as const;

/**
 * 新建操作的数量硬上限（新建分区 / 新建网站 / 移入网站时的守卫）。
 *
 * 与 FIELD_LIMITS 里的 maxSectionsPerPage / maxWebsitesPerSection **刻意分开**：
 * 后者是导入校验用的宽松阈值（只在异常备份时才裁剪），这里是新建时的守卫——
 * 历史数据与导入的备份都不受它裁剪，只是不能再往上加。
 * 所以调这里的数字不会动到任何用户已有数据，改起来是安全的。
 */
export const CREATION_LIMITS = {
  /** 一个导航页面最多几个分区（超过后分区卡片会顶出页面，失去一屏概览的意义） */
  maxSectionsPerPage: 4,
  /** 一个分区最多几个网站（约一屏高度，避免分区卡片长到需要长距离滚动） */
  maxWebsitesPerSection: 12,
} as const;

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
