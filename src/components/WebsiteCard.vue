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
.website-card {
  position: relative;
  display: flex;
  align-items: center;
  min-height: var(--card-height);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast),
    background-color var(--transition-fast);
  overflow: hidden;
}

.website-card:hover {
  border-color: var(--brand-300);
  box-shadow: var(--shadow-sm);
}

.website-card:focus-within {
  border-color: var(--brand-400);
}

.website-card--selected {
  border-color: var(--brand-500);
  background: var(--brand-50);
}

.website-card--favorite .website-card__main::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-warning);
}

.website-card__main {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  text-align: left;
  background: transparent;
  color: inherit;
  border-radius: inherit;
}

/* 悬浮操作按钮：绝对定位（不占布局宽度），否则会挤压名称空间 */
.website-card:hover .website-card__main,
.website-card:focus-within .website-card__main {
  padding-right: 82px;
}

.website-card--batch .website-card__main {
  padding-right: var(--space-3);
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

.website-card__desc {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  line-height: 1.3;
}

.website-card__star {
  display: flex;
  align-items: center;
  color: var(--color-warning);
  flex: none;
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

/* 操作按钮浮在卡片右侧，不参与布局计算 */
.website-card__actions {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  transform: translateY(-50%);
  padding: 2px;
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
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

/* 触屏设备没有 hover，选择框需要常显并预留空间 */
@media (hover: none) {
  .website-card__actions {
    opacity: 1;
  }

  .website-card:not(.website-card--batch) .website-card__main {
    padding-right: 82px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .website-card,
  .website-card__actions {
    transition: none;
  }
}
</style>
