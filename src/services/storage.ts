/**
 * 存储层：封装 chrome.storage.local 的全部读写。
 *
 * 设计要点（对应任务书第十一节）：
 * - 单一物理键：整份配置作为一个 JSON 文档保存在 `mynavi:state` 下。
 *   导航配置体量很小（几 KB ~ 几百 KB），整体读写带来两个关键好处：
 *   1. 写入是原子的，不会出现"只更新了一半分片"的中间状态；
 *   2. 读取路径只有一次 get，避免多键映射带来的歧义与不一致。
 *   这与任务书「对于体量较小的导航配置，可以采用统一状态快照」的建议一致。
 * - 逻辑分区键（meta/pages/...）只用于调用方表达"数据块"语义，物理上仍是一个键。
 * - 串行写队列：所有写操作排队执行，避免并发更新互相覆盖（拖拽 + 编辑同时发生）。
 * - 所有操作返回 StorageResult，绝不抛异常，由 UI 决定如何提示用户。
 * - 双环境兼容：扩展内使用 chrome.storage.local；普通网页预览时回退 localStorage，
 *   保证 `npm run dev` 也能调试，且不引入任何远程依赖。
 */
import type { AppSettings, NaviState, RecentVisit, NavigationPage, Section, Website } from '@/types';
import { coerceArray, isPlainObject } from '@/utils/validators';

/** 逻辑数据块名称 */
export const STORAGE_KEYS = {
  meta: 'meta',
  pages: 'pages',
  sections: 'sections',
  websites: 'websites',
  settings: 'settings',
  recentVisits: 'recentVisits',
} as const;

/** 唯一物理存储键：整份配置快照 */
export const STATE_KEY = 'mynavi:state';

/** 搜索历史单独存放：便于单独清空，也不受导航数据迁移影响 */
export const SEARCH_HISTORY_KEY = 'mynavi:searchHistory';

/** 允许被读写的存储键 */
export type StorageChunkKey = typeof STATE_KEY | typeof SEARCH_HISTORY_KEY;

/** 逻辑数据块名称集合 */
export type StorageChunkName = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 元信息 */
export interface StorageMeta {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  /** 是否已经初始化过演示数据 */
  initialized: boolean;
  /** 最近一次导入时间，便于排查数据来源 */
  lastImportedAt: number | null;
}

/** 持久化的文档结构 */
export interface PersistedDocument {
  schemaVersion: number;
  meta: StorageMeta;
  /** 上次停留的导航页面，重新打开新标签页时恢复 */
  activePageId: string;
  pages: NavigationPage[];
  sections: Section[];
  websites: Website[];
  settings: AppSettings;
  recentVisits: RecentVisit[];
}

export type StorageErrorKind = 'unavailable' | 'read' | 'write' | 'quota' | 'corrupt';

export interface StorageResult<T> {
  ok: boolean;
  data: T | null;
  error: { kind: StorageErrorKind; message: string; hint: string } | null;
}

function ok<T>(data: T): StorageResult<T> {
  return { ok: true, data, error: null };
}

function fail<T>(kind: StorageErrorKind, message: string, hint: string): StorageResult<T> {
  return { ok: false, data: null, error: { kind, message, hint } };
}

/* ------------------------------------------------------------------ *
 * 底层驱动
 * ------------------------------------------------------------------ */

interface StorageDriver {
  readonly name: 'chrome.storage.local' | 'localStorage';
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

function createChromeDriver(): StorageDriver | null {
  const area = globalThis.chrome?.storage?.local;
  if (!area) return null;
  return {
    name: 'chrome.storage.local',
    /**
     * 单个键读取：请求什么键就拿什么键，返回值不会与其它键混淆。
     */
    get: async (key) => {
      const single = (await area.get(key)) as Record<string, unknown>;
      return single ? single[key] : undefined;
    },
    set: (key, value) => area.set({ [key]: value }),
    remove: (keys) => area.remove(keys),
  };
}

/** 开发预览（非扩展环境）下的回退实现，容量与语义与 chrome.storage 对齐 */
function createLocalStorageDriver(): StorageDriver | null {
  if (typeof localStorage === 'undefined') return null;
  return {
    name: 'localStorage',
    get: async (key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove: async (keys) => {
      for (const key of keys) localStorage.removeItem(key);
    },
  };
}

let driver: StorageDriver | null | undefined;

/** 存储后端诊断信息（排查"配置没有恢复"一类问题时使用） */
export interface StorageDiagnostics {
  backend: string;
  localStoragePresent: boolean;
  chromeStoragePresent: boolean;
  extensionContext: boolean;
}

export function getStorageDiagnostics(): StorageDiagnostics {
  return {
    backend: getDriver()?.name ?? 'none',
    localStoragePresent: typeof localStorage !== 'undefined',
    chromeStoragePresent: Boolean(globalThis.chrome?.storage?.local),
    extensionContext: isExtensionContext(),
  };
}

/** 获取当前可用的存储驱动（首次调用时确定，之后复用） */
export function getDriver(): StorageDriver | null {
  if (driver === undefined) {
    driver = createChromeDriver() ?? createLocalStorageDriver();
  }
  return driver;
}

/** 当前是否运行在 Chrome 扩展环境中 */
export function isExtensionContext(): boolean {
  return Boolean(globalThis.chrome?.runtime?.id);
}

/** 存储层是否可用（用于界面提示） */
export function isStorageAvailable(): boolean {
  return getDriver() !== null;
}

/* ------------------------------------------------------------------ *
 * 串行写队列
 * ------------------------------------------------------------------ */

const writeQueues = new Map<string, Promise<unknown>>();

/**
 * 把写操作排入某个 key 的串行队列。
 * 同一个 key 的写入严格串行，不同 key 之间互不阻塞。
 */
function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  // 队列本身不抛出，避免未处理拒绝
  writeQueues.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/* ------------------------------------------------------------------ *
 * 基础读写
 * ------------------------------------------------------------------ */

/** 读取任意键的原始值；缺失时返回 undefined */
export async function readRaw(key: StorageChunkKey): Promise<StorageResult<unknown>> {
  const active = getDriver();
  if (!active) {
    return fail(
      'unavailable',
      '当前环境无法访问本地存储，配置无法保存。',
      '请确认扩展已正确加载（chrome://extensions 中重新加载），或检查浏览器是否禁用了存储。',
    );
  }
  try {
    return ok(await active.get(key));
  } catch (error) {
    return fail(
      'read',
      `读取本地配置失败：${describeError(error)}`,
      '可尝试刷新新标签页；若持续失败，请在设置面板中导出备份后重新导入。',
    );
  }
}

/** 写入任意键（串行） */
export async function writeRaw(key: StorageChunkKey, value: unknown): Promise<StorageResult<true>> {
  const active = getDriver();
  if (!active) {
    return fail('unavailable', '当前环境无法访问本地存储，配置无法保存。', '请确认扩展已正确加载。');
  }
  try {
    await enqueue(key, async () => {
      await active.set(key, value);
    });
    return ok(true as const);
  } catch (error) {
    const message = describeError(error);
    if (/quota|QUOTA|exceeded/i.test(message)) {
      return fail(
        'quota',
        '本地存储空间已满，本次修改没有保存。',
        '请删除部分网站卡片或最近访问记录，或在设置面板导出备份后清空数据。',
      );
    }
    return fail(
      'write',
      `保存配置失败：${message}`,
      '请稍后重试；若持续失败，可先导出备份再清除本地数据。',
    );
  }
}

/** 删除若干键 */
export async function removeRaw(keys: StorageChunkKey[]): Promise<StorageResult<true>> {
  const active = getDriver();
  if (!active) {
    return fail('unavailable', '当前环境无法访问本地存储。', '请确认扩展已正确加载。');
  }
  try {
    await enqueue(STATE_KEY, async () => {
      await active.remove([...keys]);
    });
    return ok(true as const);
  } catch (error) {
    return fail('write', `清空本地数据失败：${describeError(error)}`, '请稍后重试。');
  }
}

/**
 * 读取配置快照对应的原始文档（按逻辑块读取的兼容接口已移除：
 * 物理上只有 `mynavi:state` 一个键，整体读写才能保证原子性与一致性）。
 */

/** 兼容接口：按逻辑块读取（物理上只读一次） */
export async function readChunks(keys: StorageChunkKey[]): Promise<StorageResult<Record<string, unknown>>> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const single = await readRaw(key);
    if (!single.ok) {
      return fail(single.error?.kind ?? 'read', single.error?.message ?? '读取失败', single.error?.hint ?? '');
    }
    if (single.data !== undefined) result[key] = single.data;
  }
  return ok(result);
}

/** 兼容接口：写入单个键 */
export async function writeChunk(key: StorageChunkKey, value: unknown): Promise<StorageResult<true>> {
  return writeRaw(key, value);
}

/** 底层错误转可读文本 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '未知错误';
}

/* ------------------------------------------------------------------ *
 * 快照级 API（供 store / 导入导出使用）
 * ------------------------------------------------------------------ */

/**
 * 把存储中的原始值规范化为持久化文档。
 *
 * 兼容性说明（重要）：
 * 早期构建把数组序列化成了以数字为键的对象（`{"0":{…},"1":{…}}`），
 * 因此这里使用宽松的 coerceArray 而不是 Array.isArray——
 * 否则会把完全正常的用户配置误判为"结构不完整"并拒绝加载。
 *
 * 只有连"类数组"都算不上（字符串 / 数字 / null 等）时才算无法解析，
 * 并返回具体原因，便于给出准确提示。
 */
function normalizeDocument(raw: unknown): {
  document: PersistedDocument | null;
  issue: string | null;
  /** 是否发现"数组被存成数字键对象"的旧格式 */
  legacyArrayShape: boolean;
} {
  if (!isPlainObject(raw)) {
    return {
      document: null,
      issue: `顶层不是对象（实际为 ${raw === null ? 'null' : typeof raw}）`,
      legacyArrayShape: false,
    };
  }

  const pages = coerceArray(raw.pages);
  const sections = coerceArray(raw.sections);
  const websites = coerceArray(raw.websites);

  const isMapShape = (value: unknown): boolean => isPlainObject(value) && !Array.isArray(value);
  const legacyArrayShape =
    isMapShape(raw.pages) || isMapShape(raw.sections) || isMapShape(raw.websites);

  const invalid = (
    [
      ['pages', pages, raw.pages],
      ['sections', sections, raw.sections],
      ['websites', websites, raw.websites],
    ] as const
  )
    .filter(([, coerced]) => coerced === null)
    .map(([name, , original]) => `${name}（实际为 ${original === null ? 'null' : typeof original}）`);

  if (invalid.length > 0 || !pages || !sections || !websites) {
    return {
      document: null,
      issue: `字段 ${invalid.join('、')} 既不是数组也不是类数组对象`,
      legacyArrayShape,
    };
  }

  const meta = isPlainObject(raw.meta) ? (raw.meta as unknown as StorageMeta) : null;

  // 顺带修正：旧格式若缺少 initialized 标记，这里补上，避免被误判为"首次启动"而重建演示数据
  const normalizedMeta: StorageMeta = {
    ...(meta ?? createFallbackMeta()),
    initialized: meta?.initialized ?? true,
  };

  return {
    document: {
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
      meta: normalizedMeta,
      activePageId: typeof raw.activePageId === 'string' ? raw.activePageId : '',
      pages: pages as NavigationPage[],
      sections: sections as Section[],
      websites: websites as Website[],
      settings: raw.settings as AppSettings,
      recentVisits: (coerceArray(raw.recentVisits) ?? []) as RecentVisit[],
    },
    issue: null,
    legacyArrayShape,
  };
}

function createFallbackMeta(): StorageMeta {
  const timestamp = Date.now();
  return {
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    initialized: true,
    lastImportedAt: null,
  };
}

/** 读取完整快照；不存在时返回全 null（表示首次启动） */
export async function readSnapshot(): Promise<StorageResult<PersistedDocument | null>> {
  const result = await readRaw(STATE_KEY);
  if (!result.ok) {
    return fail(result.error?.kind ?? 'read', result.error?.message ?? '读取失败', result.error?.hint ?? '');
  }
  if (result.data === undefined || result.data === null) return ok(null);

  const { document, issue } = normalizeDocument(result.data);
  if (!document) {
    return fail(
      'corrupt',
      `本地保存的配置无法解析：${issue ?? '结构不符合预期'}。`,
      '为避免覆盖你的数据，本次没有加载，也没有写入任何内容。可在设置中先导出备份再处理，或直接清空本地数据重新开始。',
    );
  }
  return ok(document);
}

/** 整体写入快照（原子写入：一次 set 完成） */
export async function writeSnapshot(
  state: NaviState,
  meta: StorageMeta,
  activePageId: string,
): Promise<StorageResult<true>> {
  const document: PersistedDocument = {
    schemaVersion: state.schemaVersion,
    meta,
    activePageId,
    pages: state.pages,
    sections: state.sections,
    websites: state.websites,
    settings: state.settings,
    recentVisits: state.recentVisits,
  };
  return writeRaw(STATE_KEY, document);
}

/** 清空全部 My Navi 数据（含搜索历史） */
export function clearAll(): Promise<StorageResult<true>> {
  return removeRaw([STATE_KEY, SEARCH_HISTORY_KEY]);
}

/** 存储占用估算（字节），用于设置面板展示 */
export async function estimateUsage(): Promise<StorageResult<{ bytes: number; quotaBytes: number }>> {
  const active = getDriver();
  if (!active) {
    return fail('unavailable', '当前环境无法访问本地存储。', '请确认扩展已正确加载。');
  }
  try {
    if (globalThis.chrome?.storage?.local?.getBytesInUse) {
      const bytes = await globalThis.chrome.storage.local.getBytesInUse(null);
      // chrome.storage.local 默认配额 10 MB（未申请 unlimitedStorage）
      return ok({ bytes, quotaBytes: 10 * 1024 * 1024 });
    }
    const raw = await readRaw(STATE_KEY);
    const history = await readRaw(SEARCH_HISTORY_KEY);
    const bytes = new TextEncoder().encode(JSON.stringify({ state: raw.data, history: history.data })).length;
    return ok({ bytes, quotaBytes: 5 * 1024 * 1024 });
  } catch (error) {
    return fail('read', `统计存储占用失败：${describeError(error)}`, '可忽略该提示，不影响正常使用。');
  }
}
