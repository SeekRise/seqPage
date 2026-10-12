<script setup lang="ts">
/**
 * 设置面板
 *
 * 采用「分组 + 单页面」结构，不拆成多个独立页面（任务书第十节要求）。
 * 所有设置变更即时生效并持久化；数据管理中的危险操作都会二次确认（由父组件负责）。
 */
import { computed, ref, watch } from 'vue';
import AppModal from '@/components/AppModal.vue';
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

type TabId = 'appearance' | 'behavior' | 'background' | 'data';
type Tab = { id: TabId; label: string; icon: string };

const TABS: Tab[] = [
  { id: 'appearance', label: '外观', icon: 'sun' },
  { id: 'background', label: '背景与样式', icon: 'image' },
  { id: 'behavior', label: '行为', icon: 'settings' },
  { id: 'data', label: '数据管理', icon: 'database' },
];

const activeTab = ref<TabId>('appearance');
const exportRecent = ref(false);

const themeOptions: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'monitor' },
];

const densityOptions: Array<{ value: CardDensity; label: string; hint: string }> = [
  { value: 'compact', label: '紧凑', hint: '信息密度最高，适合网站很多的情况' },
  { value: 'comfortable', label: '标准', hint: '默认密度，兼顾可读性与效率' },
  { value: 'loose', label: '宽松', hint: '卡片更大，触屏操作更友好' },
];

const sidebarPositionOptions: Array<{ value: SidebarPosition; label: string; icon: string }> = [
  { value: 'left', label: '左侧', icon: 'chevronLeft' },
  { value: 'right', label: '右侧', icon: 'chevronRight' },
];

const usageText = computed(() => {
  if (!props.usage) return '无法统计';
  const used = (props.usage.bytes / 1024).toFixed(1);
  const total = (props.usage.quotaBytes / 1024 / 1024).toFixed(0);
  return `${used} KB / 约 ${total} MB`;
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) activeTab.value = 'appearance';
  },
);

function patchSettings(patch: Partial<AppSettings>): void {
  emit('change', patch);
}

function patchBackground(patch: Partial<AppSettings['background']>): void {
  emit('change', { background: { ...props.settings.background, ...patch } });
}

function onBackgroundImageInput(event: Event): void {
  const target = event.target as HTMLInputElement;
  patchBackground({ imageUrl: target.value, type: 'image' });
}
</script>

<template>
  <AppModal
    :model-value="modelValue"
    title="设置"
    description="所有设置保存在本地，重新打开新标签页后依然生效"
    :wide="true"
    :width="760"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="settings">
      <nav class="settings__tabs" aria-label="设置分组">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          type="button"
          class="settings__tab"
          :class="{ 'settings__tab--active': activeTab === tab.id }"
          :aria-current="activeTab === tab.id ? 'true' : undefined"
          @click="activeTab = tab.id"
        >
          <SvgIcon :name="tab.icon" :size="16" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>

      <div class="settings__content">
        <!-- 外观 -->
        <section v-if="activeTab === 'appearance'" class="settings__section">
          <h3 class="settings__title">主题模式</h3>
          <div class="settings__segmented" role="radiogroup" aria-label="主题模式">
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.theme === option.value }"
              :aria-checked="settings.theme === option.value"
              @click="patchSettings({ theme: option.value })"
            >
              <SvgIcon :name="option.icon" :size="15" />
              {{ option.label }}
            </button>
          </div>

          <h3 class="settings__title">导航栏位置</h3>
          <div class="settings__segmented" role="radiogroup" aria-label="导航栏位置">
            <button
              v-for="option in sidebarPositionOptions"
              :key="option.value"
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.sidebarPosition === option.value }"
              :aria-checked="settings.sidebarPosition === option.value"
              @click="patchSettings({ sidebarPosition: option.value })"
            >
              <SvgIcon :name="option.icon" :size="15" />
              {{ option.label }}
            </button>
          </div>
          <p class="settings__hint">
            侧边导航栏可以放在左侧或右侧，即时生效并会持久化；窄屏下会自动收起为图标条。
          </p>

          <h3 class="settings__title">卡片紧凑程度</h3>
          <div class="settings__list">
            <label
              v-for="option in densityOptions"
              :key="option.value"
              class="settings__radio-row"
              :class="{ 'settings__radio-row--active': settings.cardDensity === option.value }"
            >
              <input
                type="radio"
                name="density"
                :value="option.value"
                :checked="settings.cardDensity === option.value"
                @change="patchSettings({ cardDensity: option.value })"
              />
              <span class="settings__radio-body">
                <span class="settings__radio-label">{{ option.label }}</span>
                <span class="settings__radio-hint">{{ option.hint }}</span>
              </span>
            </label>
          </div>

          <h3 class="settings__title">信息展示</h3>
          <label class="settings__switch">
            <input
              type="checkbox"
              :checked="settings.showDescription"
              @change="patchSettings({ showDescription: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>显示网站描述</strong>
              <em>关闭后卡片只显示名称与域名，信息更紧凑</em>
            </span>
          </label>
        </section>

        <!-- 背景与样式 -->
        <section v-else-if="activeTab === 'background'" class="settings__section">
          <h3 class="settings__title">背景类型</h3>
          <div class="settings__segmented" role="radiogroup" aria-label="背景类型">
            <button
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.background.type === 'solid' }"
              :aria-checked="settings.background.type === 'solid'"
              @click="patchBackground({ type: 'solid' })"
            >
              纯色
            </button>
            <button
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.background.type === 'gradient' }"
              :aria-checked="settings.background.type === 'gradient'"
              @click="patchBackground({ type: 'gradient' })"
            >
              渐变
            </button>
            <button
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.background.type === 'image' }"
              :aria-checked="settings.background.type === 'image'"
              @click="patchBackground({ type: 'image' })"
            >
              图片
            </button>
          </div>

          <div v-if="settings.background.type === 'solid'" class="settings__field">
            <label class="settings__label" for="bg-color">背景颜色</label>
            <div class="settings__color-row">
              <input
                id="bg-color"
                type="color"
                :value="settings.background.color"
                @input="patchBackground({ color: ($event.target as HTMLInputElement).value })"
              />
              <input
                class="input"
                type="text"
                :value="settings.background.color"
                maxlength="7"
                @change="patchBackground({ color: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>

          <div v-else-if="settings.background.type === 'gradient'" class="settings__field">
            <label class="settings__label">渐变颜色</label>
            <div class="settings__color-row">
              <input
                type="color"
                :value="settings.background.gradientFrom"
                title="起始色"
                @input="patchBackground({ gradientFrom: ($event.target as HTMLInputElement).value })"
              />
              <input
                type="color"
                :value="settings.background.gradientTo"
                title="结束色"
                @input="patchBackground({ gradientTo: ($event.target as HTMLInputElement).value })"
              />
              <span class="settings__hint">左侧为起始色，右侧为结束色</span>
            </div>
          </div>

          <div v-else class="settings__field">
            <label class="settings__label" for="bg-image">背景图片地址</label>
            <input
              id="bg-image"
              class="input"
              type="text"
              placeholder="https://example.com/bg.jpg（仅支持 http(s) 或 data:image）"
              :value="settings.background.imageUrl"
              @change="onBackgroundImageInput"
            />
            <span class="settings__hint">
              使用远程图片会在打开新标签页时请求该地址，请自行确认可信；留空则不加载任何图片。
            </span>
          </div>

          <div class="settings__field">
            <label class="settings__label" for="panel-opacity">
              卡片与面板不透明度：{{ Math.round(settings.background.panelOpacity * 100) }}%
            </label>
            <input
              id="panel-opacity"
              type="range"
              min="0.4"
              max="1"
              step="0.05"
              :value="settings.background.panelOpacity"
              @input="patchBackground({ panelOpacity: Number(($event.target as HTMLInputElement).value) })"
            />
          </div>

          <div class="settings__field">
            <label class="settings__label" for="card-radius">卡片圆角：{{ settings.background.radius }} px</label>
            <input
              id="card-radius"
              type="range"
              min="0"
              max="20"
              step="1"
              :value="settings.background.radius"
              @input="patchBackground({ radius: Number(($event.target as HTMLInputElement).value) })"
            />
          </div>
        </section>

        <!-- 行为 -->
        <section v-else-if="activeTab === 'behavior'" class="settings__section">
          <h3 class="settings__title">默认打开方式</h3>
          <div class="settings__segmented" role="radiogroup" aria-label="默认打开方式">
            <button
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.defaultOpenMode === 'newTab' }"
              :aria-checked="settings.defaultOpenMode === 'newTab'"
              @click="patchSettings({ defaultOpenMode: 'newTab' })"
            >
              新标签页
            </button>
            <button
              type="button"
              role="radio"
              class="settings__segment"
              :class="{ 'settings__segment--active': settings.defaultOpenMode === 'currentTab' }"
              :aria-checked="settings.defaultOpenMode === 'currentTab'"
              @click="patchSettings({ defaultOpenMode: 'currentTab' })"
            >
              当前标签页
            </button>
          </div>

          <h3 class="settings__title">默认搜索引擎</h3>
          <select
            class="select settings__select"
            :value="settings.defaultSearchEngine"
            aria-label="默认搜索引擎"
            @change="patchSettings({ defaultSearchEngine: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="engine in SEARCH_ENGINES" :key="engine.id" :value="engine.id">
              {{ engine.name }}
            </option>
          </select>

          <h3 class="settings__title">开关</h3>
          <label class="settings__switch">
            <input
              type="checkbox"
              :checked="settings.contextMenuEnabled"
              @change="patchSettings({ contextMenuEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>启用右键快捷菜单</strong>
              <em>关闭后只能通过卡片上的按钮与拖拽操作</em>
            </span>
          </label>

          <label class="settings__switch">
            <input
              type="checkbox"
              :checked="settings.shortcutsEnabled"
              @change="patchSettings({ shortcutsEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>启用键盘快捷键</strong>
              <em>Ctrl/⌘+K、/ 聚焦搜索，Ctrl+B 显示/隐藏导航栏</em>
            </span>
          </label>

          <label class="settings__switch">
            <input
              type="checkbox"
              :checked="settings.recentVisitsEnabled"
              @change="patchSettings({ recentVisitsEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>记录最近访问</strong>
              <em>只记录从本扩展打开的网站，不采集浏览器历史</em>
            </span>
          </label>

          <label class="settings__switch">
            <input
              type="checkbox"
              :checked="settings.searchHistoryEnabled"
              @change="patchSettings({ searchHistoryEnabled: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>记录搜索历史</strong>
              <em>仅保存在本地，可随时清空</em>
            </span>
          </label>

          <label class="settings__switch">
            <input
              type="checkbox"
              :checked="settings.remoteFavicon"
              @change="patchSettings({ remoteFavicon: ($event.target as HTMLInputElement).checked })"
            />
            <span>
              <strong>允许请求远程网站图标</strong>
              <em>关闭后仅使用 Chrome 本地图标缓存与站点 /favicon.ico，完全离线</em>
            </span>
          </label>

          <div class="settings__field">
            <label class="settings__label" for="recent-limit">
              最近访问保留条数：{{ settings.recentVisitsLimit }}
            </label>
            <input
              id="recent-limit"
              type="range"
              min="5"
              max="100"
              step="5"
              :value="settings.recentVisitsLimit"
              @input="patchSettings({ recentVisitsLimit: Number(($event.target as HTMLInputElement).value) })"
            />
          </div>
        </section>

        <!-- 数据管理 -->
        <section v-else class="settings__section">
          <h3 class="settings__title">数据概览</h3>
          <div class="settings__stats">
            <div class="settings__stat">
              <span class="settings__stat-value">{{ stats.pages }}</span>
              <span class="settings__stat-label">导航页面</span>
            </div>
            <div class="settings__stat">
              <span class="settings__stat-value">{{ stats.sections }}</span>
              <span class="settings__stat-label">分区</span>
            </div>
            <div class="settings__stat">
              <span class="settings__stat-value">{{ stats.websites }}</span>
              <span class="settings__stat-label">网站</span>
            </div>
            <div class="settings__stat">
              <span class="settings__stat-value">{{ stats.recentVisits }}</span>
              <span class="settings__stat-label">最近访问</span>
            </div>
          </div>

          <p class="settings__hint">
            存储方式：{{ backend }}（{{ extensionContext ? '扩展环境' : '普通网页预览环境' }}）· 已用空间 {{ usageText }}
          </p>

          <p v-if="integrityMessage" class="settings__notice settings__notice--warning">
            <SvgIcon name="warning" :size="14" />
            {{ integrityMessage }}
          </p>

          <h3 class="settings__title">导出配置</h3>
          <label class="settings__switch">
            <input v-model="exportRecent" type="checkbox" />
            <span>
              <strong>同时导出最近访问记录</strong>
              <em>最近访问包含你打开过的网站地址，默认不导出</em>
            </span>
          </label>
          <button type="button" class="btn btn--default" @click="emit('export', { includeRecentVisits: exportRecent })">
            <SvgIcon name="download" :size="15" />
            导出为 JSON 文件
          </button>

          <h3 class="settings__title">导入配置</h3>
          <p class="settings__hint">
            导入会覆盖当前的页面、分区、网站与设置。导入前会完整校验文件，校验不通过不会改动任何数据。
          </p>
          <button type="button" class="btn btn--default" @click="emit('pick-import')">
            <SvgIcon name="upload" :size="15" />
            选择备份文件导入
          </button>

          <h3 class="settings__title">清理与重置</h3>
          <div class="settings__danger-zone">
            <button type="button" class="btn btn--default" @click="emit('clear-recent')">
              <SvgIcon name="history" :size="15" />
              清空最近访问
            </button>
            <button type="button" class="btn btn--default" @click="emit('clear-search-history')">
              <SvgIcon name="search" :size="15" />
              清空搜索历史
            </button>
            <button type="button" class="btn btn--default" @click="emit('restore-defaults')">
              <SvgIcon name="refresh" :size="15" />
              恢复默认配置
            </button>
            <button type="button" class="btn btn--danger" @click="emit('clear-data')">
              <SvgIcon name="trash" :size="15" />
              清空全部导航数据
            </button>
          </div>
          <p class="settings__hint">
            「恢复默认配置」会重新载入内置演示数据；「清空全部导航数据」会删除所有页面、分区与网站（保留设置）。
            建议先导出备份。
          </p>
        </section>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn btn--primary" @click="emit('update:modelValue', false)">完成</button>
    </template>
  </AppModal>
</template>

<style scoped>
.settings {
  display: grid;
  grid-template-columns: 148px 1fr;
  gap: var(--space-4);
  min-height: 360px;
}

.settings__tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-right: 1px solid var(--border-color);
  padding-right: var(--space-2);
}

.settings__tab {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-base);
  text-align: left;
}

.settings__tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings__tab--active {
  background: var(--bg-active);
  color: var(--brand-600);
  font-weight: 600;
}

.settings__content {
  min-width: 0;
}

.settings__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.settings__title {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: none;
  margin-top: var(--space-2);
}

.settings__title:first-child {
  margin-top: 0;
}

.settings__segmented {
  display: inline-flex;
  padding: 2px;
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
  gap: 2px;
  width: fit-content;
}

.settings__segment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.settings__segment--active {
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-xs);
  font-weight: 500;
}

.settings__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings__radio-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.settings__radio-row--active {
  border-color: var(--brand-400);
  background: var(--brand-50);
}

.settings__radio-body {
  display: flex;
  flex-direction: column;
}

.settings__radio-label {
  font-size: var(--font-base);
}

.settings__radio-hint {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.settings__switch {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.settings__switch:hover {
  background: var(--bg-hover);
}

.settings__switch input {
  margin-top: 2px;
}

.settings__switch span {
  display: flex;
  flex-direction: column;
}

.settings__switch strong {
  font-size: var(--font-base);
  font-weight: 500;
}

.settings__switch em {
  font-size: var(--font-xs);
  font-style: normal;
  color: var(--text-tertiary);
}

.settings__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings__label {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.settings__color-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.settings__color-row input[type='color'] {
  width: 40px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
}

.settings__color-row .input {
  max-width: 140px;
}

.settings__hint {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.settings__notice {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-sm);
}

.settings__notice--warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.settings__select {
  max-width: 240px;
}

.settings__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}

.settings__stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-2);
  background: var(--bg-subtle);
  border-radius: var(--radius-md);
}

.settings__stat-value {
  font-size: var(--font-xl);
  font-weight: 600;
  color: var(--text-primary);
}

.settings__stat-label {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.settings__danger-zone {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

@media (max-width: 680px) {
  .settings {
    grid-template-columns: 1fr;
  }

  .settings__tabs {
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    padding: 0 0 var(--space-2);
  }

  .settings__stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
