<script setup lang="ts">
/**
 * 全局提示宿主：渲染 useToast 的队列。
 * 固定右下角，最多同时显示 4 条；错误提示支持展开查看排查建议。
 */
import { toast, toastItems, type ToastItem } from '@/composables/useToast';
import SvgIcon from '@/components/SvgIcon.vue';

const ICONS: Record<ToastItem['type'], string> = {
  success: 'check',
  error: 'warning',
  warning: 'warning',
  info: 'info',
};
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="item in toastItems" :key="item.id" class="toast" :class="`toast--${item.type}`">
        <span class="toast__icon">
          <SvgIcon :name="ICONS[item.type]" :size="16" />
        </span>
        <div class="toast__content">
          <p class="toast__message">{{ item.message }}</p>
          <p v-if="item.detail" class="toast__detail">{{ item.detail }}</p>
        </div>
        <button
          type="button"
          class="toast__close"
          aria-label="关闭提示"
          title="关闭"
          @click="toast.dismiss(item.id)"
        >
          <SvgIcon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: var(--space-4);
  bottom: var(--space-4);
  z-index: 2100;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(380px, calc(100vw - 32px));
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--color-info);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  pointer-events: auto;
}

.toast--success {
  border-left-color: var(--color-success);
}

.toast--error {
  border-left-color: var(--color-danger);
}

.toast--warning {
  border-left-color: var(--color-warning);
}

.toast__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  color: var(--color-info);
}

.toast--success .toast__icon {
  color: var(--color-success);
}

.toast--error .toast__icon {
  color: var(--color-danger);
}

.toast--warning .toast__icon {
  color: var(--color-warning);
}

.toast__content {
  flex: 1;
  min-width: 0;
}

.toast__message {
  font-size: var(--font-base);
  color: var(--text-primary);
  word-break: break-word;
}

.toast__detail {
  margin-top: 2px;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  word-break: break-word;
}

.toast__close {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
}

.toast__close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--transition-fast), transform var(--transition-fast);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
