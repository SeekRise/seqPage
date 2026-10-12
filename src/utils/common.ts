/**
 * 通用工具：稳定 ID、时间戳格式化、数值与文本处理。
 * 纯函数集合，无副作用，方便单测与复用。
 */

let counter = 0;

/**
 * 生成稳定且唯一的 ID。
 * 形如 `w_lz8k3m_4f2a1`，可读前缀 + 时间戳(base36) + 自增序号 + 随机串，
 * 避免同一毫秒内批量创建时碰撞。
 */
export function createId(prefix: string): string {
  counter = (counter + 1) % 0xffff;
  const time = Date.now().toString(36);
  const seq = counter.toString(36).padStart(3, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${time}${seq}${rand}`;
}

/** 当前时间戳（毫秒） */
export function now(): number {
  return Date.now();
}

/** 限制数值范围 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** 数字升序比较器（用于排序字段） */
export function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order;
}

/** 相对时间描述：刚刚 / 5 分钟前 / 3 小时前 / 2 天前 / 具体日期 */
export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) return '刚刚';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(timestamp);
}

/** 格式化为 YYYY-MM-DD HH:mm */
export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 用于导出文件名的日期串：20260101-1530 */
export function formatFileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** 截断文本，超出长度补省略号 */
export function truncate(text: string, max: number): string {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

/** 生成两个字符串之间用于高亮的片段 */
export function matchKeyword(source: string, keyword: string): boolean {
  if (!keyword) return false;
  return source.toLowerCase().includes(keyword.toLowerCase());
}

/** 简单的防抖 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  };
}

/**
 * 深拷贝：仅处理 JSON 可序列化数据（本项目全部状态均满足）。
 * 不使用 structuredClone 是为了兼容旧版 Chrome 与避免函数丢失歧义。
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
