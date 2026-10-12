/**
 * Naive UI 主题桥接
 *
 * 应用自身的主题仍由 useTheme.ts 落到 <html> 的 data-theme 与 CSS 变量上（保持不变）；
 * 这里只负责让 Naive UI 组件跟随同一份设置：
 * - 浅色 → 不传主题（用 Naive 默认浅色），深色 → darkTheme；
 * - themeOverrides 把品牌色、圆角、字体对齐到 variables.css / base.css 的取值；
 * - system 模式下监听系统明暗变化实时切换（matchMedia 本身不是响应式数据，
 *   用 systemDark ref 补上这个依赖）。
 */
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { darkTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import { resolveTheme } from '@/composables/useTheme';
import type { AppSettings } from '@/types';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 与 base.css 的 body 字体、variables.css 的圆角保持一致 */
const sharedOverrides = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif",
  borderRadius: '10px',
  borderRadiusSmall: '6px',
  fontWeightStrong: '600',
};

/** 浅色品牌色（--brand-400/500/600） */
const lightOverrides: GlobalThemeOverrides = {
  common: {
    ...sharedOverrides,
    primaryColor: '#3b6fe0',
    primaryColorHover: '#6f93ec',
    primaryColorPressed: '#2f5cc4',
    primaryColorSuppl: '#6f93ec',
  },
};

/** 深色品牌色（--brand-500/600/700，深底上 hover/pressed 逐级提亮） */
const darkOverrides: GlobalThemeOverrides = {
  common: {
    ...sharedOverrides,
    primaryColor: '#6f9bf0',
    primaryColorHover: '#8bb0f5',
    primaryColorPressed: '#a8c4f8',
    primaryColorSuppl: '#8bb0f5',
  },
};

/** 绑定设置，返回 NConfigProvider 需要的 theme / theme-overrides */
export function useNaiveTheme(settings: Ref<AppSettings>) {
  const systemDark = ref(resolveTheme('system') === 'dark');
  let darkQuery: MediaQueryList | null = null;

  const onSystemChange = (event: MediaQueryListEvent): void => {
    systemDark.value = event.matches;
  };

  onMounted(() => {
    if (!window.matchMedia) return;
    darkQuery = window.matchMedia(DARK_QUERY);
    darkQuery.addEventListener('change', onSystemChange);
  });

  onBeforeUnmount(() => {
    darkQuery?.removeEventListener('change', onSystemChange);
  });

  const isDark = computed(() => {
    if (settings.value.theme !== 'system') return settings.value.theme === 'dark';
    return systemDark.value;
  });

  const naiveTheme = computed(() => (isDark.value ? darkTheme : null));
  const naiveOverrides = computed(() => (isDark.value ? darkOverrides : lightOverrides));

  return { naiveTheme, naiveOverrides };
}
