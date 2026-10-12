<script setup lang="ts">
/**
 * 新增 / 编辑网站表单
 *
 * 校验规则集中在 utils/validators，组件只负责收集输入与展示字段级错误。
 * 提交前统一做去空格 + 协议补全 + 危险协议拒绝；取消不会修改任何数据。
 */
import { computed, nextTick, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { IconPicker } from '@/components';
import { useCurrentPage } from '@/composables/useCurrentPage';
import { useToast } from '@/composables/useToast';
import type { IconType, Section, Website } from '@/types';
import { FIELD_LIMITS } from '@/utils/constants';
import { hasErrors, validateIconUrl, validateWebsiteForm, type WebsiteFormErrors } from '@/utils/validators';
import { getDisplayHost, normalizeUrl } from '@/utils/url';

const props = defineProps<{
  modelValue: boolean;
  /** 为空表示新增 */
  website: Website | null;
  /** 目标页面（新增时使用） */
  pageId: string;
  /** 当前页面下的分区（用于选择所属分区） */
  sections: Section[];
  /** 默认选中的分区 */
  defaultSectionId: string;
  /** 站点默认打开方式 */
  defaultOpenInNewTab: boolean;
  /** 预填数据（例如"快捷添加当前网页"） */
  prefill?: { name: string; url: string } | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  submit: [
    payload: {
      sectionId: string;
      data: {
        name: string;
        url: string;
        description: string;
        icon: string;
        iconType: IconType;
        openInNewTab: boolean;
      };
    },
  ];
}>();

const toast = useToast();
const { readCurrentPage, loading: readingPage } = useCurrentPage();

const form = ref({
  name: '',
  url: '',
  description: '',
  icon: '',
  iconType: 'auto' as IconType,
  sectionId: '',
  openInNewTab: true,
});
const errors = ref<WebsiteFormErrors>({});
const showIconPicker = ref(false);
const nameInput = ref<HTMLInputElement | null>(null);

const isEditing = computed(() => props.website !== null);
const title = computed(() => (isEditing.value ? '编辑网站' : '新增网站'));

const iconTypeOptions: Array<{ value: IconType; label: string; hint: string }> = [
  { value: 'auto', label: '自动获取', hint: '优先使用浏览器图标缓存，失败时回退到站点图标' },
  { value: 'url', label: '自定义地址', hint: '填写你自己的图标图片地址' },
  { value: 'text', label: '首字母', hint: '不发起任何网络请求，完全离线' },
];

/** 打开弹窗时重置表单 */
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      showIconPicker.value = false;
      return;
    }
    errors.value = {};
    showIconPicker.value = false;
    const target = props.website;
    form.value = {
      name: target?.name ?? props.prefill?.name ?? '',
      url: target?.url ?? props.prefill?.url ?? '',
      description: target?.description ?? '',
      icon: target?.icon ?? '',
      iconType: target?.iconType ?? 'auto',
      sectionId: target?.sectionId ?? props.defaultSectionId ?? props.sections[0]?.id ?? '',
      openInNewTab: target?.openInNewTab ?? props.defaultOpenInNewTab,
    };
    await nextTick();
    nameInput.value?.focus();
  },
);

/** URL 失焦时：补全协议并尝试自动填充名称 */
function onUrlBlur(): void {
  const raw = form.value.url.trim();
  if (!raw) return;
  const normalized = normalizeUrl(raw);
  if (normalized.ok) {
    form.value.url = normalized.url;
    if (!form.value.name.trim()) {
      form.value.name = getDisplayHost(normalized.url) || normalized.url;
    }
  }
}

async function useCurrentPageInfo(): Promise<void> {
  const result = await readCurrentPage();
  if (!result.ok || !result.page) {
    toast.warning('无法读取当前网页', result.message);
    return;
  }
  form.value.url = result.page.url;
  if (!form.value.name.trim()) form.value.name = result.page.title;
  toast.success('已填入当前网页信息');
}

function onIconSelected(value: string): void {
  form.value.icon = value;
  form.value.iconType = value && value !== 'auto' ? 'url' : 'auto';
}

function submit(): void {
  const next: WebsiteFormErrors = validateWebsiteForm({
    name: form.value.name,
    url: form.value.url,
    description: form.value.description,
    icon: form.value.iconType === 'url' ? form.value.icon : '',
    iconType: form.value.iconType,
    sectionId: form.value.sectionId,
    openInNewTab: form.value.openInNewTab,
  });
  errors.value = next;
  if (hasErrors(next)) {
    toast.error('请先修正表单中的错误再保存。');
    return;
  }

  const normalized = normalizeUrl(form.value.url);
  emit('submit', {
    sectionId: form.value.sectionId,
    data: {
      name: form.value.name.trim(),
      url: normalized.ok ? normalized.url : form.value.url.trim(),
      description: form.value.description.trim(),
      icon: form.value.iconType === 'url' ? form.value.icon.trim() : form.value.icon.trim(),
      iconType: form.value.iconType,
      openInNewTab: form.value.openInNewTab,
    },
  });
}

function close(): void {
  emit('update:modelValue', false);
}

/** 图标输入的手动校验提示 */
const iconError = computed(() => {
  if (form.value.iconType !== 'url') return '';
  const result = validateIconUrl(form.value.icon);
  return result.ok ? '' : result.message;
});
</script>

<template>
  <AppModal
    :model-value="modelValue"
    :title="title"
    :description="isEditing ? '修改后立即生效，不会产生重复记录' : '填写网站信息并选择所属分区'"
    :width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="website-form" @submit.prevent="submit">
      <div class="field">
        <label class="field__label" for="website-url">
          网站地址<span class="field__required">*</span>
        </label>
        <div class="website-form__row">
          <input
            id="website-url"
            v-model="form.url"
            class="input"
            :class="{ 'input--error': errors.url }"
            type="text"
            inputmode="url"
            autocomplete="off"
            placeholder="github.com 或 https://github.com"
            :maxlength="FIELD_LIMITS.websiteUrl"
            @blur="onUrlBlur"
          />
          <button
            type="button"
            class="btn btn--default btn--sm"
            :disabled="readingPage"
            title="读取当前标签页地址（仅在你点击时读取一次）"
            @click="useCurrentPageInfo"
          >
            <SvgIcon name="download" :size="14" />
            {{ readingPage ? '读取中…' : '当前网页' }}
          </button>
        </div>
        <span v-if="errors.url" class="field__error">{{ errors.url }}</span>
        <span v-else class="field__hint">不填写协议时自动补全 https://；仅支持 http/https。</span>
      </div>

      <div class="field">
        <label class="field__label" for="website-name">
          网站名称<span class="field__required">*</span>
        </label>
        <input
          id="website-name"
          ref="nameInput"
          v-model="form.name"
          class="input"
          :class="{ 'input--error': errors.name }"
          type="text"
          autocomplete="off"
          placeholder="例如：GitHub"
          :maxlength="FIELD_LIMITS.websiteName"
        />
        <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
      </div>

      <div class="field">
        <label class="field__label" for="website-desc">网站描述</label>
        <textarea
          id="website-desc"
          v-model="form.description"
          class="textarea"
          :class="{ 'textarea--error': errors.description }"
          rows="2"
          placeholder="选填，建议 30 字以内"
          :maxlength="FIELD_LIMITS.websiteDescription"
        />
        <span v-if="errors.description" class="field__error">{{ errors.description }}</span>
      </div>

      <div class="field">
        <label class="field__label" for="website-section">所属分区</label>
        <select id="website-section" v-model="form.sectionId" class="select">
          <option v-for="section in sections" :key="section.id" :value="section.id">
            {{ section.name }}
          </option>
        </select>
        <span v-if="errors.sectionId" class="field__error">{{ errors.sectionId }}</span>
      </div>

      <div class="field">
        <span class="field__label">图标</span>
        <div class="website-form__icon-modes">
          <label v-for="option in iconTypeOptions" :key="option.value" class="website-form__radio">
            <input v-model="form.iconType" type="radio" :value="option.value" name="iconType" />
            <span>{{ option.label }}</span>
          </label>
        </div>
        <p class="field__hint">
          {{ iconTypeOptions.find((item) => item.value === form.iconType)?.hint }}
        </p>

        <div v-if="form.iconType === 'url'" class="field">
          <input
            v-model="form.icon"
            class="input"
            :class="{ 'input--error': iconError }"
            type="text"
            placeholder="https://example.com/logo.png"
            :maxlength="FIELD_LIMITS.iconUrl"
          />
          <span v-if="iconError" class="field__error">{{ iconError }}</span>
        </div>

        <div v-if="form.iconType === 'text'" class="field">
          <button type="button" class="btn btn--default btn--sm" @click="showIconPicker = !showIconPicker">
            <SvgIcon name="star" :size="14" />
            {{ showIconPicker ? '收起图标选择' : '选择首字母样式图标' }}
          </button>
        </div>

        <IconPicker
          v-if="showIconPicker"
          :model-value="form.icon"
          label="自定义图标"
          @update:model-value="onIconSelected"
        />
      </div>

      <label class="website-form__checkbox">
        <input v-model="form.openInNewTab" type="checkbox" />
        <span>在新标签页中打开</span>
      </label>
    </form>

    <template #footer>
      <button type="button" class="btn btn--default" @click="close">取消</button>
      <button type="button" class="btn btn--primary" @click="submit">
        {{ isEditing ? '保存修改' : '添加网站' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.website-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.website-form__row {
  display: flex;
  gap: var(--space-2);
}

.website-form__row .input {
  flex: 1;
}

.website-form__icon-modes {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.website-form__radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.website-form__checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-base);
  color: var(--text-primary);
  cursor: pointer;
}
</style>
