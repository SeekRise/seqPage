/**
 * 本地导航搜索
 *
 * 特点：
 * - 纯本地计算，不发起任何网络请求。
 * - 预建索引（小写化的检索文本），避免每次输入都重复构造字符串。
 * - 打分排序：名称命中 > 网址命中 > 描述命中；分区/页面名称命中作为补充。
 * - 只读操作，绝不修改或删除原有数据。
 */
import type { NaviState, NavigationPage, SearchResult, Section, Website } from '@/types';

export interface SearchIndexEntry {
  website: Website;
  page: NavigationPage | undefined;
  section: Section | undefined;
  nameLower: string;
  urlLower: string;
  hostLower: string;
  descriptionLower: string;
  sectionNameLower: string;
  pageNameLower: string;
}

export interface SearchIndex {
  entries: SearchIndexEntry[];
  builtAt: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** 建立搜索索引 */
export function buildSearchIndex(state: NaviState): SearchIndex {
  const pageMap = new Map(state.pages.map((page) => [page.id, page]));
  const sectionMap = new Map(state.sections.map((section) => [section.id, section]));

  const entries = state.websites.map<SearchIndexEntry>((website) => {
    const page = pageMap.get(website.pageId);
    const section = sectionMap.get(website.sectionId);
    return {
      website,
      page,
      section,
      nameLower: website.name.toLowerCase(),
      urlLower: website.url.toLowerCase(),
      hostLower: hostOf(website.url),
      descriptionLower: website.description.toLowerCase(),
      sectionNameLower: (section?.name ?? '').toLowerCase(),
      pageNameLower: (page?.name ?? '').toLowerCase(),
    };
  });

  return { entries, builtAt: Date.now() };
}

/** 单条记录打分，0 表示不匹配 */
function scoreEntry(entry: SearchIndexEntry, keyword: string): { score: number; fields: string[] } {
  const fields: string[] = [];
  let score = 0;

  if (entry.nameLower === keyword) {
    score += 120;
    fields.push('name');
  } else if (entry.nameLower.startsWith(keyword)) {
    score += 90;
    fields.push('name');
  } else if (entry.nameLower.includes(keyword)) {
    score += 70;
    fields.push('name');
  }

  if (entry.hostLower.includes(keyword)) {
    score += 55;
    fields.push('url');
  } else if (entry.urlLower.includes(keyword)) {
    score += 45;
    fields.push('url');
  }

  if (entry.descriptionLower.includes(keyword)) {
    score += 25;
    fields.push('description');
  }

  if (entry.sectionNameLower.includes(keyword)) {
    score += 15;
    fields.push('section');
  }

  if (entry.pageNameLower.includes(keyword)) {
    score += 10;
    fields.push('page');
  }

  return { score, fields };
}

/**
 * 执行搜索。
 * @param index buildSearchIndex 的产物
 * @param query 关键词（自动小写与去空格）
 * @param limit 返回上限，避免一次渲染过多结果
 */
export function searchWebsites(index: SearchIndex, query: string, limit = 40): SearchResult[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];

  const matched: Array<{ result: SearchResult; score: number }> = [];

  for (const entry of index.entries) {
    const { score, fields } = scoreEntry(entry, keyword);
    if (score <= 0) continue;
    matched.push({
      score,
      result: {
        website: entry.website,
        page: entry.page,
        section: entry.section,
        matchedFields: fields,
      },
    });
  }

  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.result.website.favorite !== b.result.website.favorite) {
      return a.result.website.favorite ? -1 : 1;
    }
    return a.result.website.name.localeCompare(b.result.website.name, 'zh-Hans-CN');
  });

  return matched.slice(0, limit).map((item) => item.result);
}

/** 统计索引规模，用于设置面板展示 */
export function describeIndex(index: SearchIndex): string {
  return `已索引 ${index.entries.length} 个网站`;
}
