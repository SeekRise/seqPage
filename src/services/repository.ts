/**
 * 数据仓库（Repository）
 *
 * 把「业务逻辑」与「chrome.storage 细节」隔离开：
 * store 只依赖 NaviRepository 接口，方便未来替换存储实现或在测试中注入内存实现。
 * 同时集中处理 schemaVersion 迁移，保证升级扩展后旧数据仍可用。
 */
import {
  describeError,
  estimateUsage,
  isExtensionContext,
  isStorageAvailable,
  readSnapshot,
  clearAll,
  writeSnapshot,
  type PersistedDocument,
  type StorageMeta,
  type StorageResult,
} from '@/services/storage';
import { SCHEMA_VERSION, type NaviState } from '@/types';
import { DEFAULT_SETTINGS } from '@/utils/constants';
import { parseSettings } from '@/utils/validators';

export interface SnapshotLoadResult {
  /** 是否存在已保存的配置 */
  hasData: boolean;
  state: NaviState;
  meta: StorageMeta;
  /** 上次停留的页面 id（可能为空或已失效） */
  activePageId: string;
  /** 加载过程中的非致命提示 */
  warnings: string[];
  /** 致命错误（存储不可用 / 读取失败 / 数据损坏） */
  error: { message: string; hint: string } | null;
}

export interface NaviRepository {
  readonly backend: string;
  readonly extensionContext: boolean;
  load(): Promise<SnapshotLoadResult>;
  saveAll(state: NaviState, meta: StorageMeta, activePageId: string): Promise<StorageResult<true>>;
  clearAll(): Promise<StorageResult<true>>;
  estimateUsage(): Promise<StorageResult<{ bytes: number; quotaBytes: number }>>;
}

/** 创建一个空的初始状态（不包含演示数据，由 navigation service 决定是否注入） */
export function createEmptyState(): NaviState {
  return {
    schemaVersion: SCHEMA_VERSION,
    pages: [],
    sections: [],
    websites: [],
    settings: { ...DEFAULT_SETTINGS, background: { ...DEFAULT_SETTINGS.background } },
    recentVisits: [],
  };
}

/** 创建初始 meta */
export function createMeta(initialized: boolean): StorageMeta {
  const timestamp = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    initialized,
    lastImportedAt: null,
  };
}

/**
 * 数据迁移。
 *
 * 当前只有 v1，但保留完整迁移骨架：未来新增字段或调整结构时，
 * 在这里按版本号顺序升级，避免用户数据丢失。
 * 迁移只处理"字段补齐"这类安全操作，任何无法判定的情况都保留原数据并提示用户。
 */
export function migrateDocument(
  document: PersistedDocument,
  warnings: string[],
): PersistedDocument {
  const version = typeof document.schemaVersion === 'number' ? document.schemaVersion : 0;

  if (version > SCHEMA_VERSION) {
    warnings.push(
      `本地配置版本（v${version}）高于当前扩展支持的版本（v${SCHEMA_VERSION}），已按当前版本尽力读取。建议升级扩展后再使用。`,
    );
    return { ...document, schemaVersion: SCHEMA_VERSION };
  }

  if (version < 1) {
    warnings.push('检测到早期版本的配置，已自动补齐缺失字段并升级到 v1。');
  }

  // v0 -> v1：早期配置可能没有 meta 或 recentVisits
  return {
    ...document,
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...createMeta(true),
      ...document.meta,
      schemaVersion: SCHEMA_VERSION,
    },
    recentVisits: Array.isArray(document.recentVisits) ? document.recentVisits : [],
  };
}

class ChromeStorageRepository implements NaviRepository {
  readonly backend = isExtensionContext() ? 'chrome.storage.local' : 'localStorage(预览回退)';
  readonly extensionContext = isExtensionContext();

  async load(): Promise<SnapshotLoadResult> {
    const warnings: string[] = [];

    if (!isStorageAvailable()) {
      return {
        hasData: false,
        state: createEmptyState(),
        meta: createMeta(false),
        activePageId: '',
        warnings,
        error: {
          message: '当前环境无法访问本地存储，导航数据无法读取或保存。',
          hint: '请确认扩展已通过「加载已解压的扩展程序」正确加载，并在 chrome://extensions 中检查是否报错。',
        },
      };
    }

    const result = await readSnapshot();
    if (!result.ok) {
      return {
        hasData: false,
        state: createEmptyState(),
        meta: createMeta(false),
        activePageId: '',
        warnings,
        error: {
          message: result.error?.message ?? '读取本地配置失败。',
          hint: result.error?.hint ?? '可尝试刷新新标签页；若持续失败，请检查浏览器存储权限。',
        },
      };
    }

    // 首次启动：还没有任何已保存的文档
    if (!result.data) {
      return {
        hasData: false,
        state: createEmptyState(),
        meta: createMeta(false),
        activePageId: '',
        warnings,
        error: null,
      };
    }

    const document = migrateDocument(result.data, warnings);

    const state: NaviState = {
      schemaVersion: SCHEMA_VERSION,
      pages: document.pages,
      sections: document.sections,
      websites: document.websites,
      settings: parseSettings(document.settings, DEFAULT_SETTINGS),
      recentVisits: document.recentVisits,
    };

    // 有文档即视为已有配置：即使页面为空（用户主动清空过），也不应再次写入演示数据
    const hasData = document.meta.initialized || document.pages.length > 0;

    // 恢复上次停留的页面；该页面已不存在时回退到第一个页面
    const activePageId = document.pages.some((page) => page.id === document.activePageId)
      ? document.activePageId
      : (document.pages[0]?.id ?? '');

    return {
      hasData,
      state,
      activePageId,
      meta: {
        schemaVersion: SCHEMA_VERSION,
        createdAt: document.meta.createdAt,
        updatedAt: document.meta.updatedAt,
        initialized: document.meta.initialized || hasData,
        lastImportedAt: document.meta.lastImportedAt ?? null,
      },
      warnings,
      error: null,
    };
  }

  saveAll(state: NaviState, meta: StorageMeta, activePageId: string) {
    return writeSnapshot(state, meta, activePageId);
  }

  clearAll() {
    return clearAll();
  }

  estimateUsage() {
    return estimateUsage();
  }
}

/** 创建仓库实例（当前只有 chrome.storage 一种实现） */
export function createRepository(): NaviRepository {
  return new ChromeStorageRepository();
}

/** 统一把 StorageResult 的错误转成可展示文案 */
export function toErrorMessage(result: StorageResult<unknown>): string {
  if (result.ok) return '';
  return result.error ? `${result.error.message}（${result.error.hint}）` : '操作失败，请重试。';
}

export { describeError };
