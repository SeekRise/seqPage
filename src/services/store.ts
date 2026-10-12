/**
 * 应用状态中心（轻量 Store，不引入 Pinia 等状态框架）
 *
 * 职责分层：
 * - store.ts（本文件）：唯一的状态真相 + 所有写操作 + 持久化编排。组件不直接调用 repo。
 * - repository.ts：存储读写与版本迁移。
 * - 组件：只读 state + 调用 store 的语义化方法。
 *
 * 一致性策略：
 * - 每个写操作先算出「下一个状态」，再按分片比对（JSON 快照），只写发生变化的分片。
 * - 写入使用「乐观更新 + 失败回滚」：写入失败时状态恢复为操作前的快照，
 *   保证内存视图与磁盘内容始终一致，避免出现「界面显示已改、实际没保存」。
 */
import { computed, reactive } from 'vue';
import {
  createMeta,
  createRepository,
  toErrorMessage,
  type NaviRepository,
  type SnapshotLoadResult,
} from '@/services/repository';
import { createDemoData, findFallbackSectionId, nextOrder, normalizeSectionOrders, normalizeWebsiteOrders, repairState, reorderByIds } from '@/services/navigation';
import { SCHEMA_VERSION, type AppSettings, type NaviState, type NavigationPage, type RecentVisit, type Section, type Website } from '@/types';
import type { IntegrityReport } from '@/types';
import { DEFAULT_SETTINGS } from '@/utils/constants';
import { createId } from '@/utils/common';

/** 页面/分区/网站的新建输入 */
export interface PageInput {
  name: string;
  icon: string;
}

export interface SectionInput {
  name: string;
  icon: string;
  color: string;
}

export interface WebsiteInput {
  name: string;
  url: string;
  description: string;
  icon: string;
  iconType: Website['iconType'];
  openInNewTab: boolean;
}

/** 删除结果：告知调用方影响范围，便于二次确认与提示 */
export interface DeletePageResult {
  ok: boolean;
  removedSections: number;
  removedWebsites: number;
  message: string;
}

export interface DeleteSectionResult {
  ok: boolean;
  removedWebsites: number;
  movedWebsites: number;
  message: string;
}

export interface MutateOptions {
  /** 使用防抖合并写入（拖拽排序等高频操作） */
  debounceMs?: number;
}

interface StoreState {
  loading: boolean;
  ready: boolean;
  /** 初始化或存储层错误 */
  errorMessage: string;
  /**
   * 只读保护模式。
   * 当本地已保存的配置**读取失败**（而不是不存在）时开启：
   * 此时内存里是一份空状态，任何写入都会把用户磁盘上的数据覆盖掉。
   * 因此该模式下拦截所有持久化操作，并提示用户先处理存储问题。
   */
  writeProtected: boolean;
  data: NaviState;
  activePageId: string;
  integrity: IntegrityReport | null;
}

/** 只读视图类型：组件拿到的 state 在类型层面禁止修改（运行时由约定保证） */
export type ReadonlyStoreState = Readonly<StoreState>;

const repo: NaviRepository = createRepository();

const state = reactive<StoreState>({
  loading: true,
  ready: false,
  errorMessage: '',
  writeProtected: false,
  data: {
    schemaVersion: SCHEMA_VERSION,
    pages: [],
    sections: [],
    websites: [],
    settings: { ...DEFAULT_SETTINGS, background: { ...DEFAULT_SETTINGS.background } },
    recentVisits: [],
  },
  activePageId: '',
  integrity: null,
});

const WRITE_PROTECTED_MESSAGE =
  '本地配置当前处于只读保护状态：因为读取已保存的数据失败，为避免覆盖你的原有数据，本次不会写入任何内容。请先点击「重新读取」；若仍然失败，可在设置中先导出备份再清空本地数据。';

/** 最近一次成功持久化的快照序列化结果，用于差异比对（相同则不写入） */
let persistedSnapshot = '';

/** 防抖写入的定时器 */
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let pendingFlush = false;

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

function applyLoadedSnapshot(snapshot: SnapshotLoadResult): void {
  const repaired = repairState(snapshot.state);
  state.data = repaired.state;
  state.integrity = repaired.report;
  state.errorMessage = snapshot.error ? `${snapshot.error.message}${snapshot.error.hint}` : '';
  // 读取失败 → 进入只读保护，绝不用空状态覆盖磁盘上的数据
  state.writeProtected = Boolean(snapshot.error);
  // 恢复上次停留的页面；若该 id 已失效则退回第一个页面
  state.activePageId = repaired.state.pages.some((page) => page.id === snapshot.activePageId)
    ? snapshot.activePageId
    : (repaired.state.pages[0]?.id ?? '');
  resetPersistedBaseline();
}

/** 重置持久化基线（首次加载 / 导入 / 恢复默认后调用） */
function resetPersistedBaseline(): void {
  persistedSnapshot = serializeState();
}

/** 当前状态的稳定序列化结果（用于判断是否有变化，含当前页面以便恢复上次位置） */
function serializeState(): string {
  return JSON.stringify({
    activePageId: state.activePageId,
    pages: state.data.pages,
    sections: state.data.sections,
    websites: state.data.websites,
    settings: state.data.settings,
    recentVisits: state.data.recentVisits,
  });
}

/** 启动轨迹：便于在浏览器控制台排查"配置没有恢复"一类问题 */
export interface BootTrace {
  at: number;
  /** 是否读到了已保存的配置 */
  hasData: boolean;
  loadError: string | null;
  loadedPages: number;
  loadedPageNames: string[];
  loadedWebsites: number;
  loadedTheme: string;
  /** 存储后端 */
  backend: string;
  /** 存储层读取失败原因 */
  readError: string | null;
  decision: 'seed-demo' | 'use-stored';
}

let lastBootTrace: BootTrace | null = null;

/** 读取最近一次启动轨迹（诊断用，不参与业务逻辑） */
export function getBootTrace(): BootTrace | null {
  return lastBootTrace;
}

/** 首次启动：初始化演示数据；已有数据则原样保留 */
async function bootstrap(loadResult: SnapshotLoadResult): Promise<void> {
  const seed = !loadResult.error && !loadResult.hasData;

  lastBootTrace = {
    at: Date.now(),
    hasData: loadResult.hasData,
    loadError: loadResult.error?.message ?? null,
    loadedPages: loadResult.state.pages.length,
    loadedPageNames: loadResult.state.pages.map((page) => page.name),
    loadedWebsites: loadResult.state.websites.length,
    loadedTheme: loadResult.state.settings.theme,
    backend: repo.backend,
    readError: loadResult.error?.message ?? null,
    decision: seed ? 'seed-demo' : 'use-stored',
  };

  if (seed) {
    const demo = createDemoData();
    state.data = demo;
    state.activePageId = demo.pages[0]?.id ?? '';
    state.writeProtected = false;
    const write = await repo.saveAll(demo, createMeta(true), state.activePageId);
    if (!write.ok) {
      state.errorMessage = `演示数据初始化失败，本次修改不会被保存：${toErrorMessage(write)}`;
    }
    resetPersistedBaseline();
    return;
  }
  applyLoadedSnapshot(loadResult);
}

/** 初始化 store（App 挂载前调用一次） */
export async function initializeStore(): Promise<void> {
  state.loading = true;
  const snapshot = await repo.load();
  await bootstrap(snapshot);
  state.loading = false;
  state.ready = true;
}

/* ------------------------------------------------------------------ *
 * 持久化
 * ------------------------------------------------------------------ */

/**
 * 持久化当前状态。
 *
 * 采用「整体快照 + 变化检测」：状态没变时完全不写存储，
 * 有变化时一次 set 写完整个文档（原子写入，不会出现半更新状态）。
 */
async function flushNow(): Promise<{ ok: boolean; message: string }> {
  if (state.writeProtected) {
    return { ok: false, message: WRITE_PROTECTED_MESSAGE };
  }

  const serialized = serializeState();
  if (serialized === persistedSnapshot) return { ok: true, message: '' };

  const result = await repo.saveAll(state.data, createMeta(true), state.activePageId);
  if (!result.ok) {
    return { ok: false, message: toErrorMessage(result) };
  }

  persistedSnapshot = serialized;
  return { ok: true, message: '' };
}

function scheduleFlush(): void {
  if (flushTimer !== undefined) return;
  pendingFlush = true;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    pendingFlush = false;
    void flushNow().then((result) => {
      if (!result.ok) state.errorMessage = result.message;
    });
  }, 250);
}

export interface MutateResult {
  ok: boolean;
  message: string;
}

/**
 * 所有写操作的统一入口：
 * 1. 备份快照 → 2. 执行变更 → 3. 持久化 → 4. 失败则回滚内存状态。
 *
 * 只读保护模式下直接拒绝，并且**不修改内存状态**，
 * 保证界面上看到的内容与磁盘保持一致。
 */
async function mutate(
  mutator: (draft: NaviState) => void,
  options: MutateOptions = {},
): Promise<MutateResult> {
  if (state.writeProtected) {
    return { ok: false, message: WRITE_PROTECTED_MESSAGE };
  }

  const backup: NaviState = JSON.parse(JSON.stringify(state.data)) as NaviState;
  const backupPersisted = persistedSnapshot;

  mutator(state.data);

  if (options.debounceMs !== undefined) {
    // 高频操作（拖拽）先立即更新界面，写入防抖合并
    scheduleFlush();
    return { ok: true, message: '' };
  }

  const result = await flushNow();
  if (!result.ok) {
    state.data = backup;
    persistedSnapshot = backupPersisted;
    state.errorMessage = result.message;
    return { ok: false, message: result.message };
  }
  return { ok: true, message: '' };
}

/* ------------------------------------------------------------------ *
 * 读取（getters）
 * ------------------------------------------------------------------ */

export const store = {
  /**
   * 全应用唯一状态源。
   * 组件只读；所有写入必须经过本对象的方法，以保证「持久化 + 失败回滚」始终生效。
   */
  state: state as ReadonlyStoreState,

  /** 等待所有挂起的写入完成（用于关键操作前保证落盘） */
  async flush(): Promise<MutateResult> {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      pendingFlush = false;
    }
    return flushNow();
  },

  info: {
    backend: repo.backend,
    extensionContext: repo.extensionContext,
    hasPendingWrite: (): boolean => pendingFlush,
    /** 最近一次启动时读取到的数据情况（诊断用） */
    bootTrace: (): BootTrace | null => lastBootTrace,
  },

  /* ---------------- 初始化 ---------------- */

  initialize: initializeStore,

  async reload(): Promise<void> {
    state.loading = true;
    const snapshot = await repo.load();
    applyLoadedSnapshot(snapshot);
    state.loading = false;
    state.ready = true;
  },

  clearError(): void {
    state.errorMessage = '';
  },

  /* ---------------- 页面 ---------------- */

  pages(): NavigationPage[] {
    return [...state.data.pages].sort((a, b) => a.order - b.order);
  },

  activePage(): NavigationPage | undefined {
    return state.data.pages.find((page) => page.id === state.activePageId);
  },

  pageById(id: string): NavigationPage | undefined {
    return state.data.pages.find((page) => page.id === id);
  },

  /** 切换当前导航页面（会持久化，重新打开新标签页时恢复到该页面） */
  async setActivePage(id: string): Promise<void> {
    if (!state.data.pages.some((page) => page.id === id)) return;
    if (state.activePageId === id) return;
    state.activePageId = id;
    const result = await flushNow();
    if (!result.ok) state.errorMessage = result.message;
  },

  sectionCount(pageId: string): number {
    return state.data.sections.filter((section) => section.pageId === pageId).length;
  },

  websiteCount(pageId: string): number {
    return state.data.websites.filter((website) => website.pageId === pageId).length;
  },

  isPageNameTaken(name: string, exceptId?: string): boolean {
    const target = name.trim();
    return state.data.pages.some((page) => page.id !== exceptId && page.name === target);
  },

  isSectionNameTaken(pageId: string, name: string, exceptId?: string): boolean {
    const target = name.trim();
    return state.data.sections.some(
      (section) => section.pageId === pageId && section.id !== exceptId && section.name === target,
    );
  },

  isWebsiteUrlTaken(pageId: string, url: string, exceptId?: string): boolean {
    const target = url.trim().replace(/\/+$/, '').toLowerCase();
    return state.data.websites.some(
      (website) =>
        website.pageId === pageId &&
        website.id !== exceptId &&
        website.url.trim().replace(/\/+$/, '').toLowerCase() === target,
    );
  },

  async addPage(input: PageInput): Promise<{ ok: boolean; message: string; page?: NavigationPage }> {
    const timestamp = Date.now();
    const page: NavigationPage = {
      id: createId('page'),
      name: input.name.trim(),
      icon: input.icon || 'grid',
      order: nextOrder(state.data.pages),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const result = await mutate((draft) => {
      draft.pages.push(page);
    });
    if (result.ok) state.activePageId = page.id;
    return { ...result, page: result.ok ? page : undefined };
  },

  async updatePage(id: string, patch: Partial<Pick<NavigationPage, 'name' | 'icon'>>): Promise<MutateResult> {
    return mutate((draft) => {
      const page = draft.pages.find((item) => item.id === id);
      if (!page) return;
      if (patch.name !== undefined) page.name = patch.name.trim();
      if (patch.icon !== undefined) page.icon = patch.icon;
      page.updatedAt = Date.now();
    });
  },

  async reorderPages(orderedIds: string[]): Promise<MutateResult> {
    return mutate(
      (draft) => {
        draft.pages = reorderByIds(draft.pages, orderedIds);
      },
      { debounceMs: 0 },
    );
  },

  /**
   * 删除页面：连同其分区与网站一起删除。
   * 至少保留一个页面；删除当前页面后自动切换到仍存在的页面。
   */
  async deletePage(id: string): Promise<DeletePageResult> {
    const total = state.data.pages.length;
    if (total <= 1) {
      return {
        ok: false,
        removedSections: 0,
        removedWebsites: 0,
        message: '至少需要保留一个导航页面，无法删除最后一个页面。',
      };
    }

    const removedSections = state.data.sections.filter((section) => section.pageId === id).length;
    const removedWebsites = state.data.websites.filter((website) => website.pageId === id).length;
    const wasActive = state.activePageId === id;

    const result = await mutate((draft) => {
      draft.pages = draft.pages.filter((page) => page.id !== id);
      draft.sections = draft.sections.filter((section) => section.pageId !== id);
      draft.websites = draft.websites.filter((website) => website.pageId !== id);
      draft.recentVisits = draft.recentVisits.filter((visit) => visit.pageId !== id);
      draft.pages = reorderByIds(draft.pages, draft.pages.map((page) => page.id));
    });

    if (result.ok && wasActive) {
      state.activePageId = state.data.pages[0]?.id ?? '';
    }

    return {
      ok: result.ok,
      removedSections,
      removedWebsites,
      message: result.ok
        ? `已删除页面及其 ${removedSections} 个分区、${removedWebsites} 个网站。`
        : result.message,
    };
  },

  /* ---------------- 分区 ---------------- */

  sectionsOfPage(pageId: string): Section[] {
    return state.data.sections.filter((section) => section.pageId === pageId).sort((a, b) => a.order - b.order);
  },

  websitesOfSection(sectionId: string): Website[] {
    return state.data.websites.filter((website) => website.sectionId === sectionId).sort((a, b) => a.order - b.order);
  },

  sectionById(id: string): Section | undefined {
    return state.data.sections.find((section) => section.id === id);
  },

  async addSection(pageId: string, input: SectionInput): Promise<{ ok: boolean; message: string; section?: Section }> {
    const timestamp = Date.now();
    const section: Section = {
      id: createId('sec'),
      pageId,
      name: input.name.trim(),
      icon: input.icon || 'folder',
      color: input.color,
      order: nextOrder(state.data.sections.filter((item) => item.pageId === pageId)),
      collapsed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const result = await mutate((draft) => {
      draft.sections.push(section);
    });
    return { ...result, section: result.ok ? section : undefined };
  },

  async updateSection(
    id: string,
    patch: Partial<Pick<Section, 'name' | 'icon' | 'color' | 'collapsed'>>,
  ): Promise<MutateResult> {
    return mutate((draft) => {
      const section = draft.sections.find((item) => item.id === id);
      if (!section) return;
      if (patch.name !== undefined) section.name = patch.name.trim();
      if (patch.icon !== undefined) section.icon = patch.icon;
      if (patch.color !== undefined) section.color = patch.color;
      if (patch.collapsed !== undefined) section.collapsed = patch.collapsed;
      section.updatedAt = Date.now();
    });
  },

  async toggleSectionCollapsed(id: string): Promise<MutateResult> {
    const section = state.data.sections.find((item) => item.id === id);
    if (!section) return { ok: false, message: '分区不存在，可能已被删除。' };
    return store.updateSection(id, { collapsed: !section.collapsed });
  },

  async reorderSections(pageId: string, orderedIds: string[]): Promise<MutateResult> {
    return mutate(
      (draft) => {
        const pageSections = draft.sections.filter((section) => section.pageId === pageId);
        const reordered = reorderByIds(pageSections, orderedIds);
        const map = new Map(reordered.map((section) => [section.id, section]));
        draft.sections = draft.sections.map((section) => map.get(section.id) ?? section);
      },
      { debounceMs: 0 },
    );
  },

  /**
   * 删除分区。
   * - mode='delete'：连同分区内网站一起删除。
   * - mode='move'：先把网站移动到目标分区，再删除分区（不丢数据）。
   */
  async deleteSection(
    id: string,
    mode: 'delete' | 'move',
    targetSectionId?: string,
  ): Promise<DeleteSectionResult> {
    const section = state.data.sections.find((item) => item.id === id);
    if (!section) {
      return { ok: false, removedWebsites: 0, movedWebsites: 0, message: '分区不存在，可能已被删除。' };
    }

    const affected = state.data.websites.filter((website) => website.sectionId === id);

    if (mode === 'move') {
      const fallback = targetSectionId ?? findFallbackSectionId(state.data, section.pageId, id);
      if (!fallback) {
        return {
          ok: false,
          removedWebsites: 0,
          movedWebsites: 0,
          message: '当前页面没有其他分区可接收网站，请先新建一个分区或选择「同时删除网站」。',
        };
      }
      if (fallback === id) {
        return { ok: false, removedWebsites: 0, movedWebsites: 0, message: '目标分区不能是当前分区。' };
      }

      const result = await mutate((draft) => {
        const target = draft.sections.find((item) => item.id === fallback);
        if (!target) return;
        let order = nextOrder(draft.websites.filter((website) => website.sectionId === fallback));
        for (const website of draft.websites) {
          if (website.sectionId !== id) continue;
          website.sectionId = fallback;
          website.pageId = target.pageId;
          website.order = order;
          website.updatedAt = Date.now();
          order += 1;
        }
        draft.sections = draft.sections.filter((item) => item.id !== id);
        normalizeSectionOrders(draft.sections, section.pageId);
      });

      return {
        ok: result.ok,
        removedWebsites: 0,
        movedWebsites: affected.length,
        message: result.ok
          ? `已将 ${affected.length} 个网站移动到其他分区，并删除该分区。`
          : result.message,
      };
    }

    const result = await mutate((draft) => {
      draft.sections = draft.sections.filter((item) => item.id !== id);
      draft.websites = draft.websites.filter((website) => website.sectionId !== id);
      draft.recentVisits = draft.recentVisits.filter((visit) => visit.sectionId !== id);
      normalizeSectionOrders(draft.sections, section.pageId);
    });

    return {
      ok: result.ok,
      removedWebsites: affected.length,
      movedWebsites: 0,
      message: result.ok
        ? `已删除分区${affected.length > 0 ? `及其中 ${affected.length} 个网站` : ''}。`
        : result.message,
    };
  },

  /* ---------------- 网站 ---------------- */

  websiteById(id: string): Website | undefined {
    return state.data.websites.find((website) => website.id === id);
  },

  async addWebsite(
    pageId: string,
    sectionId: string,
    input: WebsiteInput,
  ): Promise<{ ok: boolean; message: string; website?: Website }> {
    const timestamp = Date.now();
    const website: Website = {
      id: createId('web'),
      pageId,
      sectionId,
      name: input.name.trim(),
      url: input.url.trim(),
      description: input.description.trim(),
      icon: input.icon.trim(),
      iconType: input.iconType,
      openInNewTab: input.openInNewTab,
      favorite: false,
      order: nextOrder(state.data.websites.filter((item) => item.sectionId === sectionId)),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const result = await mutate((draft) => {
      draft.websites.push(website);
    });
    return { ...result, website: result.ok ? website : undefined };
  },

  async updateWebsite(id: string, patch: Partial<Omit<Website, 'id' | 'createdAt'>>): Promise<MutateResult> {
    return mutate((draft) => {
      const website = draft.websites.find((item) => item.id === id);
      if (!website) return;

      const previousSectionId = website.sectionId;
      if (patch.name !== undefined) website.name = patch.name.trim();
      if (patch.url !== undefined) website.url = patch.url.trim();
      if (patch.description !== undefined) website.description = patch.description.trim();
      if (patch.icon !== undefined) website.icon = patch.icon.trim();
      if (patch.iconType !== undefined) website.iconType = patch.iconType;
      if (patch.openInNewTab !== undefined) website.openInNewTab = patch.openInNewTab;
      if (patch.favorite !== undefined) website.favorite = patch.favorite;
      if (patch.sectionId !== undefined && patch.sectionId !== previousSectionId) {
        const target = draft.sections.find((section) => section.id === patch.sectionId);
        if (target) {
          website.sectionId = target.id;
          website.pageId = target.pageId;
          website.order = nextOrder(draft.websites.filter((item) => item.sectionId === target.id));
        }
      }
      if (patch.order !== undefined) website.order = patch.order;
      website.updatedAt = Date.now();

      if (patch.sectionId !== undefined && patch.sectionId !== previousSectionId) {
        normalizeWebsiteOrders(draft.websites, previousSectionId);
      }
    });
  },

  async deleteWebsite(id: string): Promise<MutateResult> {
    const website = state.data.websites.find((item) => item.id === id);
    if (!website) return { ok: false, message: '网站不存在，可能已被删除。' };
    const sectionId = website.sectionId;

    return mutate((draft) => {
      draft.websites = draft.websites.filter((item) => item.id !== id);
      draft.recentVisits = draft.recentVisits.filter((visit) => visit.websiteId !== id);
      normalizeWebsiteOrders(draft.websites, sectionId);
    });
  },

  async deleteWebsites(ids: string[]): Promise<MutateResult> {
    const idSet = new Set(ids);
    if (idSet.size === 0) return { ok: false, message: '没有选中任何网站。' };

    return mutate((draft) => {
      const touchedSections = new Set(
        draft.websites.filter((website) => idSet.has(website.id)).map((website) => website.sectionId),
      );
      draft.websites = draft.websites.filter((website) => !idSet.has(website.id));
      draft.recentVisits = draft.recentVisits.filter((visit) => !idSet.has(visit.websiteId));
      touchedSections.forEach((sectionId) => normalizeWebsiteOrders(draft.websites, sectionId));
    });
  },

  async setFavorite(ids: string[], favorite: boolean): Promise<MutateResult> {
    const idSet = new Set(ids);
    return mutate((draft) => {
      for (const website of draft.websites) {
        if (!idSet.has(website.id)) continue;
        website.favorite = favorite;
        website.updatedAt = Date.now();
      }
    });
  },

  async setOpenInNewTab(ids: string[], openInNewTab: boolean): Promise<MutateResult> {
    const idSet = new Set(ids);
    return mutate((draft) => {
      for (const website of draft.websites) {
        if (!idSet.has(website.id)) continue;
        website.openInNewTab = openInNewTab;
        website.updatedAt = Date.now();
      }
    });
  },

  /** 批量移动分区 */
  async moveWebsites(ids: string[], targetSectionId: string): Promise<MutateResult> {
    const idSet = new Set(ids);
    if (idSet.size === 0) return { ok: false, message: '没有选中任何网站。' };

    const target = state.data.sections.find((section) => section.id === targetSectionId);
    if (!target) return { ok: false, message: '目标分区不存在，可能已被删除。' };

    return mutate((draft) => {
      const touched = new Set<string>();
      let order = nextOrder(draft.websites.filter((website) => website.sectionId === targetSectionId));
      for (const website of draft.websites) {
        if (!idSet.has(website.id) || website.sectionId === targetSectionId) continue;
        touched.add(website.sectionId);
        website.sectionId = targetSectionId;
        website.pageId = target.pageId;
        website.order = order;
        website.updatedAt = Date.now();
        order += 1;
      }
      touched.forEach((sectionId) => normalizeWebsiteOrders(draft.websites, sectionId));
    });
  },

  /** 单个网站移动（右键菜单用） */
  async moveWebsite(id: string, targetSectionId: string): Promise<MutateResult> {
    return store.moveWebsites([id], targetSectionId);
  },

  /** 分区内排序（拖拽结束后调用） */
  async reorderWebsites(sectionId: string, orderedIds: string[]): Promise<MutateResult> {
    return mutate(
      (draft) => {
        const sectionWebsites = draft.websites.filter((website) => website.sectionId === sectionId);
        const reordered = reorderByIds(sectionWebsites, orderedIds);
        const map = new Map(reordered.map((website) => [website.id, website]));
        draft.websites = draft.websites.map((website) => map.get(website.id) ?? website);
      },
      { debounceMs: 0 },
    );
  },

  /** 跨分区拖拽：把 from 分区中选定的网站按目标顺序插入到 to 分区 */
  async moveWebsiteToSectionAt(
    websiteId: string,
    targetSectionId: string,
    targetIndex: number,
  ): Promise<MutateResult> {
    const target = state.data.sections.find((section) => section.id === targetSectionId);
    if (!target) return { ok: false, message: '目标分区不存在，可能已被删除。' };

    return mutate(
      (draft) => {
        const website = draft.websites.find((item) => item.id === websiteId);
        if (!website) return;
        const sourceSectionId = website.sectionId;

        website.sectionId = targetSectionId;
        website.pageId = target.pageId;
        website.updatedAt = Date.now();

        const targetList = draft.websites
          .filter((item) => item.sectionId === targetSectionId && item.id !== websiteId)
          .sort((a, b) => a.order - b.order);
        const index = Math.max(0, Math.min(targetIndex, targetList.length));
        targetList.splice(index, 0, website);

        const orderMap = new Map<string, number>();
        targetList.forEach((item, position) => orderMap.set(item.id, position));
        draft.websites = draft.websites.map((item) =>
          orderMap.has(item.id) ? { ...item, order: orderMap.get(item.id) ?? item.order } : item,
        );

        if (sourceSectionId !== targetSectionId) {
          normalizeWebsiteOrders(draft.websites, sourceSectionId);
        }
      },
      { debounceMs: 0 },
    );
  },

  /* ---------------- 最近访问 ---------------- */

  recordVisit(website: Website): void {
    if (!state.data.settings.recentVisitsEnabled) return;

    const visit: RecentVisit = {
      id: createId('visit'),
      websiteId: website.id,
      name: website.name,
      url: website.url,
      icon: website.icon,
      iconType: website.iconType,
      pageId: website.pageId,
      sectionId: website.sectionId,
      visitedAt: Date.now(),
    };

    const limit = state.data.settings.recentVisitsLimit;
    const nextVisits = [visit, ...state.data.recentVisits.filter((item) => item.websiteId !== website.id)]
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit);
    state.data.recentVisits = nextVisits;
    scheduleFlush();
  },

  async clearRecentVisits(): Promise<MutateResult> {
    return mutate((draft) => {
      draft.recentVisits = [];
    });
  },

  recentVisits(): RecentVisit[] {
    return [...state.data.recentVisits].sort((a, b) => b.visitedAt - a.visitedAt);
  },

  /* ---------------- 设置 ---------------- */

  async updateSettings(patch: Partial<AppSettings>): Promise<MutateResult> {
    return mutate((draft) => {
      draft.settings = {
        ...draft.settings,
        ...patch,
        background: patch.background
          ? { ...draft.settings.background, ...patch.background }
          : draft.settings.background,
      };
    });
  },

  /* ---------------- 整体替换（导入 / 恢复默认） ---------------- */

  async replaceState(
    next: NaviState,
    options: { markImported?: boolean; force?: boolean } = {},
  ): Promise<MutateResult> {
    // 只读保护下默认拒绝覆盖；只有用户在二次确认后显式操作（导入/恢复默认/清空）
    // 才会带 force 调用，这是"用户主动放弃保护"的唯一入口。
    if (state.writeProtected && options.force !== true) {
      return { ok: false, message: WRITE_PROTECTED_MESSAGE };
    }

    const backup: NaviState = JSON.parse(JSON.stringify(state.data)) as NaviState;
    const backupPersisted = persistedSnapshot;
    const backupActive = state.activePageId;
    const backupProtected = state.writeProtected;

    state.data = next;
    state.activePageId = next.pages[0]?.id ?? '';
    state.writeProtected = false;

    const meta = createMeta(true);
    if (options.markImported) meta.lastImportedAt = Date.now();

    const result = await repo.saveAll(next, meta, state.activePageId);
    if (!result.ok) {
      state.data = backup;
      state.activePageId = backupActive;
      state.writeProtected = backupProtected;
      persistedSnapshot = backupPersisted;
      state.errorMessage = toErrorMessage(result);
      return { ok: false, message: toErrorMessage(result) };
    }

    resetPersistedBaseline();
    return { ok: true, message: '' };
  },

  /** 恢复默认配置（演示数据）—— 必须由用户二次确认后调用 */
  async restoreDefaults(): Promise<MutateResult> {
    return store.replaceState(createDemoData(), { force: true });
  },

  /** 清空本地导航数据（保留设置）—— 必须由用户二次确认后调用 */
  async clearNavigationData(): Promise<MutateResult> {
    const next: NaviState = {
      schemaVersion: SCHEMA_VERSION,
      pages: [],
      sections: [],
      websites: [],
      settings: state.data.settings,
      recentVisits: [],
    };
    return store.replaceState(next, { force: true });
  },

  /** 导出用快照（保持只读语义，返回深拷贝） */
  snapshot(): NaviState {
    return JSON.parse(JSON.stringify(state.data)) as NaviState;
  },

  estimateUsage: () => repo.estimateUsage(),
};

/** 便捷组合式读取：当前页面的分区 + 网站 */
export const activePageSections = computed<Section[]>(() => store.sectionsOfPage(state.activePageId));

/** 当前页面网站总数（响应式） */
export const activePageWebsiteCount = computed<number>(() =>
  state.data.websites.filter((website) => website.pageId === state.activePageId).length,
);
