/**
 * 网站图标解析
 *
 * 获取优先级（对应任务书 6.1）：
 * 1. 用户手动指定的图标地址（iconType = 'url'）
 * 2. 用户选择的首字母图标（iconType = 'text'）
 * 3. chrome.favicon 私有 API（需 favicon 权限，Chrome 的 favicon 缓存）
 * 4. 网站自身 /favicon.ico（同源相对路径，无跨站信息泄露）
 * 5. 第三方 favicon 服务（可关闭，关闭后完全不发起远程请求）
 * 6. 本地生成的首字母兜底（不依赖网络，永远不会失败）
 *
 * 说明：Chrome 的 favicon 缓存可能因为未访问过站点、Chrome 重启等原因失效，
 * 因此必须保证每一步都有兜底，任一环节失败都不能影响卡片显示。
 */
import type { Website } from '@/types';
import { getHostname } from '@/utils/url';

export type FaviconSource = 'custom' | 'text' | 'chrome' | 'origin' | 'service' | 'fallback';

/** 判断 chrome.favicon 私有 API 是否可用 */
export function isFaviconApiAvailable(): boolean {
  return typeof globalThis.chrome?.runtime?.getURL === 'function';
}

/** 生成 chrome.favicon 私有 API 地址 */
export function buildChromeFaviconUrl(pageUrl: string, size = 32): string | null {
  if (!isFaviconApiAvailable()) return null;
  try {
    const base = globalThis.chrome.runtime.getURL('/_favicon/');
    const url = new URL(base);
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', String(size));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 按优先级生成候选图标地址列表。
 * 组件按顺序尝试，任意一个加载成功即停止。
 */
export function buildFaviconCandidates(
  website: Pick<Website, 'url' | 'icon' | 'iconType'>,
  options: { remoteFavicon: boolean; size?: number },
): string[] {
  const candidates: string[] = [];
  const size = options.size ?? 32;

  // 1. 用户自定义图标
  if (website.iconType === 'url' && website.icon.trim()) {
    candidates.push(website.icon.trim());
  }

  // 用户选择「首字母」时不再尝试网络图标
  if (website.iconType === 'text') {
    return candidates;
  }

  // 2/3. Chrome favicon 缓存
  const chromeIcon = buildChromeFaviconUrl(website.url, size);
  if (chromeIcon) candidates.push(chromeIcon);

  // 4. 站点自身 favicon（相对协议，不泄露来源页面）
  const hostname = getHostname(website.url);
  if (hostname) {
    candidates.push(`https://${hostname}/favicon.ico`);
  }

  // 5. 第三方 favicon 服务（用户可关闭）
  if (options.remoteFavicon && hostname) {
    candidates.push(
      `https://www.google.com/s2/favicons?sz=${size}&domain=${encodeURIComponent(hostname)}`,
    );
  }

  return candidates;
}

/** 是否存在任何可尝试的远程图标地址 */
export function hasRemoteCandidate(
  website: Pick<Website, 'url' | 'icon' | 'iconType'>,
  options: { remoteFavicon: boolean },
): boolean {
  return buildFaviconCandidates(website, options).length > 0;
}
