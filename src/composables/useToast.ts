/**
 * 轻量提示（Toast）
 *
 * 为什么不引入组件库：TDesign/Ant 等库的图标依赖远程 sprite 脚本，
 * 在 MV3 的 CSP 下会被拦截，反而带来"图标全空"的隐性故障。
 * 这里用不到 60 行实现等价的轻提示能力，零依赖、可离线。
 */
import { computed, ref } from 'vue';
import { createId } from '@/utils/common';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** 详细说明（例如错误排查建议） */
  detail?: string;
  duration: number;
}

const items = ref<ToastItem[]>([]);

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 2400,
  info: 2600,
  warning: 4000,
  error: 5200,
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function push(type: ToastType, message: string, detail?: string, duration?: number): string {
  const id = createId('toast');
  const item: ToastItem = {
    id,
    type,
    message,
    ...(detail ? { detail } : {}),
    duration: duration ?? DEFAULT_DURATION[type],
  };
  items.value = [...items.value, item].slice(-4);

  if (item.duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismiss(id), item.duration),
    );
  }
  return id;
}

function dismiss(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  items.value = items.value.filter((item) => item.id !== id);
}

function clear(): void {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  items.value = [];
}

/** 当前展示中的提示列表（独立导出，供组件在模板中直接使用，类型最明确） */
export const toastItems = computed<ToastItem[]>(() => items.value);

/** 全局单例 toast API，任意模块可直接 import 使用 */
export const toast = {
  items: toastItems,
  success: (message: string, detail?: string) => push('success', message, detail),
  error: (message: string, detail?: string) => push('error', message, detail),
  warning: (message: string, detail?: string) => push('warning', message, detail),
  info: (message: string, detail?: string) => push('info', message, detail),
  dismiss,
  clear,
};

/** 组合式用法（与直接使用 toast 等价，便于组件内统一解构） */
export function useToast() {
  return toast;
}
