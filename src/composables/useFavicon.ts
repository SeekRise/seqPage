/**
 * 图标加载状态管理
 *
 * 按候选列表顺序尝试加载，任意一个成功即停止；全部失败则回退到本地首字母图标。
 * 组件只需绑定 src / onError 即可，不用关心中间逻辑。
 */
import { computed, ref, watch } from 'vue';
import { buildFaviconCandidates } from '@/services/favicon';
import type { Website } from '@/types';
import { getColorFromString, getInitials } from '@/utils/url';

export interface UseFaviconOptions {
  remoteFavicon: boolean;
  size?: number;
}

export function useFavicon(
  website: () => Pick<Website, 'name' | 'url' | 'icon' | 'iconType'>,
  options: () => UseFaviconOptions,
) {
  const candidates = ref<string[]>([]);
  const currentIndex = ref(0);
  const failed = ref(false);

  function rebuild(): void {
    const target = website();
    candidates.value = buildFaviconCandidates(target, {
      remoteFavicon: options().remoteFavicon,
      size: options().size ?? 32,
    });
    currentIndex.value = 0;
    failed.value = false;
  }

  // 相关字段变化时重建候选列表
  watch(
    () => {
      const target = website();
      return [target.url, target.icon, target.iconType, options().remoteFavicon].join('|');
    },
    rebuild,
    { immediate: true },
  );

  const currentSrc = computed<string>(() => {
    if (failed.value) return '';
    return candidates.value[currentIndex.value] ?? '';
  });

  /** 加载失败 → 尝试下一个候选；全部失败则标记 failed，由组件渲染首字母兜底 */
  function onError(): void {
    if (currentIndex.value < candidates.value.length - 1) {
      currentIndex.value += 1;
      return;
    }
    failed.value = true;
  }

  /**
   * 加载完成校验。
   * 有些站点返回 1x1 或极小的占位图片，虽然"加载成功"但视觉上是空白方块，
   * 这里按尺寸判定为无效并继续降级，避免卡片出现空白图标。
   */
  function onLoad(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) return;
    const tooSmall = image.naturalWidth > 0 && (image.naturalWidth < 12 || image.naturalHeight < 12);
    if (tooSmall) onError();
  }

  const initials = computed(() => getInitials(website().name));
  const fallbackColor = computed(() => getColorFromString(website().url || website().name));
  /** 是否展示首字母兜底 */
  const showFallback = computed(() => failed.value || !currentSrc.value);

  return { currentSrc, onError, onLoad, initials, fallbackColor, showFallback, retry: rebuild };
}
