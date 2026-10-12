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
import { CREATION_LIMITS } from '@/utils/constants';

const props = defineProps<{
  section: Section;
  websites: Website[];
  /** 批量管理中已选中的网站 id */
  selectedIds: string[];
  batchMode: boolean;
}>();

const emit = defineEmits<{
  'toggle-collapse': [section: Section];
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

/** 达到每区上限后不再放行新增：按钮禁用并把原因写进 title，而不是点了才弹错 */
const addDisabled = computed(() => websiteCount.value >= CREATION_LIMITS.maxWebsitesPerSection);

const addLabel = computed(() =>
  addDisabled.value
    ? `分区「${props.section.name}」已有 ${websiteCount.value} 个网站，达到每区上限 ${CREATION_LIMITS.maxWebsitesPerSection} 个`
    : `添加网站到分区 ${props.section.name}`,
);

const gridRef = ref<HTMLElement | null>(null);

/**
 * 分区内网站排序。
 * 只在本分区内排序（group 未开启跨列表拖拽），跨分区移动通过右键菜单完成，
 * 这样在触屏和小屏设备上也有等价的替代操作。
 */
useSortable({
  container: gridRef,
  draggable: '.website-card',
  // 手柄限定为专用元素：否则从条目任意位置按下都会开始拖拽，
  // 与「点击打开网站」的交互互相抢事件
  handle: '.website-card__grip',
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
      <!--
        拖拽手柄必须是独立的元素：它是本分区唯一的拖拽起点。
        以前整个 header 都是手柄，按住「编辑」「更多」等按钮时也会触发拖拽，
        导致点击被吞掉。
      -->
      <span class="section-panel__grip" title="按住拖动可调整分区顺序" aria-hidden="true">
        <SvgIcon name="menu" :size="14" />
      </span>

      <button
        type="button"
        class="icon-btn section-panel__collapse"
        :title="`${section.collapsed ? '展开' : '折叠'}分区 ${section.name}`"
        :aria-label="`${section.collapsed ? '展开' : '折叠'}分区 ${section.name}`"
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

      <!--
        标题栏只保留折叠与「更多操作」：编辑、排序、删除等低频管理动作
        统一收在更多菜单里（App.vue 的 sectionMenuItems），避免标题栏挂一排按钮。
      -->
      <div class="section-panel__actions">
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
    </header>

    <div v-show="!section.collapsed" class="section-panel__body">
      <div v-if="websites.length > 0" ref="gridRef" class="section-panel__grid">
        <slot name="websites" />
      </div>

      <p v-else class="section-panel__empty-text">该分区还没有网站</p>

      <!-- 常驻的底部添加入口：仅图标（文字收进 title / aria-label） -->
      <button
        type="button"
        class="section-panel__add"
        :disabled="addDisabled"
        :aria-label="addLabel"
        :title="addLabel"
        @click="emit('add-website', section)"
      >
        <SvgIcon name="plus" :size="16" />
      </button>
    </div>
  </section>
</template>

<style scoped>
/*
 * 分区卡片：白底、细边框、柔和圆角、极轻阴影。
 * 高度完全由内容决定（网格容器上是 align-items: start），
 * 所以这里不设任何高度约束。
 *
 * 背景走 color-mix + --panel-opacity，让设置里的「面板不透明度」
 * 真正生效（该变量此前被写入却无人消费）。下限在 parseSettings 里
 * 被限制为 0.4，因此卡片始终保有可读的底色。
 */
.section-panel {
  background: color-mix(in srgb, var(--bg-panel) calc(var(--panel-opacity, 1) * 100%), transparent);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}

/* 标题栏固定高度：悬停时出现的按钮不会把标题顶得上下位移 */
.section-panel__header {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: var(--section-header-height);
  padding: 0 var(--space-2) 0 var(--space-3);
  border-bottom: 1px solid var(--border-color);
  /* header 本身不再是拖拽区，grab 光标只出现在手柄上 */
  user-select: none;
}

.section-panel__header--collapsed {
  border-bottom-color: transparent;
}

/* 唯一的拖拽起点，光标只在这里提示可拖拽 */
.section-panel__grip {
  display: flex;
  align-items: center;
  flex: none;
  color: var(--text-tertiary);
  cursor: grab;
}

.section-panel__grip:active {
  cursor: grabbing;
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

.section-panel__body {
  padding: var(--space-2) var(--space-3) var(--space-3);
}

/*
 * 网站改为纵向列表（类名保留：它是拖拽容器，测试脚本也依赖它）。
 * 间距用 1px 的负外边距方案更复杂，这里直接用 column + gap：
 * 每行是独立条目，无需网格。
 */
.section-panel__grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-panel__empty-text {
  padding: var(--space-3) var(--space-2);
  font-size: var(--font-sm);
  color: var(--text-tertiary);
  text-align: center;
}

/* 底部常驻的添加入口：低调的整行图标按钮 */
.section-panel__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  width: 100%;
  margin-top: var(--space-1);
  padding: var(--space-1);
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.section-panel__add:hover {
  background: var(--bg-hover);
  color: var(--brand-600);
}

/* 达到每区上限：保留位置（按钮不消失，用户才知道入口还在、只是满了） */
.section-panel__add:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.section-panel__add:disabled:hover {
  background: transparent;
  color: var(--text-tertiary);
}

@media (hover: none) {
  /* 触屏没有悬停，拖拽手柄保持可见即可（光标形状无意义） */
  .section-panel__grip {
    cursor: default;
  }
}
</style>
