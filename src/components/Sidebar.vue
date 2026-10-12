<script setup lang="ts">
/**
 * 侧边导航栏
 *
 * 展示所有导航页面，并提供行内重命名、拖拽排序，以及每项的「页面操作」菜单
 * （新建 / 重命名 / 上下移 / 删除）。
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
  /** 侧边栏位于左侧还是右侧：影响分隔线画在哪一侧 */
  position: SidebarPosition;
}>();

const emit = defineEmits<{
  select: [pageId: string];
  rename: [payload: { page: NavigationPage; name: string }];
  'edit-page': [page: NavigationPage];
  'remove-page': [page: NavigationPage];
  'open-settings': [];
  'context-menu': [payload: { page: NavigationPage; event: MouseEvent }];
  'open-actions-menu': [payload: { page: NavigationPage; event: MouseEvent }];
  reorder: [orderedIds: string[]];
}>();

const editingId = ref('');
const draftName = ref('');
const listRef = ref<HTMLElement | null>(null);

/**
 * 品牌标识。写成字符串常量而不是模板里的字面量 src：
 * Vite 会把模板中的相对路径当资源引用去组件目录里找文件（这里并不存在），
 * 而 public/icons 是原样拷贝进 dist 的，只能按「相对当前页面」的 URL 引用。
 */
const brandIconUrl = './icons/icon128.png';

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
  <aside id="app-sidebar" class="sidebar" :class="`sidebar--${position}`" aria-label="导航页面列表">
    <!-- 品牌行：顶栏已移除，固定 56px（原与顶栏对齐的高度不再有意义） -->
    <div class="sidebar__top">
      <!-- 直接用扩展图标本身（public/icons 下的静态资源），保证与浏览器工具栏一致 -->
      <img class="sidebar__logo" :src="brandIconUrl" alt="" aria-hidden="true" />
      <span class="sidebar__brand-text">
        <strong>SeqPage</strong>
        <small>本地导航工作台</small>
      </span>
    </div>

    <nav class="sidebar__list" ref="listRef">
      <p class="sidebar__group-title">导航页面</p>

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
          :title="`${page.name}（${sectionCounts[page.id] ?? 0} 个分区 / ${websiteCounts[page.id] ?? 0} 个网站）`"
          @click="emit('select', page.id)"
          @dblclick="startRename(page)"
          @contextmenu.prevent="onContextMenu(page, $event)"
        >
          <span class="sidebar__page-icon">
            <SvgIcon :name="page.icon" :size="16" />
          </span>
          <span class="sidebar__page-name ellipsis">{{ page.name }}</span>
          <!-- 只显示网站数量：分区数对切换页面没有帮助，两个徽章只会让侧栏变吵 -->
          <span
            v-if="websiteCounts[page.id]"
            class="sidebar__count"
            :title="`${websiteCounts[page.id]} 个网站`"
          >
            {{ websiteCounts[page.id] }}
          </span>
        </button>

        <button
          v-if="editingId !== page.id"
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

      <!--
        页面级操作（新建 / 重命名 / 上下移 / 删除）统一收敛到每项右侧的
        「页面操作」菜单里，侧栏不再额外重复一个「新建导航页面」按钮。
      -->
    </nav>

    <div class="sidebar__bottom">
      <button type="button" class="sidebar__tool" @click="emit('open-settings')">
        <SvgIcon name="settings" :size="16" />
        <span>设置</span>
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
  /* 纯色白底，不做玻璃拟态 */
  background: var(--bg-app-bar);
}

/* 位于右侧时，分隔线画在自己的左边；位于左侧时画在右边 */
.sidebar--right {
  border-left: 1px solid var(--border-color);
}

.sidebar--left {
  border-right: 1px solid var(--border-color);
}

/* 品牌行：固定高度，自动隐藏悬浮时作为侧栏顶部 */
.sidebar__top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 56px;
  flex: none;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border-color);
}

/* 品牌标识直接用扩展图标；细边框避免白底图标在浅色侧栏上「浮」着没有边界 */
.sidebar__logo {
  display: block;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  object-fit: cover;
  flex: none;
}

.sidebar__brand-text {
  display: flex;
  flex-direction: column;
  flex: 1;
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

/* 网站数量：极轻的次级文字，不做成徽章，避免侧栏出现一片彩色小块 */
.sidebar__count {
  flex: none;
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
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

.sidebar__tool:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/**
 * 窄屏（笔记本、分屏）下侧边栏自动收成图标条；
 * 更窄时（< 760px）由 App 的布局改为把侧边栏放到工具栏下方独占一行。
 * 这里是纯响应式行为，与用户的显示/隐藏开关无关。
 */
@media (max-width: 900px) {
  .sidebar {
    width: 60px;
  }

  .sidebar__page-name,
  .sidebar__count,
  .sidebar__brand-text {
    display: none;
  }
}

@media (max-width: 760px) {
  .sidebar {
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
  .sidebar__count {
    display: inline;
  }
}

@media (hover: none) {
  .sidebar__more {
    opacity: 1;
  }
}
</style>
