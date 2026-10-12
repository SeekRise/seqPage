<script setup lang="ts">
/**
 * 设置面板（Naive UI 版）
 *
 * 结构：NModal（preset card）+ 顶部横向 NTabs 四分组 + 每行「说明在左、控件在右」。
 * 对外契约与旧版完全一致：所有设置变更通过 emit('change', Partial<AppSettings>) 上抛，
 * 危险操作只上抛事件，二次确认由父组件（App.vue）负责。
 *
 * 关键交互控件带 data-testid（setting-{组}-{值}），测试脚本依赖它定位，
 * 不依赖 Naive UI 的内部 class —— 那不是公开 API。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NColorPicker,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSlider,
  NStatistic,
  NSwitch,
  NTabPane,
  NTabs,
} from 'naive-ui';
import SvgIcon from '@/components/SvgIcon.vue';
import { previewBackground } from '@/composables/useTheme';
import type { AppSettings, BackgroundConfig, CardDensity, SidebarPosition, ThemeMode } from '@/types';
import { SEARCH_ENGINES } from '@/utils/constants';
import { dataUrlByteSize, fileToBackgroundDataUrl, isUploadedBackground } from '@/utils/image';

const props = defineProps<{
  modelValue: boolean;
  settings: AppSettings;
  /** 统计信息 */
  stats: { pages: number; sections: number; websites: number };
  /** 存储占用（字节），null 表示未知 */
  usage: { bytes: number; quotaBytes: number } | null;
  /** 存储后端名称，便于排查 */
  backend: string;
  /** 是否运行在扩展环境 */
  extensionContext: boolean;
  /** 数据完整性修复报告文案，null 表示无异常 */
  integrityMessage: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [patch: Partial<AppSettings>];
  export: [];
  'pick-import': [];
  'restore-defaults': [];
  'clear-data': [];
  'clear-search-history': [];
}>();

/** NModal 的受控 prop 是 show，经 computed 双向代理转发到 modelValue */
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

type TabId = 'appearance' | 'behavior' | 'background' | 'data';

const activeTab = ref<TabId>('appearance');
/** 背景图片地址的本地编辑态：@change（失焦/回车）才提交，避免每敲一个字符就写存储 */
const bgImageUrl = ref(props.settings.background.imageUrl);
const bgFileInput = ref<HTMLInputElement | null>(null);
const bgUploading = ref(false);
const bgUploadError = ref('');

/**
 * 取色与拖滑块的合并提交延迟：拖动期间只做 CSS 预览，停手后才落盘。
 * 250ms 足够覆盖一次拖动中的连续 mousemove，又短到用户察觉不出延迟。
 */
const BACKGROUND_COMMIT_DELAY = 250;

const themeOptions: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
];

const sidebarPositionOptions: Array<{ value: SidebarPosition; label: string; icon: string }> = [
  { value: 'left', label: '左侧', icon: 'chevronLeft' },
  { value: 'right', label: '右侧', icon: 'chevronRight' },
];

const densityOptions: Array<{ value: CardDensity; label: string; hint: string }> = [
  { value: 'compact', label: '紧凑', hint: '信息密度最高，适合网站很多的情况' },
  { value: 'comfortable', label: '标准', hint: '默认密度，兼顾可读性与效率' },
  { value: 'loose', label: '宽松', hint: '卡片更大，触屏操作更友好' },
];

const openModeOptions = [
  { value: 'newTab' as const, label: '新标签页' },
  { value: 'currentTab' as const, label: '当前标签页' },
];

const bgTypeOptions = [
  { value: 'solid' as const, label: '纯色' },
  { value: 'gradient' as const, label: '渐变' },
  { value: 'image' as const, label: '图片' },
];

const engineOptions = SEARCH_ENGINES.map((engine) => ({ label: engine.name, value: engine.id }));

/** 当前密度的说明文案（显示在分段按钮下方） */
const densityHint = computed(
  () => densityOptions.find((option) => option.value === props.settings.cardDensity)?.hint ?? '',
);

const usageText = computed(() => {
  if (!props.usage) return '无法统计';
  const used = (props.usage.bytes / 1024).toFixed(1);
  const total = (props.usage.quotaBytes / 1024 / 1024).toFixed(0);
  return `${used} KB / 约 ${total} MB`;
});

/** 已上传图片的体量提示；远程地址则只说明来源 */
const bgImageSourceText = computed(() => {
  const bg = props.settings.background;
  if (!bg.imageUrl) return '';
  if (isUploadedBackground(bg)) {
    const kb = Math.max(1, Math.round(dataUrlByteSize(bg.imageUrl) / 1024));
    return `已上传本地图片，约 ${kb} KB`;
  }
  return '当前使用远程图片地址';
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      activeTab.value = 'appearance';
      // data URL 有几千个字符，塞进输入框既难看又拖慢渲染：上传的图只显示预览
      bgImageUrl.value = isUploadedBackground(props.settings.background)
        ? ''
        : props.settings.background.imageUrl;
      bgUploadError.value = '';
    } else {
      // 关闭面板即落盘，避免「拖完就关」丢掉最后一次预览
      flushBackground();
    }
  },
);

onBeforeUnmount(flushBackground);

function patchSettings(patch: Partial<AppSettings>): void {
  emit('change', patch);
}

function patchBackground(patch: Partial<AppSettings['background']>): void {
  emit('change', { background: { ...props.settings.background, ...patch } });
}

/* ---------------- 背景的「即时预览 + 合并落盘」 ---------------- */

let commitTimer: number | null = null;
let pendingBackground: Partial<BackgroundConfig> = {};

/**
 * 取色器与滑块的变更入口。
 *
 * NColorPicker 是受控用法（传了 :value），它的 complete 事件读的是内部的
 * mergedValueRef —— 受控模式下那就是 props.value，也就是**变更前的旧颜色**，
 * 所以只能监听 update:value。而 update:value 会在拖动时随每一次 mousemove 触发，
 * 全部直写存储会让每一帧都「序列化整份配置 + 写 storage」，因此这里先画到
 * CSS 变量上做即时预览，停手 250ms 后再合并成一次写入。
 */
function stageBackground(patch: Partial<BackgroundConfig>): void {
  pendingBackground = { ...pendingBackground, ...patch };
  previewBackground(props.settings, pendingBackground);
  if (commitTimer !== null) window.clearTimeout(commitTimer);
  commitTimer = window.setTimeout(flushBackground, BACKGROUND_COMMIT_DELAY);
}

/** 立即提交挂起的背景变更（关闭面板、卸载、上传或移除图片前都要先调用） */
function flushBackground(): void {
  if (commitTimer !== null) {
    window.clearTimeout(commitTimer);
    commitTimer = null;
  }
  const patch = pendingBackground;
  pendingBackground = {};
  if (Object.keys(patch).length > 0) patchBackground(patch);
}

/* ---------------- 单选组守卫：参数取 update:value 的宽类型，字面量判等后收窄 ---------------- */

function onTabChange(value: string | number): void {
  if (value === 'appearance' || value === 'background' || value === 'behavior' || value === 'data') {
    activeTab.value = value;
  }
}

function onThemeChange(value: string | number): void {
  if (value === 'light' || value === 'dark' || value === 'system') {
    patchSettings({ theme: value });
  }
}

function onSidebarChange(value: string | number): void {
  if (value === 'left' || value === 'right') {
    patchSettings({ sidebarPosition: value });
  }
}

function onDensityChange(value: string | number): void {
  if (value === 'compact' || value === 'comfortable' || value === 'loose') {
    patchSettings({ cardDensity: value });
  }
}

function onOpenModeChange(value: string | number): void {
  if (value === 'newTab' || value === 'currentTab') {
    patchSettings({ defaultOpenMode: value });
  }
}

function onBgTypeChange(value: string | number): void {
  if (value === 'solid' || value === 'gradient' || value === 'image') {
    flushBackground();
    patchBackground({ type: value });
  }
}

/* ---------------- 颜色与滑块 ---------------- */

function onBackgroundColorChange(value: string | null): void {
  if (typeof value === 'string' && value) stageBackground({ color: value });
}

function onGradientFromChange(value: string | null): void {
  if (typeof value === 'string' && value) stageBackground({ gradientFrom: value });
}

function onGradientToChange(value: string | null): void {
  if (typeof value === 'string' && value) stageBackground({ gradientTo: value });
}

function onPanelOpacityChange(value: number): void {
  stageBackground({ panelOpacity: value });
}

function onRadiusChange(value: number): void {
  stageBackground({ radius: value });
}

/* ---------------- 背景图片 ---------------- */

function pickBgImage(): void {
  bgUploadError.value = '';
  bgFileInput.value?.click();
}

async function onBgFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  // 清空 value，否则再次选择同一个文件不会触发 change
  input.value = '';
  if (!file) return;

  bgUploading.value = true;
  const result = await fileToBackgroundDataUrl(file);
  bgUploading.value = false;

  if (!result.ok) {
    bgUploadError.value = result.message;
    return;
  }

  bgUploadError.value = '';
  bgImageUrl.value = '';
  flushBackground(); // 先落盘挂起的改动，避免与这次上传相互覆盖
  patchBackground({ imageUrl: result.dataUrl, type: 'image' });
}

function clearBgImage(): void {
  bgUploadError.value = '';
  bgImageUrl.value = '';
  flushBackground();
  patchBackground({ imageUrl: '' });
}

/** 背景图片地址：失焦 / 回车提交，同时把背景类型切到图片 */
function onBgImageChange(value: string): void {
  const next = value.trim();
  bgImageUrl.value = next;
  // 「已上传本地图片」时输入框是空的，别让一次失焦把上传的图清掉
  if (!next && isUploadedBackground(props.settings.background)) return;
  if (next === props.settings.background.imageUrl) return;
  flushBackground();
  patchBackground({ imageUrl: next, type: 'image' });
}

function onEngineChange(value: string | number | null): void {
  if (typeof value === 'string') {
    patchSettings({ defaultSearchEngine: value });
  }
}

</script>

<template>
  <NModal
    v-model:show="visible"
    preset="card"
    title="设置"
    role="dialog"
    aria-label="设置"
    class="settings-modal"
    data-testid="settings-modal"
    :style="{ width: '720px', maxWidth: 'calc(100vw - 32px)' }"
    :bordered="false"
  >
    <p class="settings-lead">所有设置保存在本地，重新打开新标签页后依然生效</p>

    <NTabs :value="activeTab" type="line" animated @update:value="onTabChange">
      <!-- 外观 -->
      <NTabPane name="appearance" tab="外观">
        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">主题模式</span>
          </div>
          <NRadioGroup
            size="small"
            class="setting-icon-group"
            :value="settings.theme"
            data-testid="setting-theme"
            @update:value="onThemeChange"
          >
            <!-- 只留图标：文字标签与图标语义重复，悬停提示承担可读性 -->
            <NRadioButton
              v-for="option in themeOptions"
              :key="option.value"
              :value="option.value"
              :title="option.label"
              :aria-label="option.label"
              :data-testid="`setting-theme-${option.value}`"
            >
              <SvgIcon :name="option.icon" :size="14" />
            </NRadioButton>
          </NRadioGroup>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">导航栏位置</span>
            <span class="setting-row__hint">即时生效并持久化；窄屏下自动收起为图标条</span>
          </div>
          <NRadioGroup
            size="small"
            class="setting-icon-group"
            :value="settings.sidebarPosition"
            data-testid="setting-sidebar"
            @update:value="onSidebarChange"
          >
            <NRadioButton
              v-for="option in sidebarPositionOptions"
              :key="option.value"
              :value="option.value"
              :title="option.label"
              :aria-label="option.label"
              :data-testid="`setting-sidebar-${option.value}`"
            >
              <SvgIcon :name="option.icon" :size="14" />
            </NRadioButton>
          </NRadioGroup>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">卡片紧凑程度</span>
            <span class="setting-row__hint">{{ densityHint }}</span>
          </div>
          <NRadioGroup
            size="small"
            :value="settings.cardDensity"
            data-testid="setting-density"
            @update:value="onDensityChange"
          >
            <NRadioButton
              v-for="option in densityOptions"
              :key="option.value"
              :value="option.value"
              :data-testid="`setting-density-${option.value}`"
            >
              {{ option.label }}
            </NRadioButton>
          </NRadioGroup>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">显示网站描述</span>
            <span class="setting-row__hint">关闭后条目只显示名称与域名，信息更紧凑</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.showDescription"
            data-testid="setting-switch-showdescription"
            @update:value="(value: boolean) => patchSettings({ showDescription: value })"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">自动隐藏侧边栏</span>
            <span class="setting-row__hint">
              默认常驻显示；开启后鼠标靠近屏幕{{
                settings.sidebarPosition === 'right' ? '右' : '左'
              }}缘时悬浮呼出，移开后收回，页面更完整
            </span>
          </div>
          <NSwitch
            size="small"
            :value="settings.sidebarAutoHide"
            data-testid="setting-switch-sidebarautohide"
            @update:value="(value: boolean) => patchSettings({ sidebarAutoHide: value })"
          />
        </div>

      </NTabPane>

      <!-- 背景与样式 -->
      <NTabPane name="background" tab="背景与样式">
        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">背景类型</span>
          </div>
          <NRadioGroup
            size="small"
            :value="settings.background.type"
            data-testid="setting-bgtype"
            @update:value="onBgTypeChange"
          >
            <NRadioButton
              v-for="option in bgTypeOptions"
              :key="option.value"
              :value="option.value"
              :data-testid="`setting-bgtype-${option.value}`"
            >
              {{ option.label }}
            </NRadioButton>
          </NRadioGroup>
        </div>

        <div v-if="settings.background.type === 'solid'" class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">背景颜色</span>
          </div>
          <NColorPicker
            :modes="['hex']"
            :show-alpha="false"
            :value="settings.background.color"
            data-testid="setting-color-bg"
            @update:value="onBackgroundColorChange"
          />
        </div>

        <div v-else-if="settings.background.type === 'gradient'" class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">渐变颜色</span>
            <span class="setting-row__hint">两个色标从左上到右下线性过渡</span>
          </div>
          <div class="setting-colors">
            <NColorPicker
              :modes="['hex']"
              :show-alpha="false"
              :value="settings.background.gradientFrom"
              data-testid="setting-color-gradientfrom"
              @update:value="onGradientFromChange"
            />
            <NColorPicker
              :modes="['hex']"
              :show-alpha="false"
              :value="settings.background.gradientTo"
              data-testid="setting-color-gradientto"
              @update:value="onGradientToChange"
            />
          </div>
        </div>

        <div v-else class="setting-block">
          <span class="setting-row__label">背景图片</span>

          <input
            ref="bgFileInput"
            class="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            aria-label="选择背景图片文件"
            @change="onBgFileChange"
          />

          <div class="setting-bg-actions">
            <NButton
              size="small"
              :loading="bgUploading"
              data-testid="setting-bgimage-upload"
              @click="pickBgImage"
            >
              <SvgIcon name="upload" :size="15" />
              上传本地图片
            </NButton>
            <NButton
              v-if="settings.background.imageUrl"
              size="small"
              secondary
              data-testid="setting-bgimage-clear"
              @click="clearBgImage"
            >
              <SvgIcon name="trash" :size="15" />
              移除图片
            </NButton>
          </div>

          <p v-if="bgUploadError" class="setting-row__error">{{ bgUploadError }}</p>

          <div v-if="settings.background.imageUrl" class="setting-bg-preview">
            <img :src="settings.background.imageUrl" alt="当前背景图预览" />
            <span class="setting-row__hint">{{ bgImageSourceText }}</span>
          </div>

          <NInput
            v-model:value="bgImageUrl"
            size="small"
            placeholder="或粘贴图片地址 https://example.com/bg.jpg"
            data-testid="setting-bgimage-url"
            @change="onBgImageChange"
          />
          <span class="setting-row__hint">
            上传的图片会等比压缩后存在本地配置里，不经过任何服务器；粘贴远程地址则在每次打开新标签页时请求一次，请自行确认可信。
          </span>
        </div>

        <div class="setting-block">
          <span class="setting-row__label">
            卡片与面板不透明度：{{ Math.round(settings.background.panelOpacity * 100) }}%
          </span>
          <NSlider
            :min="0.4"
            :max="1"
            :step="0.05"
            :value="settings.background.panelOpacity"
            :format-tooltip="(value: number) => `${Math.round(value * 100)}%`"
            data-testid="setting-slider-panelopacity"
            @update:value="onPanelOpacityChange"
          />
        </div>

        <div class="setting-block">
          <span class="setting-row__label">卡片圆角：{{ settings.background.radius }} px</span>
          <NSlider
            :min="0"
            :max="20"
            :step="1"
            :value="settings.background.radius"
            :format-tooltip="(value: number) => `${value} px`"
            data-testid="setting-slider-radius"
            @update:value="onRadiusChange"
          />
        </div>
      </NTabPane>

      <!-- 行为 -->
      <NTabPane name="behavior" tab="行为">
        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">默认打开方式</span>
          </div>
          <NRadioGroup
            size="small"
            :value="settings.defaultOpenMode"
            data-testid="setting-openmode"
            @update:value="onOpenModeChange"
          >
            <NRadioButton
              v-for="option in openModeOptions"
              :key="option.value"
              :value="option.value"
              :data-testid="`setting-openmode-${option.value}`"
            >
              {{ option.label }}
            </NRadioButton>
          </NRadioGroup>
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">默认搜索引擎</span>
          </div>
          <NSelect
            size="small"
            :options="engineOptions"
            :value="settings.defaultSearchEngine"
            class="setting-select"
            data-testid="setting-engine"
            @update:value="onEngineChange"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">启用右键快捷菜单</span>
            <span class="setting-row__hint">关闭后只能通过卡片上的按钮与拖拽操作</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.contextMenuEnabled"
            data-testid="setting-switch-contextmenu"
            @update:value="(value: boolean) => patchSettings({ contextMenuEnabled: value })"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">启用键盘快捷键</span>
            <span class="setting-row__hint">Ctrl/⌘+K、/ 聚焦搜索，Ctrl+B 显示/隐藏导航栏</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.shortcutsEnabled"
            data-testid="setting-switch-shortcuts"
            @update:value="(value: boolean) => patchSettings({ shortcutsEnabled: value })"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">记录搜索历史</span>
            <span class="setting-row__hint">仅保存在本地，可随时清空</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.searchHistoryEnabled"
            data-testid="setting-switch-searchhistory"
            @update:value="(value: boolean) => patchSettings({ searchHistoryEnabled: value })"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">允许请求远程网站图标</span>
            <span class="setting-row__hint">关闭后完全离线，仅用 Chrome 本地缓存与站点 /favicon.ico</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.remoteFavicon"
            data-testid="setting-switch-favicon"
            @update:value="(value: boolean) => patchSettings({ remoteFavicon: value })"
          />
        </div>
      </NTabPane>

      <!-- 数据管理 -->
      <NTabPane name="data" tab="数据管理">
        <div class="settings-stats">
          <NStatistic label="导航页面" :value="stats.pages" />
          <NStatistic label="分区" :value="stats.sections" />
          <NStatistic label="网站" :value="stats.websites" />
        </div>

        <p class="setting-row__hint">
          存储方式：{{ backend }}（{{ extensionContext ? '扩展环境' : '普通网页预览环境' }}）· 已用空间 {{ usageText }}
        </p>

        <NAlert v-if="integrityMessage" type="warning" :show-icon="true" class="settings-alert">
          {{ integrityMessage }}
        </NAlert>

        <h4 class="settings-subtitle">导出配置</h4>
        <NButton size="small" data-testid="setting-export" @click="emit('export')">
          <SvgIcon name="download" :size="15" />
          导出为 JSON 文件
        </NButton>

        <h4 class="settings-subtitle">导入配置</h4>
        <p class="setting-row__hint">
          导入会覆盖当前的页面、分区、网站与设置。导入前会完整校验文件，校验不通过不会改动任何数据。
        </p>
        <NButton size="small" data-testid="setting-import" @click="emit('pick-import')">
          <SvgIcon name="upload" :size="15" />
          选择备份文件导入
        </NButton>

        <h4 class="settings-subtitle">清理与重置</h4>
        <div class="settings-danger-zone">
          <NButton size="small" secondary data-testid="setting-action-clearsearch" @click="emit('clear-search-history')">
            <SvgIcon name="search" :size="15" />
            清空搜索历史
          </NButton>
          <NButton size="small" secondary data-testid="setting-action-restore" @click="emit('restore-defaults')">
            <SvgIcon name="refresh" :size="15" />
            恢复默认配置
          </NButton>
          <NButton size="small" secondary type="error" data-testid="setting-action-clearall" @click="emit('clear-data')">
            <SvgIcon name="trash" :size="15" />
            清空全部导航数据
          </NButton>
        </div>
        <p class="setting-row__hint">
          「恢复默认配置」会重新载入内置演示数据；「清空全部导航数据」会删除所有页面、分区与网站（保留设置）。建议先导出备份。
        </p>
      </NTabPane>
    </NTabs>

    <template #footer>
      <div class="settings-footer">
        <NButton type="primary" data-testid="settings-done" @click="visible = false">完成</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.settings-lead {
  margin: 0 0 4px;
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-row__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-row__label {
  font-weight: 500;
  color: var(--text-primary);
}

.setting-row__hint {
  color: var(--text-tertiary);
  font-size: var(--font-sm);
  line-height: 1.5;
}

.setting-row__error {
  color: var(--color-danger);
  font-size: var(--font-sm);
  line-height: 1.5;
}

/*
 * 纯图标单选按钮（主题模式 / 导航栏位置）的垂直居中。
 *
 * .n-radio-button 是 inline-block + line-height 28px，内部 .n-radio__label 靠
 * **文字行盒**撑满按钮高度；图标按钮里的 <svg> 是 display: block，不产生行盒，
 * label 高度便塌成图标自身的 14px，于是图标贴到按钮上沿（实测偏上 6.2px）。
 * 这里显式按按钮高度居中。--n-height 由 Naive 定义在 .n-radio-button 上并继承下来。
 */
.setting-icon-group :deep(.n-radio__label) {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--n-height, 28px);
  line-height: 1;
}

/* 背景图：操作按钮、缩略图预览各自成行，避免和右侧控件抢宽度 */
.setting-bg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.setting-bg-preview {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.setting-bg-preview img {
  width: 132px;
  height: 74px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  flex: none;
}

.setting-colors {
  display: flex;
  gap: var(--space-3);
  width: 320px;
  max-width: 45%;
}

.setting-select {
  width: 200px;
}

/* 整块布局：滑块与图片地址这类需要占满行的控件 */
.setting-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-block:last-child {
  border-bottom: none;
}

.settings-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.settings-alert {
  margin-bottom: var(--space-3);
}

.settings-subtitle {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--font-base);
  font-weight: 600;
}

.settings-danger-zone {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .setting-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .setting-colors {
    width: 100%;
    max-width: none;
  }

  .settings-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
