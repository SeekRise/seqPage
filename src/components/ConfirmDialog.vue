<script setup lang="ts">
/**
 * 二次确认对话框
 *
 * 默认焦点落在「取消」按钮：危险操作时按 Enter 不会直接执行破坏性动作。
 * 支持第三个选项（例如删除分区时的"把网站移动到其他分区"）。
 */
import { nextTick, ref, watch } from 'vue';
import { confirmState, resolveConfirm } from '@/composables/useConfirm';
import SvgIcon from '@/components/SvgIcon.vue';

const dialogRef = ref<HTMLDialogElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

watch(
  () => confirmState.value.open,
  async (open) => {
    const dialog = dialogRef.value;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      document.body.classList.add('modal-open');
      await nextTick();
      cancelButton.value?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      document.body.classList.remove('modal-open');
    }
  },
  { flush: 'post' },
);

function choose(choice: 'confirm' | 'cancel' | 'extra'): void {
  resolveConfirm(choice);
}

function onClose(): void {
  document.body.classList.remove('modal-open');
}
</script>

<template>
  <dialog
    ref="dialogRef"
    class="confirm"
    aria-labelledby="confirm-title"
    @cancel.prevent="choose('cancel')"
    @close="onClose"
  >
    <div class="confirm__panel">
      <header class="confirm__header">
        <span class="confirm__icon" :class="{ 'confirm__icon--danger': confirmState.danger }">
          <SvgIcon :name="confirmState.danger ? 'warning' : 'info'" :size="18" />
        </span>
        <h2 id="confirm-title" class="confirm__title">{{ confirmState.title }}</h2>
      </header>

      <div class="confirm__body">
        <p class="confirm__message">{{ confirmState.message }}</p>
        <p v-if="confirmState.detail" class="confirm__detail">{{ confirmState.detail }}</p>
      </div>

      <footer class="confirm__footer">
        <button
          v-if="confirmState.extraAction"
          type="button"
          class="btn btn--default confirm__extra"
          @click="choose('extra')"
        >
          {{ confirmState.extraAction.label }}
        </button>
        <span class="confirm__spacer" />
        <button ref="cancelButton" type="button" class="btn btn--default" @click="choose('cancel')">
          {{ confirmState.cancelText ?? '取消' }}
        </button>
        <button
          type="button"
          class="btn"
          :class="confirmState.danger ? 'btn--danger' : 'btn--primary'"
          @click="choose('confirm')"
        >
          {{ confirmState.confirmText ?? '确定' }}
        </button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.confirm {
  padding: 0;
  border: none;
  background: transparent;
  max-width: none;
  max-height: none;
  color: var(--text-primary);
}

.confirm::backdrop {
  background: var(--bg-overlay);
}

.confirm[open] {
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm__panel {
  width: min(460px, calc(100vw - 32px));
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.confirm__header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-4) var(--space-2);
}

.confirm__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--color-info-bg);
  color: var(--color-info);
  flex: none;
}

.confirm__icon--danger {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.confirm__title {
  font-size: var(--font-lg);
  font-weight: 600;
}

.confirm__body {
  padding: 0 var(--space-4) var(--space-4);
}

.confirm__message {
  font-size: var(--font-base);
  color: var(--text-primary);
  word-break: break-word;
}

.confirm__detail {
  margin-top: var(--space-2);
  font-size: var(--font-sm);
  color: var(--text-secondary);
  word-break: break-word;
}

.confirm__footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-subtle);
  border-top: 1px solid var(--border-color);
}

.confirm__spacer {
  flex: 1;
}

@media (max-width: 520px) {
  .confirm__footer {
    flex-wrap: wrap;
  }
}
</style>
