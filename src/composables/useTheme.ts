/**
 * 主题与外观应用
 *
 * 把设置中的主题、密度、背景、圆角等落到 :root 的 data-* 属性与 CSS 变量上。
 * 组件只关心状态，DOM 侧的效果集中在这里，避免样式逻辑散落。
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import type { AppSettings, ThemeMode } from '@/types';
import { DARK_BACKGROUND } from '@/utils/constants';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 解析实际生效的主题（system → 跟随系统） */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** 判断用户自定义背景是否为「未修改的默认值」 */
function isDefaultBackground(settings: AppSettings): boolean {
  const bg = settings.background;
  const isLightDefault = bg.type === 'solid' && bg.color.toLowerCase() === '#eef2f8';
  const isDarkDefault = bg.type === 'solid' && bg.color.toLowerCase() === '#161a22';
  return isLightDefault || isDarkDefault;
}

/** 应用主题与外观到 <html> */
export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  const effective = resolveTheme(settings.theme);

  root.dataset.theme = effective;
  root.dataset.density = settings.cardDensity;
  root.dataset.motion = window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'reduced' : 'normal';

  const bg = settings.background;

  if (settings.theme === 'system' && isDefaultBackground(settings)) {
    // 跟随系统时，默认背景随明暗切换，用户一旦自定义就尊重用户选择
    const fallback = effective === 'dark' ? DARK_BACKGROUND : null;
    root.style.setProperty('--bg-page', fallback ? fallback.color : '#eef2f8');
    root.style.setProperty('--bg-page-image', 'none');
  } else {
    if (bg.type === 'solid') {
      root.style.setProperty('--bg-page', bg.color);
      root.style.setProperty('--bg-page-image', 'none');
    } else if (bg.type === 'gradient') {
      root.style.setProperty('--bg-page', bg.gradientFrom);
      root.style.setProperty(
        '--bg-page-image',
        `linear-gradient(160deg, ${bg.gradientFrom} 0%, ${bg.gradientTo} 100%)`,
      );
    } else {
      root.style.setProperty('--bg-page', effective === 'dark' ? '#161a22' : '#eef2f8');
      const safeImage = /^(https?:\/\/|data:image\/)/i.test(bg.imageUrl.trim()) ? bg.imageUrl.trim() : '';
      root.style.setProperty('--bg-page-image', safeImage ? `url("${safeImage}")` : 'none');
    }
  }

  root.style.setProperty('--panel-opacity', String(bg.panelOpacity));
  root.style.setProperty('--radius-card', `${bg.radius}px`);
}

/**
 * 在组件中绑定设置：设置变化时自动应用，同时监听系统主题与动效偏好变化。
 */
export function useAppearance(settings: Ref<AppSettings>) {
  let darkQuery: MediaQueryList | null = null;
  let motionQuery: MediaQueryList | null = null;

  const onSystemChange = (): void => applyAppearance(settings.value);

  onMounted(() => {
    applyAppearance(settings.value);
    if (window.matchMedia) {
      darkQuery = window.matchMedia(DARK_QUERY);
      motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
      darkQuery.addEventListener('change', onSystemChange);
      motionQuery.addEventListener('change', onSystemChange);
    }
  });

  watch(settings, (value) => applyAppearance(value), { deep: true });

  onBeforeUnmount(() => {
    darkQuery?.removeEventListener('change', onSystemChange);
    motionQuery?.removeEventListener('change', onSystemChange);
  });

  return { applyAppearance };
}
