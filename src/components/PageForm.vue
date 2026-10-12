<script setup lang="ts">
/**
 * 页面表单（新增 / 重命名 / 修改图标）
 *
 * 与侧边栏的行内重命名并存：行内重命名用于快速改名，
 * 该弹窗用于需要同时调整图标与名称的场景，也供页面管理界面复用。
 */
import { computed, nextTick, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import IconPicker from '@/components/IconPicker.vue';
import { useToast } from '@/composables/useToast';
import type { NavigationPage } from '@/types';
import { FIELD_LIMITS } from '@/utils/constants';
import { validatePageName } from '@/utils/validators';

const props = defineProps<{
  modelValue: boolean;
  page: NavigationPage | null;
  /** 其它页面名称，用于重复提示 */
  siblingNames: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [payload: { name: string; icon: string }];
}>();

const toast = useToast();
const form = ref({ name: '', icon: 'grid' });
const error = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

const isEditing = computed(() => props.page !== null);
const duplicate = computed(() => {
  const name = form.value.name.trim();
  if (!name) return false;
  return props.siblingNames.filter((item) => item !== props.page?.name).includes(name);
});

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    error.value = '';
    form.value = { name: props.page?.name ?? '', icon: props.page?.icon ?? 'briefcase' };
    await nextTick();
    nameInput.value?.focus();
  },
);

function submit(): void {
  const result = validatePageName(form.value.name);
  if (!result.ok) {
    error.value = result.message;
    toast.error(result.message);
    return;
  }
  error.value = '';
  emit('submit', { name: form.value.name.trim(), icon: form.value.icon.trim() || 'grid' });
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="isEditing ? '编辑导航页面' : '新建导航页面'"
    description="导航页面是右侧栏中的独立工作空间，页面之间的数据完全隔离"
    :width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="page-form" @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="page-name">
          页面名称<span class="field__required">*</span>
        </label>
        <input
          id="page-name"
          ref="nameInput"
          v-model="form.name"
          class="input"
          :class="{ 'input--error': error }"
          type="text"
          autocomplete="off"
          placeholder="例如：开发工具"
          :maxlength="FIELD_LIMITS.pageName"
          @keydown.enter.prevent="submit"
        />
        <span v-if="error" class="field__error">{{ error }}</span>
        <span v-else-if="duplicate" class="field__hint field__hint--warning">
          已存在同名页面，保存后会同时出现两个同名页面（允许，但建议区分）。
        </span>
      </div>

      <IconPicker v-model="form.icon" label="页面图标" />
    </form>

    <template #footer>
      <button type="button" class="btn btn--default" @click="emit('update:modelValue', false)">取消</button>
      <button type="button" class="btn btn--primary" @click="submit">
        {{ isEditing ? '保存修改' : '创建页面' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.page-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field__hint--warning {
  color: var(--color-warning);
}
</style>
