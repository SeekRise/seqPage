<script setup lang="ts">
/**
 * 通用弹窗
 *
 * 基于原生 <dialog> + showModal()：
 * - 浏览器原生提供焦点陷阱、Esc 关闭、背景 inert（点击遮罩区域不会误操作后台）。
 * - :modal 伪类出现时禁用默认边框与居中偏移，样式由 CSS 变量统一控制。
 * - Esc 关闭走同样的 close 事件，调用方无需额外处理（不会导致数据丢失，因为表单只在提交时写回）。
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    /** 副标题 / 说明 */
    description?: string;
    width?: number;
    /** 是否使用宽版布局 */
    wide?: boolean;
  }>(),
  {
    description: '',
    width: 520,
    wide: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  closed: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

function close(): void {
  emit('update:modelValue', false);
}

function onDialogClose(): void {
  document.body.classList.remove('modal-open');
  if (props.modelValue) emit('update:modelValue', false);
  emit('closed');
}

function onBackdropClick(event: MouseEvent): void {
  // 只有点击 dialog 自身（即遮罩区域）才关闭，避免点内容误关
  if (event.target === dialogRef.value) close();
}

watch(
  () => props.modelValue,
  (open) => {
    const dialog = dialogRef.value;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      document.body.classList.add('modal-open');
    } else if (!open && dialog.open) {
      dialog.close();
    }
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  document.body.classList.remove('modal-open');
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="modal"
    :style="{ '--modal-width': `${wide ? Math.max(width, 640) : width}px` }"
    @close="onDialogClose"
    @click="onBackdropClick"
    @cancel.prevent="close"
  >
    <div class="modal__panel">
      <header class="modal__header">
        <div class="modal__titles">
          <h2 class="modal__title">{{ title }}</h2>
          <p v-if="description" class="modal__description">{{ description }}</p>
        </div>
        <button type="button" class="icon-btn" title="关闭（Esc）" aria-label="关闭" @click="close">
          <SvgIcon name="close" :size="16" />
        </button>
      </header>

      <div class="modal__body">
        <slot />
      </div>

      <footer v-if="$slots.footer" class="modal__footer">
        <slot name="footer" />
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.modal {
  padding: 0;
  border: none;
  background: transparent;
  max-width: none;
  max-height: none;
  color: var(--text-primary);
}

.modal::backdrop {
  background: var(--bg-overlay);
}

.modal[open] {
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal__panel {
  width: min(var(--modal-width), calc(100vw - 32px));
  max-height: min(84vh, 900px);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-4) var(--space-3);
  border-bottom: 1px solid var(--border-color);
}

.modal__titles {
  min-width: 0;
}

.modal__title {
  font-size: var(--font-lg);
  font-weight: 600;
}

.modal__description {
  margin-top: 2px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.modal__body {
  padding: var(--space-4);
  overflow: auto;
  flex: 1;
}

.modal__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border-color);
  background: var(--bg-subtle);
}

@media (max-width: 560px) {
  .modal__panel {
    width: calc(100vw - 16px);
    max-height: 92vh;
  }
}
</style>
