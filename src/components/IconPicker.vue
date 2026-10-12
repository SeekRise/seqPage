<script setup lang="ts">
/**
 * 图标选择器
 *
 * 支持两类输入：
 * - 内置图标名（本地 SVG）
 * - emoji / 单字符（用户可自由输入）
 * 自定义输入会立即校验：允许内置名或 1~3 个字符，避免写入超长文本。
 */
import { computed, ref } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { SELECTABLE_EMOJI, SELECTABLE_ICONS, isBuiltinIcon } from '@/utils/icons';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
  }>(),
  { label: '图标' },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const customValue = ref('');
const customError = ref('');

const current = computed(() => props.modelValue.trim() || 'grid');

function pick(value: string): void {
  customError.value = '';
  emit('update:modelValue', value);
}

function applyCustom(): void {
  const value = customValue.value.trim();
  if (!value) {
    customError.value = '请输入图标名或 emoji。';
    return;
  }
  if (!isBuiltinIcon(value) && [...value].length > 3) {
    customError.value = '只支持内置图标名，或 1~3 个字符的 emoji。';
    return;
  }
  customError.value = '';
  emit('update:modelValue', value);
}
</script>

<template>
  <div class="icon-picker field">
    <span class="field__label">{{ label }}</span>

    <div class="icon-picker__current">
      <span class="icon-picker__preview">
        <SvgIcon :name="current" :size="18" />
      </span>
      <code class="icon-picker__value">{{ current }}</code>
      <span class="field__hint">当前图标</span>
    </div>

    <div class="icon-picker__grid" role="radiogroup" :aria-label="`${label}选择`">
      <button
        v-for="icon in SELECTABLE_ICONS"
        :key="icon"
        type="button"
        role="radio"
        class="icon-picker__option"
        :class="{ 'icon-picker__option--active': current === icon }"
        :aria-checked="current === icon"
        :title="icon"
        :aria-label="icon"
        @click="pick(icon)"
      >
        <SvgIcon :name="icon" :size="16" />
      </button>
    </div>

    <div class="icon-picker__grid icon-picker__grid--emoji" role="radiogroup" :aria-label="`${label} emoji 选择`">
      <button
        v-for="emoji in SELECTABLE_EMOJI"
        :key="emoji"
        type="button"
        role="radio"
        class="icon-picker__option icon-picker__option--emoji"
        :class="{ 'icon-picker__option--active': current === emoji }"
        :aria-checked="current === emoji"
        :title="emoji"
        :aria-label="emoji"
        @click="pick(emoji)"
      >
        {{ emoji }}
      </button>
    </div>

    <div class="icon-picker__custom">
      <input
        v-model="customValue"
        class="input"
        type="text"
        maxlength="4"
        placeholder="自定义：图标名或 emoji"
        :aria-label="`自定义${label}`"
        @keydown.enter.prevent="applyCustom"
      />
      <button type="button" class="btn btn--default btn--sm" @click="applyCustom">应用</button>
    </div>
    <span v-if="customError" class="field__error">{{ customError }}</span>
  </div>
</template>

<style scoped>
.icon-picker {
  gap: var(--space-2);
}

.icon-picker__current {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
}

.icon-picker__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--brand-600);
}

.icon-picker__value {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.icon-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
  gap: 4px;
  max-height: 116px;
  overflow-y: auto;
  padding: 2px;
}

.icon-picker__grid--emoji {
  max-height: 76px;
}

.icon-picker__option {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--bg-subtle);
  transition: background-color var(--transition-fast), color var(--transition-fast),
    border-color var(--transition-fast);
}

.icon-picker__option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.icon-picker__option--active {
  border-color: var(--brand-500);
  background: var(--brand-50);
  color: var(--brand-600);
}

.icon-picker__option--emoji {
  font-size: 15px;
  line-height: 1;
}

.icon-picker__custom {
  display: flex;
  gap: var(--space-2);
}
</style>
