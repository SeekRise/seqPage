<script setup lang="ts">
/**
 * 网站卡片
 *
 * 交互约定（对应任务书 6.5 / 6.6）：
 * - 整卡是一个按钮：单击打开、Enter / Space 打开，具备完整键盘可达性。
 * - 卡片内的操作按钮全部 @click.stop，不会触发打开。
 * - 右键打开快捷菜单（可用设置关闭）。
 * - 图标按候选列表逐级降级，最终回退到本地首字母，永不出现空白或破图。
 * - 名称单行省略，title 属性提供完整信息。
 */
import { computed } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { useFavicon } from '@/composables/useFavicon';
import type { Website } from '@/types';
import { getDisplayHost } from '@/utils/url';

const props = withDefaults(
  defineProps<{
    website: Website;
    /** 批量管理模式 */
    batchMode?: boolean;
    selected?: boolean;
    /** 设置：是否显示描述 */
    showDescription?: boolean;
    /** 设置：是否允许远程 favicon */
    remoteFavicon?: boolean;
  }>(),
  {
    batchMode: false,
    selected: false,
    showDescription: true,
    remoteFavicon: true,
  },
);

const emit = defineEmits<{
  open: [website: Website];
  edit: [website: Website];
  remove: [website: Website];
  favorite: [website: Website];
  move: [website: Website];
  'context-menu': [payload: { website: Website; event: MouseEvent }];
  'toggle-select': [website: Website];
}>();

const { currentSrc, onError, onLoad, initials, fallbackColor, showFallback } = useFavicon(
  () => props.website,
  () => ({ remoteFavicon: props.remoteFavicon, size: 32 }),
);

const host = computed(() => getDisplayHost(props.website.url));
const tooltip = computed(() =>
  [props.website.name, props.website.description, props.website.url].filter(Boolean).join('\n'),
);

function onActivate(): void {
  if (props.batchMode) {
    emit('toggle-select', props.website);
    return;
  }
  emit('open', props.website);
}

function onContextMenu(event: MouseEvent): void {
  emit('context-menu', { website: props.website, event });
}

function onKeydown(event: KeyboardEvent): void {
  // 卡片内其它控件（按钮/复选框）自行处理键盘事件
  if (event.target !== event.currentTarget) return;
  if (event.key === ' ') {
    event.preventDefault();
    onActivate();
  }
}
</script>

<template>
  <div
    class="website-card"
    :class="{
      'website-card--selected': selected,
      'website-card--batch': batchMode,
      'website-card--favorite': website.favorite,
    }"
    :data-sortable-id="website.id"
  >
    <!--
      拖拽手柄是 __main 的兄弟节点而非子节点：
      嵌在 <button> 里既不是合法结构，点击也会被「打开网站」吞掉。
    -->
    <span class="website-card__grip" aria-hidden="true">
      <SvgIcon name="menu" :size="13" />
    </span>

    <button
      type="button"
      class="website-card__main"
      :title="tooltip"
      :aria-label="`打开 ${website.name}`"
      @click="onActivate"
      @keydown="onKeydown"
      @contextmenu.prevent="onContextMenu"
    >
      <span class="website-card__icon" :style="showFallback ? { background: fallbackColor } : undefined">
        <img
          v-if="!showFallback && currentSrc"
          :src="currentSrc"
          :alt="''"
          width="20"
          height="20"
          loading="lazy"
          referrerpolicy="no-referrer"
          @load="onLoad"
          @error="onError"
        />
        <span v-else class="website-card__initials">{{ initials }}</span>
      </span>

      <span class="website-card__text">
        <span class="website-card__name ellipsis">{{ website.name }}</span>
        <span v-if="showDescription && website.description" class="website-card__desc ellipsis">
          {{ website.description }}
        </span>
        <span v-else-if="!showDescription" class="website-card__desc ellipsis">{{ host }}</span>
      </span>

      <span v-if="website.favorite && !batchMode" class="website-card__star" title="已收藏">
        <SvgIcon name="star" :size="13" filled />
      </span>
    </button>

    <span v-if="batchMode" class="website-card__check">
      <input
        type="checkbox"
        :checked="selected"
        :aria-label="`选择 ${website.name}`"
        @click.stop="emit('toggle-select', website)"
      />
    </span>

    <span v-else class="website-card__actions">
      <button
        type="button"
        class="icon-btn website-card__action"
        :class="{ 'icon-btn--active': website.favorite }"
        :title="website.favorite ? '取消收藏' : '收藏'"
        :aria-label="website.favorite ? '取消收藏' : '收藏'"
        @click.stop="emit('favorite', website)"
      >
        <SvgIcon name="star" :size="14" :filled="website.favorite" />
      </button>
      <button
        type="button"
        class="icon-btn website-card__action"
        title="编辑"
        aria-label="编辑网站"
        @click.stop="emit('edit', website)"
      >
        <SvgIcon name="pencil" :size="14" />
      </button>
      <button
        type="button"
        class="icon-btn website-card__action icon-btn--danger"
        title="删除"
        aria-label="删除网站"
        @click.stop="emit('remove', website)"
      >
        <SvgIcon name="trash" :size="14" />
      </button>
    </span>
  </div>
</template>

<style scoped>
/*
 * 分区内的网站条目：紧凑的纵向列表行。
 * 这里是「行」而不是「卡片」——没有独立边框与圆角，
 * 只靠悬停底色区分，避免在一个卡片里再堆一层卡片边框。
 */
.website-card {
  position: relative;
  display: flex;
  align-items: center;
  min-height: var(--row-min-height);
  border-radius: var(--radius-sm);
  transition: background-color var(--transition-fast);
}

.website-card:hover {
  background: var(--bg-hover);
}

.website-card--selected {
  background: var(--brand-50);
}

/* 收藏用左侧细色条标记，而不是再加一圈边框（颜色之外还有形状线索） */
.website-card--favorite .website-card__main::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 55%;
  width: 2px;
  border-radius: var(--radius-pill);
  background: var(--color-warning);
  opacity: 0.75;
}

/* 拖拽手柄：常显但很轻，悬停时变明显（否则拖拽入口难以发现） */
.website-card__grip {
  display: flex;
  align-items: center;
  flex: none;
  padding-left: var(--space-1);
  color: var(--text-tertiary);
  opacity: 0.35;
  cursor: grab;
  transition: opacity var(--transition-fast);
}

.website-card:hover .website-card__grip,
.website-card:focus-within .website-card__grip {
  opacity: 0.8;
}

.website-card__grip:active {
  cursor: grabbing;
}

.website-card__main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 1;
  min-width: 0;
  /* 纵向内边距由卡片密度设置决定，行高因此随密度变化 */
  padding: var(--row-padding) var(--space-2);
  text-align: left;
  background: transparent;
  color: inherit;
  border-radius: inherit;
}

/*
 * 悬浮操作按钮绝对定位（不占布局宽度），所以要在悬停时给右侧留出空间，
 * 否则会被压在名称上。预留宽度 = 3 个 24px 按钮 + 间距。
 */
.website-card:hover .website-card__main,
.website-card:focus-within .website-card__main {
  padding-right: 84px;
}

.website-card--batch .website-card__main {
  padding-right: var(--space-2);
}

.website-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  overflow: hidden;
  flex: none;
}

.website-card__icon img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.website-card__initials {
  font-size: var(--font-sm);
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.02em;
}

.website-card__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.website-card__name {
  font-size: var(--font-base);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.35;
}

/* 描述/域名用次级文字色，与名称（主文字色）拉开层级但不抢视线 */
.website-card__desc {
  font-size: var(--font-xs);
  color: var(--text-secondary);
  line-height: 1.3;
}

/* 收藏标记：默认克制，悬停该条目时才完全凸显 */
.website-card__star {
  display: flex;
  align-items: center;
  color: var(--color-warning);
  flex: none;
  opacity: 0.7;
  transition: opacity var(--transition-fast);
}

.website-card:hover .website-card__star,
.website-card:focus-within .website-card__star {
  opacity: 1;
}

.website-card__actions,
.website-card__check {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

/*
 * 操作按钮浮在条目右侧，不参与布局计算。
 * 不再垫一层不透明底色：悬停时整行已经是 --bg-hover，
 * 垫白底会露出一个突兀的方块；名称下方已由 padding-right 预留出空间。
 */
.website-card__actions {
  position: absolute;
  top: 50%;
  right: var(--space-1);
  transform: translateY(-50%);
  padding: 2px;
  border-radius: var(--radius-sm);
}

.website-card__check {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  transform: translateY(-50%);
  padding: 0 4px;
}

.website-card:hover .website-card__actions,
.website-card:focus-within .website-card__actions,
.website-card--batch .website-card__check {
  opacity: 1;
}

.website-card__action {
  width: 24px;
  height: 24px;
}

/* 触屏设备没有 hover，操作入口需要常显并预留空间 */
@media (hover: none) {
  .website-card__actions {
    opacity: 1;
  }

  .website-card:not(.website-card--batch) .website-card__main {
    padding-right: 84px;
  }

  .website-card__grip {
    opacity: 0.8;
    cursor: default;
  }
}

@media (prefers-reduced-motion: reduce) {
  .website-card,
  .website-card__actions,
  .website-card__grip {
    transition: none;
  }
}
</style>
