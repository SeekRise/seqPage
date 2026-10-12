/**
 * 内置图标集（本地 SVG 路径）
 *
 * 为什么自建图标集：
 * 组件库（如 TDesign）的 <t-icon> 通过远程 sprite 脚本渲染（CDN_ICONFONT_URL 写死在库内），
 * MV3 的 CSP 会拦截该脚本，导致所有图标空白；且任务书明确禁止运行时加载远程资源。
 * 这里用 24x24 网格的手写路径，随代码一起打包，完全离线可用。
 *
 * 图标命名尽量语义化，页面/分区图标既可以是这里的名字，也可以是 emoji 字符。
 */
import type { InjectionKey } from 'vue';

export const ICON_PATHS: Record<string, string> = {
  // 导航与结构
  grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
  briefcase:
    'M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3Zm2 0h2V5h-2v1ZM4 11h16',
  folder: 'M3 7a2 2 0 0 1 2-2h3.6l1.7 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  home: 'M4 11.5 12 4l8 7.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-7.5Z',
  star: 'M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8L12 3.6Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm.75-13.5v5.1l3.6 2.1',
  link: 'M10.6 13.4a3 3 0 0 0 4.2 0l3-3a3 3 0 0 0-4.2-4.2l-1 1M13.4 10.6a3 3 0 0 0-4.2 0l-3 3a3 3 0 0 0 4.2 4.2l1-1',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.2-2.3 3.4-5.2 3.4-9S14.2 5.3 12 3M12 21c-2.2-2.3-3.4-5.2-3.4-9S9.8 5.3 12 3M3.4 9h17.2M3.4 15h17.2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21',
  users:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a6 6 0 0 1 12 0M15 14.5a5 5 0 0 1 6 5.5',
  calendar:
    'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3-2v4m8-4v4M4 11h16',
  mail: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 .5 9 6 9-6',
  image:
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2.5 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 16l4.5-4.5L13 16l3-2.5 5 5',
  video: 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm12 5 5-3.5v9L16 11Z',
  music: 'M9 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 0V6l10-2v12m0 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  file: 'M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5',
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Zm0 15A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5Z',
  code: 'M9 7 4 12l5 5m6-10 5 5-5 5M13 4l-2 16',
  terminal: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 5 3 2.5L8 15m5 .5h4',
  database:
    'M12 8c4.4 0 8-1.1 8-2.5S16.4 3 12 3 4 4.1 4 5.5 7.6 8 12 8Zm8-2.5v13c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5v-13M20 12c0 1.4-3.6 2.5-8 2.5S4 13.4 4 12',
  server:
    'M4 5h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 9h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm3-5.5h.01M7 16.5h.01',
  cloud: 'M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 10.3A3.85 3.85 0 0 1 17.4 18H7Z',
  shield: 'M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Zm-2.5 9 1.8 1.8 3.7-3.8',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  wrench:
    'M14.5 4a5.5 5.5 0 0 0-5.2 7.3L4 16.6 7.4 20l5.3-5.3A5.5 5.5 0 0 0 20 9.5l-3 1.6-1.6-1.6L16.9 6.5A5.5 5.5 0 0 0 14.5 4Z',
  activity: 'M3 12h4l2.5-6 4 12 2.5-6h5',
  chart: 'M4 20V4m0 16h16M8 17V9m4 8V6m4 11v-5',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17.5 19 7',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  pencil: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Zm9.5-13 3 3',
  trash: 'M5 7h14M10 7V5h4v2m-7 0 1 13h8l1-13M10 11v6m4-6v6',
  copy: 'M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm-3 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1',
  move: 'M12 3v18M3 12h18M12 3 9 6m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5c0 .6-.06 1.2-.17 1.76l1.7 1.3-1.7 2.94-2.06-.83a7.9 7.9 0 0 1-3.05 1.77L14.2 21h-3.4l-.5-2.06a7.9 7.9 0 0 1-3.06-1.77l-2.06.83-1.7-2.94 1.7-1.3A8.3 8.3 0 0 1 5 12c0-.6.06-1.2.17-1.76l-1.7-1.3 1.7-2.94 2.06.83A7.9 7.9 0 0 1 10.3 5.06L10.8 3h3.4l.5 2.06a7.9 7.9 0 0 1 3.06 1.77l2.06-.83 1.7 2.94-1.7 1.3c.12.56.18 1.16.18 1.76Z',
  upload: 'M12 16V4m0 0L8 8m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  download: 'M12 4v12m0 0 4-4m-4 4-4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  chevronLeft: 'M14.5 6 9 12l5.5 6',
  chevronRight: 'M9.5 6 15 12l-5.5 6',
  chevronDown: 'M6 9.5 12 15l6-5.5',
  chevronUp: 'M6 14.5 12 9l6 5.5',
  collapse: 'M8 4v16M16 9l-3 3 3 3',
  expand: 'M8 4v16M13 9l3 3-3 3',
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm-6.5 9L3 13.5 12 18l9-4.5-2.5-1.5',
  filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13h.01M11 12h1v5h1',
  warning: 'M12 4l9 16H3l9-16Zm0 5v5m0 3h.01',
  archive: 'M4 6h16v3H4V6Zm1 3h14v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V9Zm5 4h4',
  history: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4m4 1v3.5l2.5 1.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-13v2m0 16v2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  monitor: 'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 14h8m-4-3v3',
  pin: 'M12 21v-6m0 0-4-4V4h8v7l-4 4Z',
};

export type BuiltinIconName = keyof typeof ICON_PATHS;

/** 判断字符串是否是内置图标名 */
export function isBuiltinIcon(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, value);
}

/** 判断字符串是否像 emoji / 单字符图标（用于自定义页面图标） */
export function isEmojiIcon(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // 单字符，或由 emoji 变体选择符/组合符构成
  return [...trimmed].length <= 3;
}

/** 可选的图标名列表（供图标选择器使用） */
export const SELECTABLE_ICONS: string[] = [
  'briefcase',
  'code',
  'shield',
  'home',
  'star',
  'grid',
  'book',
  'globe',
  'search',
  'users',
  'folder',
  'server',
  'database',
  'cloud',
  'terminal',
  'wrench',
  'chart',
  'activity',
  'lock',
  'calendar',
  'mail',
  'image',
  'video',
  'music',
  'file',
  'link',
  'layers',
  'filter',
  'archive',
  'history',
  'settings',
  'clock',
  'pin',
  'eye',
];

/** 常用 emoji 快速选择 */
export const SELECTABLE_EMOJI: string[] = [
  '💼',
  '💻',
  '🛡️',
  '🏠',
  '⭐',
  '📦',
  '🔧',
  '📊',
  '🌐',
  '🔍',
  '📚',
  '🗂️',
  '🚀',
  '🧪',
  '🎬',
  '🎵',
  '📷',
  '💰',
  '🧭',
  '⚙️',
  '☁️',
  '🔒',
  '📝',
  '🕒',
];

/** Vue 注入键：允许子树共享图标解析上下文（预留给未来扩展） */
export const ICON_CONTEXT_KEY: InjectionKey<{ size: number }> = Symbol('mynavi-icon-context');
