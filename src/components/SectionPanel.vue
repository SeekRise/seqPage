<script setup lang="ts">
/**
 * 分区面板
 *
 * 一个分区 = 标题栏（图标 / 名称 / 网站数量 / 操作）+ 网站卡片网格。
 * 拖拽目标就是标题栏（为了能拖动整个分区的顺序），卡片网格内只排卡片，两者互不干扰。
 */
import { computed, ref } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { useSortable } from '@/composables/useSortable';
import type { Section, Website } from '@/types';

const props = defineProps<{
  section: Section;
  websites: Website[];
  /** 批量管理中已选中的网站 id */
  selectedIds: string[];
  batchMode: boolean;
}>();

const emit = defineEmits<{
  'toggle-collapse': [section: Section];
  'edit-section': [section: Section];
  remove: [section: Section];
  'add-website': [section: Section];
  'context-menu': [payload: { section: Section; event: MouseEvent }];
  'open-actions-menu': [payload: { section: Section; event: MouseEvent }];
  'select-all': [payload: { section: Section; selected: boolean }];
  reorder: [orderedIds: string[]];
}>();

const allSelected = computed(
  () =>
    props.websites.length > 0 &&
    props.websites.every((website) => props.selectedIds.includes(website.id)),
);

const websiteCount = computed(() => props.websites.length);

const gridRef = ref<HTMLElement | null>(null);

/**
 * 分区内网站排序。
 * 只在本分区内排序（group 未开启跨列表拖拽），跨分区移动通过右键菜单完成，
 * 这样在触屏和小屏设备上也有等价的替代操作。
 */
useSortable({
  container: gridRef,
  order: () => props.websites.map((website) => website.id),
  onReorder: (ids) => emit('reorder', ids),
  animation: 150,
});

function onHeaderContextMenu(event: MouseEvent): void {
  emit('context-menu', { section: props.section, event });
}
</script>

<template>
  <section
    class="section-panel"
    :data-sortable-id="section.id"
    :aria-label="`分区 ${section.name}`"
  >
    <header
      class="section-panel__header"
      :class="{ 'section-panel__header--collapsed': section.collapsed }"
      @contextmenu.prevent="onHeaderContextMenu"
    >
      <button
        type="button"
        class="icon-btn section-panel__collapse"
        :title="section.collapsed ? '展开分区' : '折叠分区'"
        :aria-expanded="!section.collapsed"
        @click="emit('toggle-collapse', section)"
      >
        <SvgIcon :name="section.collapsed ? 'chevronRight' : 'chevronDown'" :size="16" />
      </button>

      <span class="section-panel__icon" :style="{ background: `${section.color}1f`, color: section.color }">
        <SvgIcon :name="section.icon" :size="15" />
      </span>

      <h2 class="section-panel__name ellipsis" :title="section.name">{{ section.name }}</h2>
      <span class="badge">{{ websiteCount }}</span>

      <span class="section-panel__spacer" />

      <label v-if="batchMode && websites.length > 0" class="section-panel__select-all">
        <input
          type="checkbox"
          :checked="allSelected"
          :aria-label="`选择分区 ${section.name} 中的全部网站`"
          @change="emit('select-all', { section, selected: !allSelected })"
        />
        <span>全选</span>
      </label>

      <div class="section-panel__actions">
        <button
          type="button"
          class="icon-btn"
          title="编辑分区"
          aria-label="编辑分区"
          @click="emit('edit-section', section)"
        >
          <SvgIcon name="pencil" :size="15" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="添加网站到该分区"
          aria-label="添加网站"
          @click="emit('add-website', section)"
        >
          <SvgIcon name="plus" :size="16" />
        </button>
        <button
          type="button"
          class="icon-btn"
          title="更多操作"
          aria-label="分区更多操作"
          aria-haspopup="menu"
          @click="emit('open-actions-menu', { section, event: $event })"
        >
          <SvgIcon name="more" :size="16" />
        </button>
      </div>

      <span class="section-panel__drag" title="按住标题栏拖动可调整分区顺序">
        <SvgIcon name="menu" :size="15" />
      </span>
    </header>

    <div v-show="!section.collapsed" class="section-panel__body">
      <div v-if="websites.length > 0" ref="gridRef" class="section-panel__grid">
        <slot name="websites" />
      </div>

      <div v-else class="section-panel__empty">
        <SvgIcon name="link" :size="18" />
        <p class="section-panel__empty-text">该分区还没有网站</p>
        <button type="button" class="btn btn--default btn--sm" @click="emit('add-website', section)">
          <SvgIcon name="plus" :size="14" />
          添加网站
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-panel {
  background: var(--bg-panel-translucent);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

.section-panel__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-color);
  cursor: grab;
  user-select: none;
}

.section-panel__header--collapsed {
  border-bottom-color: transparent;
}

.section-panel__collapse {
  width: 24px;
  height: 24px;
}

.section-panel__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  flex: none;
}

.section-panel__name {
  font-size: var(--font-base);
  font-weight: 600;
  color: var(--text-primary);
  max-width: 40%;
}

.section-panel__spacer {
  flex: 1;
}

.section-panel__select-all {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.section-panel__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.section-panel__drag {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
  padding-left: 2px;
}

.section-panel__body {
  padding: var(--space-3);
}

.section-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--card-min-width), 1fr));
  gap: var(--space-2);
}

.section-panel__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5) var(--space-3);
  color: var(--text-tertiary);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
}

.section-panel__empty-text {
  font-size: var(--font-sm);
}

@media (hover: none) {
  .section-panel__header {
    cursor: default;
  }
}
</style>
