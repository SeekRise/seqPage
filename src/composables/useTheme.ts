/**
 * 主题与外观应用
 *
 * 把设置中的主题、密度、背景、圆角等落到 :root 的 data-* 属性与 CSS 变量上。
 * 组件只关心状态，DOM 侧的效果集中在这里，避免样式逻辑散落。
 */
import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import type { AppSettings, BackgroundConfig, ThemeMode } from '@/types';
import { DARK_BACKGROUND, DEFAULT_BACKGROUND, LIGHT_PAGE_COLOR } from '@/utils/constants';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 解析实际生效的主题（system → 跟随系统） */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * 判断用户自定义背景是否为「未修改的默认值」。
 * 与 DEFAULT_BACKGROUND / DARK_BACKGROUND 比较而非硬编码色值，
 * 避免改动默认配色后这里静默失配、导致「跟随系统」不再生效。
 */
function isDefaultBackground(bg: BackgroundConfig): boolean {
  if (bg.type !== 'solid') return false;
  const color = bg.color.toLowerCase();
  return color === DEFAULT_BACKGROUND.color.toLowerCase() || color === DARK_BACKGROUND.color.toLowerCase();
}

/**
 * 把背景配置落到 --bg-page / --bg-page-image 上。
 * applyAppearance 与拖动期的临时预览共用，保证两条路径的判定完全一致。
 */
function applyBackgroundVars(bg: BackgroundConfig, themeMode: ThemeMode, effective: 'light' | 'dark'): void {
  const root = document.documentElement;

  if (themeMode === 'system' && isDefaultBackground(bg)) {
    // 跟随系统时，默认背景随明暗切换，用户一旦自定义就尊重用户选择
    const fallback = effective === 'dark' ? DARK_BACKGROUND : null;
    root.style.setProperty('--bg-page', fallback ? fallback.color : LIGHT_PAGE_COLOR);
    root.style.setProperty('--bg-page-image', 'none');
    return;
  }

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
    root.style.setProperty('--bg-page', effective === 'dark' ? DARK_BACKGROUND.color : LIGHT_PAGE_COLOR);
    const safeImage = /^(https?:\/\/|data:image\/)/i.test(bg.imageUrl.trim()) ? bg.imageUrl.trim() : '';
    root.style.setProperty('--bg-page-image', safeImage ? `url("${safeImage}")` : 'none');
  }
}

/** 应用主题与外观到 <html> */
export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  const effective = resolveTheme(settings.theme);

  root.dataset.theme = effective;
  root.dataset.density = settings.cardDensity;
  root.dataset.motion = window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'reduced' : 'normal';

  applyBackgroundVars(settings.background, settings.theme, effective);
  root.style.setProperty('--panel-opacity', String(settings.background.panelOpacity));
  root.style.setProperty('--radius-card', `${settings.background.radius}px`);
}

/**
 * 取色 / 拖动滑块过程中的即时预览：只写 CSS 变量，**不落存储**。
 *
 * 用于「拖动底色、停止 250ms 后才写盘」的合并提交——否则每次 mousemove 都会
 * 触发一次「序列化整份配置 + 写 storage」。调用方必须在预览失效前落盘，
 * 否则界面会与存储不一致（SettingsPanel 在关闭面板与卸载时都会 flush）。
 */
export function previewBackground(settings: AppSettings, patch: Partial<BackgroundConfig>): void {
  const bg: BackgroundConfig = { ...settings.background, ...patch };
  applyBackgroundVars(bg, settings.theme, resolveTheme(settings.theme));
  document.documentElement.style.setProperty('--panel-opacity', String(bg.panelOpacity));
  document.documentElement.style.setProperty('--radius-card', `${bg.radius}px`);
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
