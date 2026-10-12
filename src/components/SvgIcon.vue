<script setup lang="ts">
/**
 * 统一图标组件
 *
 * 支持三种输入：
 * 1. 内置图标名（见 utils/icons.ts），渲染本地 SVG 路径；
 * 2. emoji 或单字符，直接作为文本渲染（用户可自定义页面图标）；
 * 3. 未识别的内容 → 回退到 grid 图标，永远不会渲染空白。
 *
 * 全程不加载任何远程资源，符合 MV3 CSP 与离线要求。
 */
import { computed } from 'vue';
import { ICON_PATHS } from '@/utils/icons';

const props = withDefaults(
  defineProps<{
    /** 图标名或 emoji */
    name: string;
    /** 像素尺寸 */
    size?: number;
    /** 线宽（仅对内置图标生效） */
    strokeWidth?: number;
    /** 是否使用填充模式（部分图标更适合填充） */
    filled?: boolean;
  }>(),
  {
    size: 16,
    strokeWidth: 1.6,
    filled: false,
  },
);

const isBuiltin = computed(() => Object.prototype.hasOwnProperty.call(ICON_PATHS, props.name));
const path = computed(() => ICON_PATHS[props.name] ?? ICON_PATHS.grid);
const text = computed(() => props.name.trim() || '');
</script>

<template>
  <svg
    v-if="isBuiltin"
    class="svg-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    :stroke="filled ? 'none' : 'currentColor'"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="path" />
  </svg>
  <span
    v-else
    class="svg-icon svg-icon--text"
    :style="{ fontSize: `${Math.round(size * 0.86)}px` }"
    aria-hidden="true"
  >
    {{ text.length > 3 ? '📄' : text }}
  </span>
</template>

<style scoped>
.svg-icon {
  display: block;
  flex: none;
}

.svg-icon--text {
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
}
</style>
