/**
 * 快捷添加当前网页
 *
 * 权限与隐私（对应任务书 8.2 / 13.2）：
 * - 只在用户主动点击按钮时调用 chrome.tabs.query，不做任何后台轮询或浏览历史采集。
 * - 只读取当前窗口的活动标签页，用完即弃，不写入任何日志或缓存。
 * - 失败时返回明确原因（例如非扩展环境、无法读取、地址不是 http/https）。
 */
import { ref } from 'vue';
import { isSafeUrl, normalizeUrl } from '@/utils/url';

export interface CurrentPageInfo {
  title: string;
  url: string;
}

export interface CurrentPageResult {
  ok: boolean;
  page: CurrentPageInfo | null;
  message: string;
}

/** 从标签页标题中提取干净的网站名称 */
export function deriveWebsiteName(title: string, url: string): string {
  const cleaned = title
    .split(/[|\-–—_·]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];

  if (cleaned && cleaned.length >= 2) return cleaned.slice(0, 60);

  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function useCurrentPage() {
  const loading = ref(false);

  /** 读取当前活动标签页信息（必须由用户点击触发） */
  async function readCurrentPage(): Promise<CurrentPageResult> {
    loading.value = true;
    try {
      const tabsApi = globalThis.chrome?.tabs;
      if (!tabsApi?.query) {
        return {
          ok: false,
          page: null,
          message: '当前不在扩展环境中运行，无法读取标签页信息。请在已安装的扩展新标签页中使用该功能。',
        };
      }

      const tabs = await tabsApi.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab) {
        return { ok: false, page: null, message: '没有找到当前活动标签页，请切换到目标网页后重试。' };
      }

      const rawUrl = tab.url ?? '';
      if (!rawUrl) {
        return {
          ok: false,
          page: null,
          message: '无法读取当前标签页地址（可能是 chrome:// 或扩展页面等受限页面）。请手动填写网站地址。',
        };
      }

      if (!isSafeUrl(rawUrl)) {
        return {
          ok: false,
          page: null,
          message: `当前页面地址为「${rawUrl.slice(0, 60)}」，不是可加入导航的 http/https 网页。请手动填写地址。`,
        };
      }

      const normalized = normalizeUrl(rawUrl);
      const url = normalized.ok ? normalized.url : rawUrl;
      return {
        ok: true,
        page: {
          url,
          title: deriveWebsiteName(tab.title ?? '', url),
        },
        message: '',
      };
    } catch (error) {
      return {
        ok: false,
        page: null,
        message: `读取当前标签页失败：${error instanceof Error ? error.message : '未知原因'}。可手动填写网站信息。`,
      };
    } finally {
      loading.value = false;
    }
  }

  return { readCurrentPage, loading };
}
