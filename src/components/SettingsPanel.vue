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
import { computed, ref, watch } from 'vue';
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
import type { AppSettings, CardDensity, SidebarPosition, ThemeMode } from '@/types';
import { SEARCH_ENGINES } from '@/utils/constants';

const props = defineProps<{
  modelValue: boolean;
  settings: AppSettings;
  /** 统计信息 */
  stats: { pages: number; sections: number; websites: number; recentVisits: number };
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
  export: [options: { includeRecentVisits: boolean }];
  'pick-import': [];
  'restore-defaults': [];
  'clear-data': [];
  'clear-recent': [];
  'clear-search-history': [];
}>();

/** NModal 的受控 prop 是 show，经 computed 双向代理转发到 modelValue */
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

type TabId = 'appearance' | 'behavior' | 'background' | 'data';

const activeTab = ref<TabId>('appearance');
const exportRecent = ref(false);
/** 背景图片地址的本地编辑态：@change（失焦/回车）才提交，避免每敲一个字符就写存储 */
const bgImageUrl = ref(props.settings.background.imageUrl);

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

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      activeTab.value = 'appearance';
      bgImageUrl.value = props.settings.background.imageUrl;
    }
  },
);

function patchSettings(patch: Partial<AppSettings>): void {
  emit('change', patch);
}

function patchBackground(patch: Partial<AppSettings['background']>): void {
  emit('change', { background: { ...props.settings.background, ...patch } });
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
    patchBackground({ type: value });
  }
}

function onEngineChange(value: string | number | null): void {
  if (typeof value === 'string') {
    patchSettings({ defaultSearchEngine: value });
  }
}

/** 背景图片地址：失焦 / 回车提交，同时把背景类型切到图片 */
function onBgImageChange(value: string): void {
  bgImageUrl.value = value;
  patchBackground({ imageUrl: value, type: 'image' });
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
            :value="settings.theme"
            data-testid="setting-theme"
            @update:value="onThemeChange"
          >
            <NRadioButton
              v-for="option in themeOptions"
              :key="option.value"
              :value="option.value"
              :data-testid="`setting-theme-${option.value}`"
            >
              <SvgIcon :name="option.icon" :size="14" />
              <span class="setting-radio-label">{{ option.label }}</span>
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
            :value="settings.sidebarPosition"
            data-testid="setting-sidebar"
            @update:value="onSidebarChange"
          >
            <NRadioButton
              v-for="option in sidebarPositionOptions"
              :key="option.value"
              :value="option.value"
              :data-testid="`setting-sidebar-${option.value}`"
            >
              <SvgIcon :name="option.icon" :size="14" />
              <span class="setting-radio-label">{{ option.label }}</span>
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
            <span class="setting-row__hint">关闭后卡片只显示名称与域名，信息更紧凑</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.showDescription"
            data-testid="setting-switch-showdescription"
            @update:value="(value: boolean) => patchSettings({ showDescription: value })"
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
            @complete="(value: string) => patchBackground({ color: value })"
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
              @complete="(value: string) => patchBackground({ gradientFrom: value })"
            />
            <NColorPicker
              :modes="['hex']"
              :show-alpha="false"
              :value="settings.background.gradientTo"
              data-testid="setting-color-gradientto"
              @complete="(value: string) => patchBackground({ gradientTo: value })"
            />
          </div>
        </div>

        <div v-else class="setting-block">
          <span class="setting-row__label">背景图片地址</span>
          <NInput
            v-model:value="bgImageUrl"
            size="small"
            placeholder="https://example.com/bg.jpg（仅支持 http(s) 或 data:image）"
            data-testid="setting-bgimage-url"
            @change="onBgImageChange"
          />
          <span class="setting-row__hint">
            使用远程图片会在打开新标签页时请求该地址，请自行确认可信；留空则不加载任何图片。
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
            @update:value="(value: number) => patchBackground({ panelOpacity: value })"
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
            @update:value="(value: number) => patchBackground({ radius: value })"
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
            <span class="setting-row__label">记录最近访问</span>
            <span class="setting-row__hint">只记录从本扩展打开的网站，不采集浏览器历史</span>
          </div>
          <NSwitch
            size="small"
            :value="settings.recentVisitsEnabled"
            data-testid="setting-switch-recent"
            @update:value="(value: boolean) => patchSettings({ recentVisitsEnabled: value })"
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

        <div class="setting-block">
          <span class="setting-row__label">最近访问保留条数：{{ settings.recentVisitsLimit }}</span>
          <NSlider
            :min="5"
            :max="100"
            :step="5"
            :value="settings.recentVisitsLimit"
            :format-tooltip="(value: number) => `${value} 条`"
            data-testid="setting-slider-recentlimit"
            @update:value="(value: number) => patchSettings({ recentVisitsLimit: value })"
          />
        </div>
      </NTabPane>

      <!-- 数据管理 -->
      <NTabPane name="data" tab="数据管理">
        <div class="settings-stats">
          <NStatistic label="导航页面" :value="stats.pages" />
          <NStatistic label="分区" :value="stats.sections" />
          <NStatistic label="网站" :value="stats.websites" />
          <NStatistic label="最近访问" :value="stats.recentVisits" />
        </div>

        <p class="setting-row__hint">
          存储方式：{{ backend }}（{{ extensionContext ? '扩展环境' : '普通网页预览环境' }}）· 已用空间 {{ usageText }}
        </p>

        <NAlert v-if="integrityMessage" type="warning" :show-icon="true" class="settings-alert">
          {{ integrityMessage }}
        </NAlert>

        <h4 class="settings-subtitle">导出配置</h4>
        <div class="setting-row">
          <div class="setting-row__text">
            <span class="setting-row__label">同时导出最近访问记录</span>
            <span class="setting-row__hint">最近访问包含你打开过的网站地址，默认不导出</span>
          </div>
          <NSwitch v-model:value="exportRecent" size="small" data-testid="setting-switch-exportrecent" />
        </div>
        <NButton size="small" data-testid="setting-export" @click="emit('export', { includeRecentVisits: exportRecent })">
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
          <NButton size="small" secondary data-testid="setting-action-clearrecent" @click="emit('clear-recent')">
            <SvgIcon name="history" :size="15" />
            清空最近访问
          </NButton>
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

.setting-radio-label {
  margin-left: 4px;
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
