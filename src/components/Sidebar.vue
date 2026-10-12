<script setup lang="ts">
/**
 * 侧边导航栏
 *
 * 展示所有导航页面，并提供新建、重命名（行内）、调整顺序（拖拽）、删除、页面管理等入口。
 * 位置可由用户在设置中切换左侧 / 右侧（任务书 4.2 的导航栏 + 第十节的可配置布局）。
 *
 * 契约：
 * - 当前页面有明确高亮，且不只依赖颜色（侧边色条 + 加粗 + aria-current）。
 * - 新建后立即切换到新页面（由 store 负责）。
 * - 行内重命名支持 Enter 保存、Esc 取消，取消不修改数据。
 * - 删除必须二次确认；最后一个页面不允许删除。
 * - 每项显示分区数与网站数。
 */
import { computed, ref, type ComponentPublicInstance } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { useSortable } from '@/composables/useSortable';
import type { NavigationPage, SidebarPosition } from '@/types';

const props = defineProps<{
  pages: NavigationPage[];
  activePageId: string;
  sectionCounts: Record<string, number>;
  websiteCounts: Record<string, number>;
  /** 侧边栏是否处于收起状态 */
  collapsed: boolean;
  /** 侧边栏位于左侧还是右侧：影响分隔线方向与折叠箭头的指向 */
  position: SidebarPosition;
}>();

const emit = defineEmits<{
  select: [pageId: string];
  'create-page': [];
  rename: [payload: { page: NavigationPage; name: string }];
  'edit-page': [page: NavigationPage];
  'remove-page': [page: NavigationPage];
  'manage-pages': [];
  'open-settings': [];
  'toggle-collapse': [];
  'context-menu': [payload: { page: NavigationPage; event: MouseEvent }];
  'open-actions-menu': [payload: { page: NavigationPage; event: MouseEvent }];
  reorder: [orderedIds: string[]];
}>();

const editingId = ref('');
const draftName = ref('');
const listRef = ref<HTMLElement | null>(null);

/** 行内重命名的输入框（用回调 ref 获取，避免 v-for 中出现 ref 数组） */
let editInputEl: HTMLInputElement | null = null;

function setEditInput(el: Element | ComponentPublicInstance | null): void {
  editInputEl = el instanceof HTMLInputElement ? el : null;
  if (editInputEl) {
    editInputEl.focus();
    editInputEl.select();
  }
}

const order = computed(() => props.pages.map((page) => page.id));

/** 页面排序：拖拽 .sidebar__item，回写顺序交给父组件持久化 */
useSortable({
  container: listRef,
  draggable: '.sidebar__item',
  handle: '.sidebar__link',
  order: () => order.value,
  onReorder: (ids) => emit('reorder', ids),
});

function startRename(page: NavigationPage): void {
  editingId.value = page.id;
  draftName.value = page.name;
}

function commitRename(): void {
  const page = props.pages.find((item) => item.id === editingId.value);
  const name = draftName.value.trim();
  editingId.value = '';
  if (!page || !name || name === page.name) return;
  emit('rename', { page, name });
}

function cancelRename(): void {
  editingId.value = '';
  draftName.value = '';
}

function onContextMenu(page: NavigationPage, event: MouseEvent): void {
  emit('context-menu', { page, event });
}
</script>

<template>
  <aside
    class="sidebar"
    :class="[`sidebar--${position}`, { 'sidebar--collapsed': collapsed }]"
    aria-label="导航页面列表"
  >
    <div class="sidebar__top">
      <button
        v-if="!collapsed"
        type="button"
        class="sidebar__brand"
        title="My Navi 导航工作台"
        @click="emit('toggle-collapse')"
      >
        <span class="sidebar__logo">
          <SvgIcon name="grid" :size="16" filled />
        </span>
        <span class="sidebar__brand-text">
          <strong>My Navi</strong>
          <small>本地导航工作台</small>
        </span>
      </button>
      <button
        v-else
        type="button"
        class="icon-btn sidebar__expand"
        title="展开导航栏"
        aria-label="展开导航栏"
        @click="emit('toggle-collapse')"
      >
        <SvgIcon name="expand" :size="16" />
      </button>

      <button
        v-if="!collapsed"
        type="button"
        class="icon-btn"
        :title="`收起导航栏（可在设置中把导航栏移到${position === 'right' ? '左' : '右'}侧）`"
        aria-label="收起导航栏"
        @click="emit('toggle-collapse')"
      >
        <SvgIcon :name="position === 'right' ? 'chevronRight' : 'chevronLeft'" :size="16" />
      </button>
    </div>

    <nav class="sidebar__list" ref="listRef">
      <p v-if="!collapsed" class="sidebar__group-title">导航页面</p>

      <div
        v-for="page in pages"
        :key="page.id"
        class="sidebar__item"
        :class="{ 'sidebar__item--active': page.id === activePageId }"
        :data-sortable-id="page.id"
      >
        <input
          v-if="editingId === page.id"
          :ref="setEditInput"
          v-model="draftName"
          class="input sidebar__rename"
          type="text"
          :aria-label="`重命名页面 ${page.name}`"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />

        <button
          v-else
          type="button"
          class="sidebar__link"
          :class="{ 'sidebar__link--active': page.id === activePageId }"
          :aria-current="page.id === activePageId ? 'page' : undefined"
          :title="collapsed ? page.name : `${page.name}（${sectionCounts[page.id] ?? 0} 个分区 / ${websiteCounts[page.id] ?? 0} 个网站）`"
          @click="emit('select', page.id)"
          @dblclick="startRename(page)"
          @contextmenu.prevent="onContextMenu(page, $event)"
        >
          <span class="sidebar__page-icon">
            <SvgIcon :name="page.icon" :size="16" />
          </span>
          <span v-if="!collapsed" class="sidebar__page-name ellipsis">{{ page.name }}</span>
          <span v-if="!collapsed" class="sidebar__counts">
            <span class="badge" :title="`${sectionCounts[page.id] ?? 0} 个分区`">
              {{ sectionCounts[page.id] ?? 0 }}
            </span>
            <span class="badge badge--brand" :title="`${websiteCounts[page.id] ?? 0} 个网站`">
              {{ websiteCounts[page.id] ?? 0 }}
            </span>
          </span>
        </button>

        <button
          v-if="!collapsed && editingId !== page.id"
          type="button"
          class="icon-btn sidebar__more"
          title="页面操作"
          :aria-label="`${page.name} 的操作菜单`"
          aria-haspopup="menu"
          @click="emit('open-actions-menu', { page, event: $event })"
        >
          <SvgIcon name="more" :size="15" />
        </button>
      </div>

      <button type="button" class="sidebar__add" @click="emit('create-page')">
        <SvgIcon name="plus" :size="15" />
        <span v-if="!collapsed">新建导航页面</span>
      </button>
    </nav>

    <div class="sidebar__bottom">
      <button type="button" class="sidebar__tool" @click="emit('manage-pages')">
        <SvgIcon name="layers" :size="16" />
        <span v-if="!collapsed">页面管理</span>
      </button>
      <button type="button" class="sidebar__tool" @click="emit('open-settings')">
        <SvgIcon name="settings" :size="16" />
        <span v-if="!collapsed">设置</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  flex: none;
  height: 100%;
  background: var(--bg-app-bar);
  backdrop-filter: blur(8px);
}

/* 位于右侧时，分隔线画在自己的左边；位于左侧时画在右边 */
.sidebar--right {
  border-left: 1px solid var(--border-color);
}

.sidebar--left {
  border-right: 1px solid var(--border-color);
}

.sidebar--collapsed {
  width: 56px;
}

.sidebar__top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-color);
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  text-align: left;
}

.sidebar__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--brand-600);
  color: #fff;
  flex: none;
}

.sidebar__brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar__brand-text strong {
  font-size: var(--font-base);
  color: var(--text-primary);
}

.sidebar__brand-text small {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.sidebar__expand {
  margin: 0 auto;
}

.sidebar__list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar__group-title {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.sidebar__item {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--radius-md);
  position: relative;
}

.sidebar__item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--brand-600);
}

.sidebar__link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  padding: var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  text-align: left;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.sidebar--collapsed .sidebar__link {
  justify-content: center;
}

.sidebar__link:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.sidebar__link--active {
  background: var(--bg-active);
  color: var(--brand-700);
  font-weight: 600;
}

[data-theme='dark'] .sidebar__link--active {
  color: var(--brand-500);
}

.sidebar__page-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex: none;
}

.sidebar__page-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-base);
}

.sidebar__counts {
  display: flex;
  gap: 4px;
  flex: none;
}

.sidebar__more {
  width: 24px;
  height: 24px;
  opacity: 0;
}

.sidebar__item:hover .sidebar__more,
.sidebar__item:focus-within .sidebar__more {
  opacity: 1;
}

.sidebar__rename {
  margin: var(--space-1) 0;
}

.sidebar__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.sidebar__add:hover {
  border-color: var(--brand-400);
  color: var(--brand-600);
  background: var(--bg-hover);
}

.sidebar__bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2);
  border-top: 1px solid var(--border-color);
}

.sidebar__tool {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-base);
}

.sidebar--collapsed .sidebar__tool {
  justify-content: center;
}

.sidebar__tool:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/**
 * 窄屏（笔记本、分屏）下侧边栏收成图标条；
 * 更窄时（< 760px）由 App 的布局改为把侧边栏放到工具栏下方独占一行。
 */
@media (max-width: 900px) {
  .sidebar {
    width: 60px;
  }

  .sidebar__page-name,
  .sidebar__counts,
  .sidebar__brand-text {
    display: none;
  }
}

@media (max-width: 760px) {
  .sidebar,
  .sidebar--collapsed {
    width: auto;
    height: auto;
    max-height: 42vh;
    overflow-y: auto;
  }

  /* 竖向堆叠时改为上下分隔线 */
  .sidebar--right,
  .sidebar--left {
    border-left: none;
    border-right: none;
    border-top: 1px solid var(--border-color);
  }

  .sidebar__list {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .sidebar__page-name,
  .sidebar__counts {
    display: inline;
  }
}

@media (hover: none) {
  .sidebar__more {
    opacity: 1;
  }
}
</style>
