<script setup lang="ts">
/**
 * 批量管理工具条
 *
 * 仅在批量模式下显示，提供：
 * 全选/取消、批量移动分区、批量收藏/取消、批量设置打开方式、批量删除。
 * 所有危险操作都会先在父组件二次确认，且可随时「退出批量模式」取消尚未提交的操作。
 */
import { computed } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import type { Section } from '@/types';

const props = defineProps<{
  selectedCount: number;
  /** 当前页面的所有可选分区 */
  sections: Section[];
  /** 当前页面网站总数 */
  total: number;
  /** 已选中网站中是否全部为收藏状态 */
  allFavorite: boolean;
}>();

const emit = defineEmits<{
  'select-all': [selected: boolean];
  'move-to': [sectionId: string];
  favorite: [value: boolean];
  'open-mode': [newTab: boolean];
  remove: [];
  exit: [];
}>();

const allSelected = computed(() => props.total > 0 && props.selectedCount === props.total);
</script>

<template>
  <div class="batch-bar" role="toolbar" aria-label="批量管理工具条">
    <span class="batch-bar__count">
      已选中 <strong>{{ selectedCount }}</strong> / {{ total }}
    </span>

    <label class="batch-bar__check">
      <input
        type="checkbox"
        :checked="allSelected"
        :indeterminate.prop="selectedCount > 0 && !allSelected"
        @change="emit('select-all', !allSelected)"
      />
      <span>全选本页</span>
    </label>

    <span class="batch-bar__divider" />

    <label class="batch-bar__field">
      <span class="sr-only">移动到分区</span>
      <select
        class="select batch-bar__select"
        value=""
        :disabled="selectedCount === 0"
        aria-label="批量移动到分区"
        @change="(event) => emit('move-to', (event.target as HTMLSelectElement).value)"
      >
        <option value="">移动到分区…</option>
        <option v-for="section in sections" :key="section.id" :value="section.id">
          {{ section.name }}
        </option>
      </select>
    </label>

    <button
      type="button"
      class="btn btn--default btn--sm"
      :disabled="selectedCount === 0"
      @click="emit('favorite', !allFavorite)"
    >
      <SvgIcon name="star" :size="14" :filled="allFavorite" />
      {{ allFavorite ? '取消收藏' : '批量收藏' }}
    </button>

    <button
      type="button"
      class="btn btn--default btn--sm"
      :disabled="selectedCount === 0"
      @click="emit('open-mode', true)"
    >
      设为新标签页打开
    </button>

    <button
      type="button"
      class="btn btn--default btn--sm"
      :disabled="selectedCount === 0"
      @click="emit('open-mode', false)"
    >
      设为当前标签页打开
    </button>

    <span class="batch-bar__spacer" />

    <button
      type="button"
      class="btn btn--danger btn--sm"
      :disabled="selectedCount === 0"
      @click="emit('remove')"
    >
      <SvgIcon name="trash" :size="14" />
      批量删除
    </button>

    <button type="button" class="btn btn--text btn--sm" @click="emit('exit')">退出批量模式</button>
  </div>
</template>

<style scoped>
.batch-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-panel);
  border: 1px solid var(--brand-300);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.batch-bar__count {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.batch-bar__count strong {
  color: var(--brand-600);
}

.batch-bar__check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.batch-bar__divider {
  width: 1px;
  height: 20px;
  background: var(--border-color);
}

.batch-bar__select {
  width: auto;
  min-width: 140px;
  padding: 5px 8px;
  font-size: var(--font-sm);
}

.batch-bar__spacer {
  flex: 1;
}
</style>
