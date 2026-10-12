/**
 * 右键菜单状态
 *
 * 关键点（对应任务书 7 / 16）：
 * - 打开时按视口边界校正位置，避免菜单超出窗口可视区域。
 * - 全局只允许一个菜单实例（单例状态），避免多个菜单叠加。
 * - 支持键盘：ArrowUp/Down 移动、Enter 触发、Esc 关闭；关闭后焦点回到触发元素。
 */
import { readonly, ref } from 'vue';
import type { ContextMenuItem } from '@/types';

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  title: string;
}

const MENU_MARGIN = 8;

const state = ref<ContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  items: [],
  title: '',
});

/** 触发菜单的元素，关闭后用于恢复焦点 */
let lastTrigger: HTMLElement | null = null;

export interface OpenMenuOptions {
  items: ContextMenuItem[];
  x: number;
  y: number;
  title?: string;
  trigger?: HTMLElement | null;
}

export function openContextMenu(options: OpenMenuOptions): void {
  lastTrigger =
    options.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  state.value = {
    open: true,
    x: options.x,
    y: options.y,
    items: options.items.filter((item) => item.divider || !item.disabled || item.disabled),
    title: options.title ?? '',
  };
}

export function closeContextMenu(restoreFocus = false): void {
  if (!state.value.open) return;
  state.value = { ...state.value, open: false, items: [] };
  if (restoreFocus && lastTrigger?.isConnected) {
    lastTrigger.focus({ preventScroll: true });
  }
  lastTrigger = null;
}

/** 把菜单坐标校正到视口内（需要菜单实际尺寸，由组件测量后回调） */
export function clampMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const maxX = window.innerWidth - width - MENU_MARGIN;
  const maxY = window.innerHeight - height - MENU_MARGIN;
  return {
    x: Math.max(MENU_MARGIN, Math.min(x, Math.max(MENU_MARGIN, maxX))),
    y: Math.max(MENU_MARGIN, Math.min(y, Math.max(MENU_MARGIN, maxY))),
  };
}

export const contextMenuState = readonly(state);

export function useContextMenu() {
  return { state: contextMenuState, open: openContextMenu, close: closeContextMenu };
}
