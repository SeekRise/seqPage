/**
 * SortableJS 封装
 *
 * 为什么需要封装：
 * - 统一处理 DOM 顺序 → 业务顺序的回写（通过 data-sortable-id 读取）。
 * - Vue 的 :key 会让 DOM 顺序与数据顺序同步，但 Sortable 是直接操作 DOM 的，
 *   数据变化后需要显式调用 sort() 让 DOM 回落到正确顺序，否则会闪烁或错位。
 * - 拖拽期间给 body 加标记类，配合全局样式禁止卡片内部的点击事件，
 *   避免"拖拽结束误触打开网站"。
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import Sortable from 'sortablejs';

export interface UseSortableOptions {
  /** 容器元素（列表父节点） */
  container: Ref<HTMLElement | null>;
  /** 当前顺序的 ID 列表（响应式） */
  order: () => string[];
  /** 拖拽完成后的新顺序 */
  onReorder: (orderedIds: string[]) => void;
  /** 是否启用（例如小屏下可关闭拖拽） */
  enabled?: () => boolean;
  /** 动画时长，0 表示不做动画 */
  animation?: number;
  /** 拖拽把手选择器（不传则整项可拖） */
  handle?: string;
  /** 可拖拽项选择器，默认取带 data-sortable-id 的直接子元素 */
  draggable?: string;
  /** 是否允许拖到列表外（默认不允许，跨分区请走菜单） */
  group?: string;
}

/** 从容器 DOM 中读取当前的 ID 顺序 */
function readOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-sortable-id]'))
    .map((element) => element.dataset.sortableId ?? '')
    .filter(Boolean);
}

export function useSortable(options: UseSortableOptions) {
  let instance: Sortable | null = null;
  let isDragging = false;

  function create(): void {
    const element = options.container.value;
    if (!element || instance) return;

    instance = Sortable.create(element, {
      animation: options.animation ?? 140,
      handle: options.handle,
      draggable: options.draggable ?? '[data-sortable-id]',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      forceFallback: false,
      // 默认只在本列表内排序；跨分区移动通过右键菜单完成（更可控，也便于触屏使用）
      group: options.group ? { name: options.group, pull: false, put: false } : undefined,
      onStart: () => {
        isDragging = true;
        document.body.classList.add('is-dragging');
      },
      onEnd: (event) => {
        isDragging = false;
        document.body.classList.remove('is-dragging');

        if (event.oldIndex === event.newIndex) return;
        const target = options.container.value;
        if (!target) return;

        const orderedIds = readOrder(target);
        if (orderedIds.length > 0) options.onReorder(orderedIds);
      },
    });
  }

  function destroy(): void {
    instance?.destroy();
    instance = null;
    document.body.classList.remove('is-dragging');
  }

  /** 数据顺序变化后，把 DOM 拉回与数据一致（避免 Sortable 残留状态导致错位） */
  function syncDom(): void {
    const element = options.container.value;
    if (!element || !instance || isDragging) return;
    const order = options.order();
    const domOrder = readOrder(element);
    if (order.length !== domOrder.length || order.some((id, index) => id !== domOrder[index])) {
      // Sortable 的 sort(order) 会按给定顺序重排 DOM
      instance.sort([...order], true);
    }
  }

  onMounted(() => {
    if (options.enabled && !options.enabled()) return;
    create();
  });

  watch(
    () => options.container.value,
    (element) => {
      destroy();
      if (!element) return;
      if (options.enabled && !options.enabled()) return;
      create();
      syncDom();
    },
  );

  watch(
    () => options.order().join(','),
    () => syncDom(),
  );

  if (options.enabled) {
    watch(options.enabled, (value) => {
      if (value) {
        create();
        syncDom();
      } else {
        destroy();
      }
    });
  }

  onBeforeUnmount(destroy);

  return { destroy, syncDom };
}
