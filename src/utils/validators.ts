/**
 * 领域校验：表单校验 + 导入数据校验共用同一套规则，避免两处逻辑不一致（DRY）。
 *
 * 所有校验函数返回 ValidationResult，message 必须是可直接展示给用户的中文提示，
 * 说明「问题是什么」以及「怎么处理」。
 */
import type {
  AppSettings,
  CardDensity,
  IconType,
  NavigationPage,
  OpenMode,
  RecentVisit,
  Section,
  SidebarPosition,
  ThemeMode,
  Website,
} from '@/types';
import { FIELD_LIMITS } from '@/utils/constants';
import { normalizeUrl } from '@/utils/url';

export interface ValidationResult {
  ok: boolean;
  message: string;
}

const OK: ValidationResult = { ok: true, message: '' };

function fail(message: string): ValidationResult {
  return { ok: false, message };
}

/** 判断是否为普通对象 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把"数组或类数组对象"统一成数组。
 *
 * 为什么需要：早期构建把数组序列化成了以数字为键的对象
 * （`{"0":{…},"1":{…}}`）。若只用 Array.isArray 判定，就会把完全正常的
 * 用户配置误判为"数据损坏"而拒绝加载。这里做宽松兼容：
 * - 真数组 → 原样返回；
 * - 对象且键全为数字字符串 → 按键的数值升序取值（等价于原数组顺序）；
 * - 对象但键名不是数字（被包裹了一层）→ 尝试取出其中的数组字段；
 * - 其它类型 → 返回 null（确实无法解析）。
 */
export function coerceArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isPlainObject(value)) return null;

  const keys = Object.keys(value);
  if (keys.length === 0) return [];

  const numericKeys = keys.filter((key) => /^\d+$/.test(key));
  if (numericKeys.length === keys.length) {
    return numericKeys.sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);
  }

  for (const key of ['data', 'items', 'list', 'value']) {
    if (key in value) {
      const nested = coerceArray(value[key]);
      if (nested) return nested;
    }
  }

  return null;
}

/** 字符串字段校验（带长度上限） */
export function validateText(
  value: unknown,
  label: string,
  options: { required?: boolean; max?: number } = {},
): ValidationResult {
  const { required = false, max = 200 } = options;
  if (value === undefined || value === null) {
    return required ? fail(`${label}不能为空。`) : OK;
  }
  if (typeof value !== 'string') {
    return fail(`${label}必须是文本。`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    return fail(`${label}不能为空。`);
  }
  if (trimmed.length > max) {
    return fail(`${label}过长，最多 ${max} 个字符（当前 ${trimmed.length} 个）。`);
  }
  return OK;
}

/** 页面名称校验 */
export function validatePageName(name: unknown): ValidationResult {
  return validateText(name, '页面名称', { required: true, max: FIELD_LIMITS.pageName });
}

/** 分区名称校验 */
export function validateSectionName(name: unknown): ValidationResult {
  return validateText(name, '分区名称', { required: true, max: FIELD_LIMITS.sectionName });
}

/** 网站名称校验 */
export function validateWebsiteName(name: unknown): ValidationResult {
  return validateText(name, '网站名称', { required: true, max: FIELD_LIMITS.websiteName });
}

/** 网站描述校验 */
export function validateWebsiteDescription(description: unknown): ValidationResult {
  return validateText(description, '网站描述', { max: FIELD_LIMITS.websiteDescription });
}

/** 网站地址校验（含协议白名单） */
export function validateWebsiteUrl(url: unknown): ValidationResult {
  if (typeof url !== 'string' || !url.trim()) {
    return fail('网站地址不能为空。');
  }
  const check = normalizeUrl(url);
  if (!check.ok) return fail(check.message);
  if (check.url.length > FIELD_LIMITS.websiteUrl) {
    return fail(`网站地址过长，最多 ${FIELD_LIMITS.websiteUrl} 个字符。`);
  }
  return OK;
}

/** 图标地址校验：允许 http(s) 与 data:image，拒绝其它协议 */
export function validateIconUrl(icon: unknown): ValidationResult {
  if (icon === undefined || icon === null || icon === '') return OK;
  if (typeof icon !== 'string') return fail('图标地址必须是文本。');
  const value = icon.trim();
  if (!value) return OK;
  if (value.length > FIELD_LIMITS.iconUrl) {
    return fail(`图标地址过长，最多 ${FIELD_LIMITS.iconUrl} 个字符。`);
  }
  if (value.startsWith('data:')) {
    return value.startsWith('data:image/')
      ? OK
      : fail('只支持 data:image/... 形式的图片数据。');
  }
  const check = normalizeUrl(value);
  if (!check.ok) {
    return fail(`图标地址无效：${check.message}`);
  }
  return OK;
}

/** 颜色校验：仅接受 #rgb / #rrggbb */
export function validateColor(color: unknown): ValidationResult {
  if (typeof color !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim())) {
    return fail('颜色格式应为 #RRGGBB。');
  }
  return OK;
}

/** 布尔值宽松解析（导入 JSON 时数字 1/0 也接受） */
export function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

/** 数字解析 */
export function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** 枚举解析 */
export function toEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];
export const CARD_DENSITIES: readonly CardDensity[] = ['compact', 'comfortable', 'loose'];
export const SIDEBAR_POSITIONS: readonly SidebarPosition[] = ['left', 'right'];
export const OPEN_MODES: readonly OpenMode[] = ['newTab', 'currentTab'];
export const ICON_TYPES: readonly IconType[] = ['auto', 'url', 'text'];

/** 表单校验：新增/编辑网站 */
export interface WebsiteFormInput {
  name: string;
  url: string;
  description: string;
  icon: string;
  iconType: IconType;
  sectionId: string;
  openInNewTab: boolean;
}

export interface WebsiteFormErrors {
  name?: string;
  url?: string;
  description?: string;
  icon?: string;
  sectionId?: string;
}

/** 校验网站表单，返回字段级错误（用于表单内联提示） */
export function validateWebsiteForm(input: WebsiteFormInput): WebsiteFormErrors {
  const errors: WebsiteFormErrors = {};

  const nameResult = validateWebsiteName(input.name);
  if (!nameResult.ok) errors.name = nameResult.message;

  const urlResult = validateWebsiteUrl(input.url);
  if (!urlResult.ok) errors.url = urlResult.message;

  const descResult = validateWebsiteDescription(input.description);
  if (!descResult.ok) errors.description = descResult.message;

  const iconResult = validateIconUrl(input.icon);
  if (!iconResult.ok) errors.icon = iconResult.message;

  if (!input.sectionId) errors.sectionId = '请选择所属分区。';

  return errors;
}

/** 清除字段级错误对象中的空值，便于判断是否通过 */
export function hasErrors(errors: WebsiteFormErrors | Record<string, string | undefined>): boolean {
  return Object.values(errors).some((value) => Boolean(value));
}

/* ------------------------------------------------------------------ *
 * 导入数据校验
 * ------------------------------------------------------------------ */

export interface EntityParseResult<T> {
  items: T[];
  /** 被丢弃的条目数与原因 */
  dropped: number;
  reasons: string[];
}

/** 校验并规范化页面数组 */
export function parsePages(value: unknown): EntityParseResult<NavigationPage> {
  const items: NavigationPage[] = [];
  const reasons: string[] = [];
  let dropped = 0;

  const list = coerceArray(value);
  if (!list) {
    return { items, dropped: 0, reasons: ['页面列表字段缺失或类型错误，已按空列表处理。'] };
  }

  const seenIds = new Set<string>();
  list.slice(0, FIELD_LIMITS.maxPages).forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      dropped += 1;
      reasons.push(`第 ${index + 1} 个页面不是对象，已跳过。`);
      return;
    }
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const nameCheck = validatePageName(raw.name);
    if (!id || !nameCheck.ok) {
      dropped += 1;
      reasons.push(`第 ${index + 1} 个页面缺少有效 id 或名称，已跳过。`);
      return;
    }
    if (seenIds.has(id)) {
      dropped += 1;
      reasons.push(`页面 id “${id}” 重复，已跳过重复项。`);
      return;
    }
    seenIds.add(id);

    const created = toNumber(raw.createdAt, Date.now());
    items.push({
      id,
      name: String(raw.name).trim().slice(0, FIELD_LIMITS.pageName),
      icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : 'grid',
      order: toNumber(raw.order, items.length),
      createdAt: created,
      updatedAt: toNumber(raw.updatedAt, created),
    });
  });

  if (Array.isArray(value) && value.length > FIELD_LIMITS.maxPages) {
    reasons.push(
      `页面数量超过上限 ${FIELD_LIMITS.maxPages}，仅导入前 ${FIELD_LIMITS.maxPages} 个。`,
    );
  }

  return { items, dropped, reasons };
}

/** 校验并规范化分区数组（pageId 必须存在于 pages 中） */
export function parseSections(
  value: unknown,
  pageIds: Set<string>,
): EntityParseResult<Section> {
  const items: Section[] = [];
  const reasons: string[] = [];
  let dropped = 0;

  const list = coerceArray(value);
  if (!list) {
    return { items, dropped: 0, reasons: ['分区列表字段缺失或类型错误，已按空列表处理。'] };
  }

  const seenIds = new Set<string>();
  list.slice(0, FIELD_LIMITS.maxPages * FIELD_LIMITS.maxSectionsPerPage).forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      dropped += 1;
      reasons.push(`第 ${index + 1} 个分区不是对象，已跳过。`);
      return;
    }
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const pageId = typeof raw.pageId === 'string' && raw.pageId.trim() ? raw.pageId.trim() : '';
    const nameCheck = validateSectionName(raw.name);

    if (!id || !nameCheck.ok) {
      dropped += 1;
      reasons.push(`第 ${index + 1} 个分区缺少有效 id 或名称，已跳过。`);
      return;
    }
    if (!pageIds.has(pageId)) {
      dropped += 1;
      reasons.push(`分区“${String(raw.name)}”所属页面不存在，已跳过。`);
      return;
    }
    if (seenIds.has(id)) {
      dropped += 1;
      reasons.push(`分区 id “${id}” 重复，已跳过重复项。`);
      return;
    }
    seenIds.add(id);

    const created = toNumber(raw.createdAt, Date.now());
    items.push({
      id,
      pageId,
      name: String(raw.name).trim().slice(0, FIELD_LIMITS.sectionName),
      icon: typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : 'folder',
      color: typeof raw.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw.color.trim())
        ? raw.color.trim()
        : '#3B6FE0',
      order: toNumber(raw.order, items.length),
      collapsed: toBoolean(raw.collapsed, false),
      createdAt: created,
      updatedAt: toNumber(raw.updatedAt, created),
    });
  });

  return { items, dropped, reasons };
}

/** 校验并规范化网站数组 */
export function parseWebsites(
  value: unknown,
  sectionPageMap: Map<string, string>,
): EntityParseResult<Website> {
  const items: Website[] = [];
  const reasons: string[] = [];
  let dropped = 0;

  const list = coerceArray(value);
  if (!list) {
    return { items, dropped: 0, reasons: ['网站列表字段缺失或类型错误，已按空列表处理。'] };
  }

  const seenIds = new Set<string>();
  const max = FIELD_LIMITS.maxPages * FIELD_LIMITS.maxSectionsPerPage * 20;
  list.slice(0, max).forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      dropped += 1;
      reasons.push(`第 ${index + 1} 个网站不是对象，已跳过。`);
      return;
    }
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
    const nameCheck = validateWebsiteName(raw.name);
    const urlCheck = validateWebsiteUrl(raw.url);
    const sectionId = typeof raw.sectionId === 'string' ? raw.sectionId.trim() : '';

    if (!id || !nameCheck.ok || !urlCheck.ok) {
      dropped += 1;
      reasons.push(
        `第 ${index + 1} 个网站数据无效（${!id ? '缺少 id' : !nameCheck.ok ? nameCheck.message : urlCheck.message}），已跳过。`,
      );
      return;
    }
    if (seenIds.has(id)) {
      dropped += 1;
      reasons.push(`网站 id “${id}” 重复，已跳过重复项。`);
      return;
    }
    if (!sectionPageMap.has(sectionId)) {
      dropped += 1;
      reasons.push(`网站“${String(raw.name)}”所属分区不存在，已跳过。`);
      return;
    }
    seenIds.add(id);

    const created = toNumber(raw.createdAt, Date.now());
    const normalizedUrl = normalizeUrl(String(raw.url));
    items.push({
      id,
      pageId: sectionPageMap.get(sectionId) ?? '',
      sectionId,
      name: String(raw.name).trim().slice(0, FIELD_LIMITS.websiteName),
      url: normalizedUrl.ok ? normalizedUrl.url : String(raw.url).trim(),
      description:
        typeof raw.description === 'string'
          ? raw.description.trim().slice(0, FIELD_LIMITS.websiteDescription)
          : '',
      icon: typeof raw.icon === 'string' ? raw.icon.trim().slice(0, FIELD_LIMITS.iconUrl) : '',
      iconType: toEnum(raw.iconType, ICON_TYPES, 'auto'),
      openInNewTab: toBoolean(raw.openInNewTab, true),
      favorite: toBoolean(raw.favorite, false),
      order: toNumber(raw.order, items.length),
      createdAt: created,
      updatedAt: toNumber(raw.updatedAt, created),
    });
  });

  if (Array.isArray(value) && value.length > max) {
    reasons.push(`网站数量超过上限 ${max}，仅导入前 ${max} 条。`);
  }

  return { items, dropped, reasons };
}

/** 校验并规范化最近访问记录（可选数据，损坏时直接丢弃即可） */
export function parseRecentVisits(value: unknown, websiteIds: Set<string>): RecentVisit[] {
  const list = coerceArray(value);
  if (!list) return [];
  const items: RecentVisit[] = [];
  list.slice(0, FIELD_LIMITS.maxRecentVisits).forEach((raw) => {
    if (!isPlainObject(raw)) return;
    const id = typeof raw.id === 'string' ? raw.id : '';
    const url = typeof raw.url === 'string' ? raw.url : '';
    const name = typeof raw.name === 'string' ? raw.name : '';
    const urlCheck = validateWebsiteUrl(url);
    if (!id || !name || !urlCheck.ok) return;
    items.push({
      id,
      websiteId: typeof raw.websiteId === 'string' ? raw.websiteId : '',
      name: name.slice(0, FIELD_LIMITS.websiteName),
      url: urlCheck.ok ? normalizeUrl(url).url : url,
      icon: typeof raw.icon === 'string' ? raw.icon : '',
      iconType: toEnum(raw.iconType, ICON_TYPES, 'auto'),
      pageId: typeof raw.pageId === 'string' ? raw.pageId : '',
      sectionId: typeof raw.sectionId === 'string' ? raw.sectionId : '',
      visitedAt: toNumber(raw.visitedAt, Date.now()),
    });
  });
  // websiteIds 目前只用于未来过滤，保留参数以便扩展
  void websiteIds;
  return items;
}

/** 校验并规范化设置（缺失字段用默认值补齐，保证向前兼容） */
export function parseSettings(value: unknown, defaults: AppSettings): AppSettings {
  const raw = isPlainObject(value) ? value : {};
  const backgroundRaw = isPlainObject(raw.background) ? raw.background : {};

  return {
    theme: toEnum(raw.theme, THEME_MODES, defaults.theme),
    defaultSearchEngine:
      typeof raw.defaultSearchEngine === 'string' && raw.defaultSearchEngine.trim()
        ? raw.defaultSearchEngine.trim()
        : defaults.defaultSearchEngine,
    defaultOpenMode: toEnum(raw.defaultOpenMode, OPEN_MODES, defaults.defaultOpenMode),
    showDescription: toBoolean(raw.showDescription, defaults.showDescription),
    cardDensity: toEnum(raw.cardDensity, CARD_DENSITIES, defaults.cardDensity),
    sidebarPosition: toEnum(raw.sidebarPosition, SIDEBAR_POSITIONS, defaults.sidebarPosition),
    background: {
      type: toEnum(backgroundRaw.type, ['solid', 'gradient', 'image'] as const, defaults.background.type),
      color: typeof backgroundRaw.color === 'string' ? backgroundRaw.color : defaults.background.color,
      gradientFrom:
        typeof backgroundRaw.gradientFrom === 'string'
          ? backgroundRaw.gradientFrom
          : defaults.background.gradientFrom,
      gradientTo:
        typeof backgroundRaw.gradientTo === 'string'
          ? backgroundRaw.gradientTo
          : defaults.background.gradientTo,
      imageUrl:
        typeof backgroundRaw.imageUrl === 'string' ? backgroundRaw.imageUrl : defaults.background.imageUrl,
      panelOpacity: Math.min(
        Math.max(toNumber(backgroundRaw.panelOpacity, defaults.background.panelOpacity), 0.4),
        1,
      ),
      radius: Math.min(Math.max(toNumber(backgroundRaw.radius, defaults.background.radius), 0), 20),
    },
    recentVisitsEnabled: toBoolean(raw.recentVisitsEnabled, defaults.recentVisitsEnabled),
    searchHistoryEnabled: toBoolean(raw.searchHistoryEnabled, defaults.searchHistoryEnabled),
    contextMenuEnabled: toBoolean(raw.contextMenuEnabled, defaults.contextMenuEnabled),
    shortcutsEnabled: toBoolean(raw.shortcutsEnabled, defaults.shortcutsEnabled),
    remoteFavicon: toBoolean(raw.remoteFavicon, defaults.remoteFavicon),
    recentVisitsLimit: Math.min(
      Math.max(toNumber(raw.recentVisitsLimit, defaults.recentVisitsLimit), 5),
      FIELD_LIMITS.maxRecentVisits,
    ),
  };
}
