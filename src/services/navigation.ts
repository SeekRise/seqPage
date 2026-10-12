/**
 * 导航领域服务：纯数据操作，不接触存储也不接触 DOM。
 *
 * 这里集中处理：
 * - 演示数据的实体化（蓝图 → 带 ID 与 order 的真实数据）
 * - order 字段的重排（保证连续、稳定）
 * - 数据完整性修复（孤立分区/网站、非法 URL、失效关联）
 *
 * 保持纯函数便于复用与推理，store 只负责编排与持久化。
 */
import { DEMO_BLUEPRINT } from '@/data/demo';
import type {
  IntegrityReport,
  NaviState,
  NavigationPage,
  RecentVisit,
  Section,
  Website,
} from '@/types';
import { SCHEMA_VERSION } from '@/types';
import { DEFAULT_SETTINGS } from '@/utils/constants';
import { createId } from '@/utils/common';
import { isSafeUrl, normalizeUrl } from '@/utils/url';
import { parseSettings } from '@/utils/validators';

/** 计算某个集合中下一个可用的 order 值 */
export function nextOrder(items: readonly { order: number }[]): number {
  if (items.length === 0) return 0;
  return Math.max(...items.map((item) => item.order)) + 1;
}

/**
 * 按给定的 ID 顺序重排实体，并写回连续的 order 值。
 * - 不在 orderedIds 中的实体保持原相对顺序，追加在末尾。
 */
export function reorderByIds<T extends { id: string; order: number }>(
  items: readonly T[],
  orderedIds: string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];

  orderedIds.forEach((id) => {
    const item = byId.get(id);
    if (item) {
      result.push(item);
      byId.delete(id);
    }
  });

  // 未出现在排序列表中的实体按原顺序补齐，避免拖拽丢失数据
  [...byId.values()]
    .sort((a, b) => a.order - b.order)
    .forEach((item) => result.push(item));

  return result.map((item, index) => ({ ...item, order: index }));
}

/** 把某个页面的分区 order 重新编号为连续值 */
export function normalizeSectionOrders(sections: Section[], pageId: string): void {
  sections
    .filter((section) => section.pageId === pageId)
    .sort((a, b) => a.order - b.order)
    .forEach((section, index) => {
      section.order = index;
    });
}

/** 把某个分区的网站 order 重新编号为连续值 */
export function normalizeWebsiteOrders(websites: Website[], sectionId: string): void {
  websites
    .filter((website) => website.sectionId === sectionId)
    .sort((a, b) => a.order - b.order)
    .forEach((website, index) => {
      website.order = index;
    });
}

/** 查找可用于接收网站的分区（同页面内的其他分区，优先选择网站最少的那个） */
export function findFallbackSectionId(
  state: NaviState,
  pageId: string,
  excludeSectionId: string,
): string | null {
  const candidates = state.sections
    .filter((section) => section.pageId === pageId && section.id !== excludeSectionId)
    .map((section) => ({
      id: section.id,
      count: state.websites.filter((website) => website.sectionId === section.id).length,
      order: section.order,
    }))
    .sort((a, b) => a.count - b.count || a.order - b.order);

  return candidates[0]?.id ?? null;
}

/** 生成演示数据（首次启动使用） */
export function createDemoData(): NaviState {
  const pages: NavigationPage[] = [];
  const sections: Section[] = [];
  const websites: Website[] = [];
  const timestamp = Date.now();

  DEMO_BLUEPRINT.forEach((pageBlueprint, pageIndex) => {
    const pageId = createId('page');
    pages.push({
      id: pageId,
      name: pageBlueprint.name,
      icon: pageBlueprint.icon,
      order: pageIndex,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    pageBlueprint.sections.forEach((sectionBlueprint, sectionIndex) => {
      const sectionId = createId('sec');
      sections.push({
        id: sectionId,
        pageId,
        name: sectionBlueprint.name,
        icon: sectionBlueprint.icon,
        color: sectionBlueprint.color,
        order: sectionIndex,
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      sectionBlueprint.websites.forEach((websiteBlueprint, websiteIndex) => {
        const normalized = normalizeUrl(websiteBlueprint.url);
        websites.push({
          id: createId('web'),
          pageId,
          sectionId,
          name: websiteBlueprint.name,
          url: normalized.ok ? normalized.url : websiteBlueprint.url,
          description: websiteBlueprint.description,
          icon: websiteBlueprint.icon ?? '',
          iconType: websiteBlueprint.iconType ?? 'auto',
          openInNewTab: true,
          favorite: websiteBlueprint.favorite ?? false,
          order: websiteIndex,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });
    });
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    pages,
    sections,
    websites,
    settings: { ...DEFAULT_SETTINGS, background: { ...DEFAULT_SETTINGS.background } },
    recentVisits: [],
  };
}

/**
 * 数据完整性修复。
 * 场景：手工编辑存储、导入部分损坏的配置、或早期版本遗留数据。
 * 原则：尽可能保留原始数据，只修复明确无效的部分，并把修复情况报告给用户。
 */
export function repairState(input: NaviState): { state: NaviState; report: IntegrityReport } {
  const report: IntegrityReport = {
    orphanSections: 0,
    orphanWebsites: 0,
    reassignedWebsites: 0,
    invalidUrls: 0,
    reordered: 0,
  };

  const pages: NavigationPage[] = [...input.pages].sort((a, b) => a.order - b.order);
  const pageIds = new Set(pages.map((page) => page.id));

  // 1. 丢弃所属页面不存在的分区
  const sections: Section[] = [];
  for (const section of [...input.sections].sort((a, b) => a.order - b.order)) {
    if (!pageIds.has(section.pageId)) {
      report.orphanSections += 1;
      continue;
    }
    sections.push({ ...section });
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const sectionPageMap = new Map(sections.map((section) => [section.id, section.pageId]));

  // 2. 修复网站：URL 非法 → 丢弃该条；分区不存在 → 迁移到同页面内的其他分区；页面字段与分区不一致 → 以分区为准
  const websites: Website[] = [];
  for (const website of [...input.websites].sort((a, b) => a.order - b.order)) {
    if (!isSafeUrl(website.url)) {
      report.invalidUrls += 1;
      continue;
    }

    let targetSectionId = website.sectionId;
    if (!sectionIds.has(targetSectionId)) {
      const fallback = findFallbackSectionId({ ...input, pages, sections }, website.pageId, website.sectionId);
      if (!fallback) {
        // 该页面已没有任何分区可以接收它，只能丢弃（不会静默丢失：计入报告并提示用户）
        report.orphanWebsites += 1;
        continue;
      }
      targetSectionId = fallback;
      report.reassignedWebsites += 1;
    }

    const correctPageId = sectionPageMap.get(targetSectionId) ?? website.pageId;
    if (correctPageId !== website.pageId) report.reassignedWebsites += 1;

    websites.push({ ...website, sectionId: targetSectionId, pageId: correctPageId });
  }

  // 3. 重排 order，保证每个分组内连续稳定（页面 / 页面内的分区 / 分区内的网站）
  let reordered = false;
  const reorderedPages = pages.map((page, index) => {
    if (page.order !== index) reordered = true;
    return page.order === index ? page : { ...page, order: index };
  });

  const normalizedSections: Section[] = [];
  for (const page of reorderedPages) {
    sections
      .filter((section) => section.pageId === page.id)
      .forEach((section, index) => {
        if (section.order !== index) reordered = true;
        normalizedSections.push(section.order === index ? section : { ...section, order: index });
      });
  }

  const normalizedWebsites: Website[] = [];
  for (const section of normalizedSections) {
    websites
      .filter((website) => website.sectionId === section.id)
      .forEach((website, index) => {
        if (website.order !== index) reordered = true;
        normalizedWebsites.push(website.order === index ? website : { ...website, order: index });
      });
  }

  if (reordered) report.reordered = 1;

  // 4. 清理最近访问中地址非法或所属页面已被删除的记录
  const recentVisitLimit = Math.min(Math.max(input.settings?.recentVisitsLimit ?? 30, 5), 200);
  const recentVisits: RecentVisit[] = input.recentVisits
    .filter((visit) => isSafeUrl(visit.url))
    .filter((visit) => !visit.pageId || pageIds.has(visit.pageId))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, recentVisitLimit);

  return {
    state: {
      schemaVersion: SCHEMA_VERSION,
      pages: reorderedPages,
      sections: normalizedSections,
      websites: normalizedWebsites,
      settings: parseSettings(input.settings, DEFAULT_SETTINGS),
      recentVisits,
    },
    report,
  };
}

/** 判断完整性报告是否有需要告知用户的内容 */
export function hasIntegrityIssues(report: IntegrityReport | null): boolean {
  if (!report) return false;
  return (
    report.orphanSections > 0 ||
    report.orphanWebsites > 0 ||
    report.reassignedWebsites > 0 ||
    report.invalidUrls > 0
  );
}

/** 生成完整性修复提示文案 */
export function describeIntegrityReport(report: IntegrityReport): string {
  const parts: string[] = [];
  if (report.orphanSections > 0) parts.push(`清理了 ${report.orphanSections} 个失去所属页面的分区`);
  if (report.orphanWebsites > 0) parts.push(`清理了 ${report.orphanWebsites} 个无法归属的网站`);
  if (report.reassignedWebsites > 0) parts.push(`重新归属了 ${report.reassignedWebsites} 个网站`);
  if (report.invalidUrls > 0) parts.push(`移除了 ${report.invalidUrls} 条地址不合法的网站`);
  if (parts.length === 0) return '数据完整性检查通过，未发现异常。';
  return `检测到本地数据异常，已自动修复：${parts.join('；')}。`;
}
