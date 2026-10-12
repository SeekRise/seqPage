/**
 * 二次确认对话框（Promise 风格）
 *
 * 危险操作统一走这里，保证：
 * - 默认聚焦在「取消」按钮上，避免误按 Enter 造成破坏。
 * - Esc 关闭 = 取消，不修改任何数据。
 * - 支持「第三个选项」（例如删除分区时的"把网站移动到其他分区"）。
 */
import { readonly, ref } from 'vue';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** 补充说明，例如"该操作不可撤销" */
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  /** 是否使用危险样式（红色确认按钮） */
  danger?: boolean;
  /** 额外的中间选项，例如"将网站移动到其他分区" */
  extraAction?: {
    id: string;
    label: string;
    description?: string;
    danger?: boolean;
  };
}

export type ConfirmChoice = 'confirm' | 'cancel' | 'extra';

export interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

const state = ref<ConfirmState>({
  open: false,
  title: '',
  message: '',
});

let resolver: ((choice: ConfirmChoice) => void) | null = null;

/** 打开确认框并等待用户选择 */
export function confirmAction(options: ConfirmOptions): Promise<ConfirmChoice> {
  // 若已有未决的确认框，先按取消处理，避免 Promise 悬挂
  if (resolver) {
    resolver('cancel');
    resolver = null;
  }

  state.value = { ...options, open: true };

  return new Promise<ConfirmChoice>((resolve) => {
    resolver = resolve;
  });
}

/** 由 ConfirmDialog 组件调用 */
export function resolveConfirm(choice: ConfirmChoice): void {
  state.value = { ...state.value, open: false };
  const current = resolver;
  resolver = null;
  current?.(choice);
}

export const confirmState = readonly(state);

/** 组合式用法 */
export function useConfirm() {
  return { confirmAction, state: confirmState, resolve: resolveConfirm };
}
