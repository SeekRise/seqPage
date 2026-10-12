/**
 * URL 处理工具
 *
 * 安全要点：
 * - 只接受 http / https 协议，拒绝 javascript:、data:、vbscript:、file: 等。
 * - 用户在地址框输入的内容全部走 normalizeUrl 归一化，避免伪造协议。
 * - 打开链接统一走 openUrl，先校验再交给 chrome.tabs 或 window.open。
 */

/** 允许用于导航的协议白名单 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** 明确拒绝的危险协议（用于给出更清晰的错误提示） */
const DANGEROUS_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'filesystem:',
  'chrome:',
  'chrome-extension:',
  'about:',
]);

export interface UrlCheckResult {
  ok: boolean;
  /** 归一化后的地址（ok=true 时可用） */
  url: string;
  /** 面向用户的错误提示 */
  message: string;
}

/** 判断文本是否看起来像一个网址（用于地址栏智能识别） */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  // 含空格的多半是搜索词
  if (/\s/.test(value)) return false;
  // localhost:3000 / 192.168.1.1:8080
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(value)) return true;
  // 带点的域名，如 github.com、a.b.co/path
  return /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(value);
}

/**
 * 归一化并校验用户输入的网址。
 * - 自动去除首尾空格（包括全角空格）。
 * - 缺少协议时补全 https://
 * - 拒绝非 http/https 协议。
 */
export function normalizeUrl(input: string): UrlCheckResult {
  const raw = input.replace(/[\u3000\s]+/g, ' ').trim();
  if (!raw) {
    return { ok: false, url: '', message: '请输入网站地址。' };
  }

  // 协议探测：形如 scheme: 的前缀
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (schemeMatch) {
    const scheme = `${schemeMatch[1].toLowerCase()}:`;
    if (DANGEROUS_PROTOCOLS.has(scheme)) {
      return {
        ok: false,
        url: '',
        message: `不支持 ${scheme} 协议，仅允许 http:// 或 https:// 地址。`,
      };
    }
    if (!ALLOWED_PROTOCOLS.has(scheme)) {
      return {
        ok: false,
        url: '',
        message: `无法识别的协议 ${scheme}，请输入以 http:// 或 https:// 开头的地址。`,
      };
    }
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, url: '', message: `“${input.trim()}” 不是有效的网址格式。` };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      url: '',
      message: `不支持 ${parsed.protocol} 协议，仅允许 http:// 或 https:// 地址。`,
    };
  }

  if (!parsed.hostname || !parsed.hostname.includes('.') ) {
    // localhost 或纯主机名也允许，但必须是明确的主机名
    if (!/^[a-z0-9-]+$/i.test(parsed.hostname)) {
      return { ok: false, url: '', message: `“${input.trim()}” 缺少有效的主机名。` };
    }
  }

  return { ok: true, url: parsed.toString(), message: '' };
}

/** 校验一个已存储的 URL 是否仍然安全可用 */
export function isSafeUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** 提取主机名，失败返回空串 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** 去掉 www. 前缀的主机名，用于展示 */
export function getDisplayHost(url: string): string {
  return getHostname(url).replace(/^www\./i, '');
}

/**
 * 生成图标兜底用的首字母（最多 2 个字符）。
 * 中文取前 2 个字，英文取单词首字母。
 */
export function getInitials(name: string): string {
  const value = name.trim();
  if (!value) return '#';

  if (/[\u4e00-\u9fa5]/.test(value)) {
    return value.slice(0, 2);
  }

  const words = value.split(/[\s\-_.]+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
  }
  return value.slice(0, 2).toUpperCase();
}

/** 根据网站名称生成稳定的主题色（同一名称始终得到同一颜色） */
export function getColorFromString(input: string): string {
  const palette = [
    '#3B6FE0',
    '#2F80ED',
    '#00A3A3',
    '#1E9E5A',
    '#E08A1E',
    '#D9534F',
    '#8E5BD9',
    '#C2410C',
    '#0E7490',
    '#4F46E5',
  ];
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 100000;
  }
  return palette[hash % palette.length];
}

/**
 * 打开一个网址。
 * - 再次校验协议，防止存储中被污染的数据触发危险跳转。
 * - 优先使用 chrome.tabs.create，失败时回退 window.open。
 * @returns 是否成功发起跳转
 */
export async function openUrl(url: string, newTab: boolean): Promise<boolean> {
  const check = normalizeUrl(url);
  if (!check.ok) {
    console.warn('[My Navi] 拒绝打开不安全地址：', url, check.message);
    return false;
  }

  const target = check.url;
  const tabsApi = globalThis.chrome?.tabs;

  if (newTab) {
    if (tabsApi?.create) {
      try {
        await tabsApi.create({ url: target });
        return true;
      } catch (error) {
        console.warn('[My Navi] chrome.tabs.create 失败，回退 window.open：', error);
      }
    }
    window.open(target, '_blank', 'noopener,noreferrer');
    return true;
  }

  if (tabsApi?.update) {
    try {
      const [active] = await tabsApi.query({ active: true, currentWindow: true });
      if (active?.id !== undefined) {
        await tabsApi.update(active.id, { url: target });
        return true;
      }
    } catch (error) {
      console.warn('[My Navi] chrome.tabs.update 失败，回退 location.assign：', error);
    }
  }

  window.location.assign(target);
  return true;
}
