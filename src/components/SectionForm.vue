<script setup lang="ts">
/**
 * 新增 / 编辑分区表单
 *
 * 分区名称允许重复（产品上不强制唯一），但会给出提示，行为保持一致。
 */
import { computed, nextTick, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import IconPicker from '@/components/IconPicker.vue';
import { useToast } from '@/composables/useToast';
import type { Section } from '@/types';
import { FIELD_LIMITS, SECTION_COLORS } from '@/utils/constants';
import { validateSectionName } from '@/utils/validators';

const props = defineProps<{
  modelValue: boolean;
  section: Section | null;
  /** 当前页面已存在的同名分区（用于重复提示） */
  siblingNames: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [payload: { name: string; icon: string; color: string }];
}>();

const toast = useToast();

const form = ref({ name: '', icon: 'folder', color: SECTION_COLORS[0] });
const error = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

const isEditing = computed(() => props.section !== null);
const duplicate = computed(() => {
  const name = form.value.name.trim();
  if (!name) return false;
  const others = props.siblingNames.filter((item) => item !== props.section?.name);
  return others.includes(name);
});

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    error.value = '';
    form.value = {
      name: props.section?.name ?? '',
      icon: props.section?.icon ?? 'folder',
      color: props.section?.color ?? SECTION_COLORS[0],
    };
    await nextTick();
    nameInput.value?.focus();
  },
);

function submit(): void {
  const result = validateSectionName(form.value.name);
  if (!result.ok) {
    error.value = result.message;
    toast.error(result.message);
    return;
  }
  error.value = '';
  emit('submit', {
    name: form.value.name.trim(),
    icon: form.value.icon.trim() || 'folder',
    color: form.value.color,
  });
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="isEditing ? '编辑分区' : '新增分区'"
    description="分区用于把同一页面下的网站按用途归类"
    :width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="section-form" @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="section-name">
          分区名称<span class="field__required">*</span>
        </label>
        <input
          id="section-name"
          ref="nameInput"
          v-model="form.name"
          class="input"
          :class="{ 'input--error': error }"
          type="text"
          autocomplete="off"
          placeholder="例如：开发环境"
          :maxlength="FIELD_LIMITS.sectionName"
          @keydown.enter.prevent="submit"
        />
        <span v-if="error" class="field__error">{{ error }}</span>
        <span v-else-if="duplicate" class="field__hint field__hint--warning">
          当前页面已存在同名分区，保存后会出现两个同名分区（允许，但建议区分）。
        </span>
      </div>

      <div class="field">
        <span class="field__label">主题色</span>
        <div class="section-form__colors" role="radiogroup" aria-label="分区主题色">
          <button
            v-for="color in SECTION_COLORS"
            :key="color"
            type="button"
            role="radio"
            class="section-form__color"
            :class="{ 'section-form__color--active': form.color === color }"
            :style="{ background: color }"
            :aria-checked="form.color === color"
            :aria-label="color"
            :title="color"
            @click="form.color = color"
          />
        </div>
      </div>

      <IconPicker v-model="form.icon" label="分区图标" />
    </form>

    <template #footer>
      <button type="button" class="btn btn--default" @click="emit('update:modelValue', false)">取消</button>
      <button type="button" class="btn btn--primary" @click="submit">
        {{ isEditing ? '保存修改' : '创建分区' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.section-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-form__colors {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.section-form__color {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-pill);
  border: 2px solid transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.section-form__color--active {
  border-color: var(--text-primary);
}

.field__hint--warning {
  color: var(--color-warning);
}
</style>
