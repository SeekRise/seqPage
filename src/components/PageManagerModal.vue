<script setup lang="ts">
/**
 * 页面管理面板
 *
 * 采用紧凑列表（而不是大卡片）集中管理所有导航页面：
 * 新增 / 编辑名称与图标 / 拖拽排序 / 删除，并显示分区数与网站数。
 * 所有操作即时反映到右侧导航栏（因为共用同一份 store 状态）。
 */
import { ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { useSortable } from '@/composables/useSortable';
import type { NavigationPage } from '@/types';

const props = defineProps<{
  modelValue: boolean;
  pages: NavigationPage[];
  activePageId: string;
  sectionCounts: Record<string, number>;
  websiteCounts: Record<string, number>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  select: [pageId: string];
  'create-page': [];
  'edit-page': [page: NavigationPage];
  'remove-page': [page: NavigationPage];
  reorder: [orderedIds: string[]];
}>();

const listRef = ref<HTMLElement | null>(null);

useSortable({
  container: listRef,
  order: () => props.pages.map((page) => page.id),
  onReorder: (ids) => emit('reorder', ids),
  handle: '.page-manager__handle',
  enabled: () => props.modelValue,
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) document.body.classList.add('modal-open');
  },
);
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="页面管理"
    description="集中管理导航页面：名称、图标、顺序与删除"
    :width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="page-manager">
      <div class="page-manager__head">
        <span class="page-manager__head-name">页面</span>
        <span class="page-manager__head-counts">分区 / 网站</span>
        <span class="page-manager__head-actions">操作</span>
      </div>

      <ul ref="listRef" class="page-manager__list">
        <li
          v-for="page in pages"
          :key="page.id"
          class="page-manager__row"
          :class="{ 'page-manager__row--active': page.id === activePageId }"
          :data-sortable-id="page.id"
        >
          <span class="page-manager__handle" title="拖动调整顺序">
            <SvgIcon name="menu" :size="15" />
          </span>
          <span class="page-manager__icon">
            <SvgIcon :name="page.icon" :size="16" />
          </span>
          <span class="page-manager__name ellipsis" :title="page.name">{{ page.name }}</span>
          <span class="page-manager__counts">
            <span class="badge">{{ sectionCounts[page.id] ?? 0 }}</span>
            <span class="badge badge--brand">{{ websiteCounts[page.id] ?? 0 }}</span>
          </span>
          <span class="page-manager__actions">
            <button
              v-if="page.id !== activePageId"
              type="button"
              class="btn btn--text btn--sm"
              @click="emit('select', page.id)"
            >
              切换
            </button>
            <span v-else class="page-manager__current">当前</span>
            <button
              type="button"
              class="icon-btn"
              title="编辑名称与图标"
              aria-label="编辑页面"
              @click="emit('edit-page', page)"
            >
              <SvgIcon name="pencil" :size="15" />
            </button>
            <button
              type="button"
              class="icon-btn icon-btn--danger"
              title="删除页面"
              aria-label="删除页面"
              @click="emit('remove-page', page)"
            >
              <SvgIcon name="trash" :size="15" />
            </button>
          </span>
        </li>
      </ul>

      <p v-if="pages.length === 0" class="page-manager__empty">还没有任何导航页面，请先新建一个。</p>
    </div>

    <template #footer>
      <span class="page-manager__hint">提示：页面顺序与右侧导航栏实时同步</span>
      <button type="button" class="btn btn--default" @click="emit('update:modelValue', false)">关闭</button>
      <button type="button" class="btn btn--primary" @click="emit('create-page')">
        <SvgIcon name="plus" :size="14" />
        新建页面
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.page-manager {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.page-manager__head,
.page-manager__row {
  display: grid;
  grid-template-columns: 24px 24px 1fr 76px 150px;
  align-items: center;
  gap: var(--space-2);
}

.page-manager__head {
  padding: 0 var(--space-2) var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.page-manager__head-counts {
  text-align: center;
}

.page-manager__head-actions {
  text-align: right;
}

.page-manager__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 52vh;
  overflow-y: auto;
}

.page-manager__row {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
}

.page-manager__row:hover {
  background: var(--bg-hover);
}

.page-manager__row--active {
  background: var(--bg-active);
}

.page-manager__handle {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  cursor: grab;
}

.page-manager__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.page-manager__name {
  font-size: var(--font-base);
  color: var(--text-primary);
}

.page-manager__counts {
  display: flex;
  gap: 4px;
  justify-content: center;
}

.page-manager__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.page-manager__current {
  font-size: var(--font-xs);
  color: var(--brand-600);
  padding: 0 var(--space-2);
}

.page-manager__empty {
  padding: var(--space-5);
  text-align: center;
  font-size: var(--font-sm);
  color: var(--text-tertiary);
}

.page-manager__hint {
  flex: 1;
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

@media (max-width: 620px) {
  .page-manager__head,
  .page-manager__row {
    grid-template-columns: 20px 20px 1fr 60px 120px;
  }
}
</style>
