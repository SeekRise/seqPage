<script setup lang="ts">
/**
 * 通用右键菜单（单例）
 *
 * 行为要求：
 * - 位置按视口边界校正，永不出界（任务书 16）。
 * - 键盘可用：打开后自动聚焦首项，↑↓ 切换，Enter 触发，Esc 关闭并归还焦点。
 * - 点击空白、滚动、窗口尺寸变化、路由级页面切换均会关闭。
 */
import { computed, onBeforeUnmount, onMounted, nextTick, ref, watch } from 'vue';
import { clampMenuPosition, closeContextMenu, contextMenuState } from '@/composables/useContextMenu';
import SvgIcon from '@/components/SvgIcon.vue';

const menuRef = ref<HTMLElement | null>(null);
const rawPosition = ref({ x: 0, y: 0 });
const measured = ref({ width: 200, height: 0 });
const activeIndex = ref(-1);

const items = computed(() => contextMenuState.value.items);

const position = computed(() => clampMenuPosition(rawPosition.value.x, rawPosition.value.y, measured.value.width, measured.value.height));

const selectableIndexes = computed(() =>
  items.value
    .map((item, index) => (item.divider || item.disabled ? -1 : index))
    .filter((index) => index >= 0),
);

async function open(): Promise<void> {
  rawPosition.value = { x: contextMenuState.value.x, y: contextMenuState.value.y };
  activeIndex.value = -1;
  await nextTick();
  measure();
  const first = selectableIndexes.value[0];
  activeIndex.value = first ?? -1;
  focusActive();
}

function measure(): void {
  const element = menuRef.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  measured.value = { width: rect.width, height: rect.height };
}

function focusActive(): void {
  const element = menuRef.value?.querySelector<HTMLElement>('.context-menu__item--active');
  element?.focus({ preventScroll: true });
}

function moveActive(step: number): void {
  const list = selectableIndexes.value;
  if (list.length === 0) return;
  const currentPos = list.indexOf(activeIndex.value);
  const nextPos = currentPos === -1 ? 0 : (currentPos + step + list.length) % list.length;
  activeIndex.value = list[nextPos] ?? -1;
  nextTick(focusActive);
}

function runItem(index: number): void {
  const item = items.value[index];
  if (!item || item.divider || item.disabled) return;
  closeContextMenu(true);
  item.onSelect?.();
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!contextMenuState.value.open) return;
  const element = menuRef.value;
  if (element && event.target instanceof Node && element.contains(event.target)) return;
  closeContextMenu();
}

function onScroll(): void {
  closeContextMenu();
}

function onKeydown(event: KeyboardEvent): void {
  if (!contextMenuState.value.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeContextMenu(true);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveActive(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveActive(-1);
    return;
  }
  if (event.key === 'Tab') {
    closeContextMenu();
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (activeIndex.value >= 0) runItem(activeIndex.value);
  }
}

watch(
  () => contextMenuState.value.open,
  (isOpen) => {
    if (isOpen) void open();
  },
);

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  window.addEventListener('blur', onScroll);
  document.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  document.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onScroll);
  window.removeEventListener('blur', onScroll);
  document.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="contextMenuState.open"
        ref="menuRef"
        class="context-menu"
        role="menu"
        :aria-label="contextMenuState.title || '快捷操作菜单'"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      >
        <p v-if="contextMenuState.title" class="context-menu__title">{{ contextMenuState.title }}</p>
        <template v-for="(item, index) in items" :key="item.id">
          <div v-if="item.divider" class="context-menu__divider" role="separator" />
          <button
            v-else
            type="button"
            role="menuitem"
            class="context-menu__item"
            :class="{
              'context-menu__item--danger': item.danger,
              'context-menu__item--active': activeIndex === index,
              'context-menu__item--disabled': item.disabled,
            }"
            :disabled="item.disabled"
            :tabindex="activeIndex === index ? 0 : -1"
            @mouseenter="activeIndex = index"
            @click="runItem(index)"
          >
            <span class="context-menu__icon">
              <SvgIcon :name="item.icon ?? 'chevronRight'" :size="15" />
            </span>
            <span class="context-menu__label">{{ item.label }}</span>
            <span v-if="item.hint" class="context-menu__hint">{{ item.hint }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 2000;
  min-width: 188px;
  max-width: 280px;
  padding: var(--space-1);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  max-height: calc(100vh - 16px);
  overflow-y: auto;
}

.context-menu__title {
  padding: var(--space-2) var(--space-2) var(--space-1);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.context-menu__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-base);
  color: var(--text-primary);
  text-align: left;
}

.context-menu__item--active,
.context-menu__item:hover {
  background: var(--bg-hover);
}

.context-menu__item--danger {
  color: var(--color-danger);
}

.context-menu__item--danger.context-menu__item--active,
.context-menu__item--danger:hover {
  background: var(--color-danger-bg);
}

.context-menu__item--disabled {
  color: var(--text-tertiary);
  cursor: not-allowed;
}

.context-menu__item--disabled:hover {
  background: transparent;
}

.context-menu__icon {
  display: flex;
  align-items: center;
  color: var(--text-secondary);
}

.context-menu__item--danger .context-menu__icon {
  color: var(--color-danger);
}

.context-menu__label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.context-menu__hint {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.context-menu__divider {
  height: 1px;
  margin: var(--space-1) var(--space-2);
  background: var(--border-color);
}
</style>
