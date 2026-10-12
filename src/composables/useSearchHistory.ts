/**
 * 搜索历史（本地）
 *
 * 存放位置：chrome.storage.local 的一个独立分片（与导航数据分开，便于单独清理）。
 * 关闭设置项时不再写入，并提供清空入口。
 * 只在用户主动提交搜索/打开网站时记录，不做任何后台采集。
 */
import { ref } from 'vue';
import { SEARCH_HISTORY_KEY, readRaw, writeRaw } from '@/services/storage';

const HISTORY_KEY = SEARCH_HISTORY_KEY;
const MAX_HISTORY = 20;

export interface SearchHistoryItem {
  keyword: string;
  engineId: string;
  searchedAt: number;
}

const items = ref<SearchHistoryItem[]>([]);
let loaded = false;

/** 从存储加载历史（只加载一次） */
export async function loadSearchHistory(): Promise<void> {
  if (loaded) return;
  const result = await readRaw(HISTORY_KEY);
  const raw = result.ok ? result.data : undefined;
  if (Array.isArray(raw)) {
    items.value = raw
      .filter(
        (item): item is SearchHistoryItem =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as SearchHistoryItem).keyword === 'string',
      )
      .slice(0, MAX_HISTORY);
  }
  loaded = true;
}

async function persist(): Promise<void> {
  await writeRaw(HISTORY_KEY, items.value);
}

/** 记录一次搜索 */
export async function pushSearchHistory(keyword: string, engineId: string): Promise<void> {
  const value = keyword.trim();
  if (!value) return;
  const next: SearchHistoryItem[] = [
    { keyword: value, engineId, searchedAt: Date.now() },
    ...items.value.filter((item) => item.keyword !== value),
  ].slice(0, MAX_HISTORY);
  items.value = next;
  await persist();
}

/** 删除单条历史 */
export async function removeSearchHistory(keyword: string): Promise<void> {
  items.value = items.value.filter((item) => item.keyword !== keyword);
  await persist();
}

/** 清空历史 */
export async function clearSearchHistory(): Promise<void> {
  items.value = [];
  await persist();
}

export const searchHistory = items;

export function useSearchHistory() {
  return {
    items: searchHistory,
    load: loadSearchHistory,
    push: pushSearchHistory,
    remove: removeSearchHistory,
    clear: clearSearchHistory,
  };
}
