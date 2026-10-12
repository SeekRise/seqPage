/**
 * 组件统一出口
 *
 * 说明：入口（main.ts / App.vue）直接引用具体文件，避免循环依赖；
 * 这里只导出可复用的展示型组件，便于业务组件按需引入。
 */
export { default as SvgIcon } from '@/components/SvgIcon.vue';
export { default as IconPicker } from '@/components/IconPicker.vue';
export { default as AppModal } from '@/components/AppModal.vue';
export { default as ConfirmDialog } from '@/components/ConfirmDialog.vue';
export { default as ContextMenu } from '@/components/ContextMenu.vue';
export { default as ToastHost } from '@/components/ToastHost.vue';
