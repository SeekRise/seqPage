<script setup lang="ts">
/**
 * 顶部搜索区
 *
 * 三种提交行为（都只在用户主动操作时发生）：
 * 1. 本地导航搜索：输入即过滤本地数据，无需回车，也不访问任何服务器。
 * 2. 打开网址：识别为域名/IP 时提示"直接打开"。
 * 3. 搜索引擎：回车或点击搜索按钮，跳转到所选引擎（可在设置中修改默认引擎）。
 *
 * 隐私：搜索词不会自动上传；只有用户主动提交时才跳转到所选搜索引擎。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import { useSearchHistory } from '@/composables/useSearchHistory';
import { buildSearchIndex, searchWebsites } from '@/services/search';
import type { NaviState, SearchResult } from '@/types';
import { SEARCH_ENGINES, findSearchEngineByKeyword } from '@/utils/constants';
import { getDisplayHost, looksLikeUrl, normalizeUrl } from '@/utils/url';

const props = defineProps<{
  /** 用于本地搜索的状态快照 */
  navState: NaviState;
  /** 默认搜索引擎 id */
  defaultEngineId: string;
  /** 是否启用搜索历史 */
  historyEnabled: boolean;
  /** 是否启用快捷键提示 */
  shortcutsEnabled: boolean;
}>();

const emit = defineEmits<{
  open: [websiteId: string];
  search: [payload: { query: string; engineId: string }];
  'quick-add': [];
}>();

const { items: historyItems, load: loadHistory, remove: removeHistory, clear: clearHistory } = useSearchHistory();

const keyword = ref('');
const engineId = ref(props.defaultEngineId);
const engineMenuOpen = ref(false);
const historyOpen = ref(false);
const activeResultIndex = ref(-1);
const inputRef = ref<HTMLInputElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);

const engine = computed(
  () => SEARCH_ENGINES.find((item) => item.id === engineId.value) ?? SEARCH_ENGINES[0],
);

/** 索引随状态变化重建（数据量大时也只做一次浅层映射） */
const index = computed(() => buildSearchIndex(props.navState));

const results = computed<SearchResult[]>(() => {
  if (!keyword.value.trim()) return [];
  return searchWebsites(index.value, keyword.value, 24);
});

const urlCandidate = computed(() => {
  const value = keyword.value.trim();
  if (!value || !looksLikeUrl(value)) return null;
  const normalized = normalizeUrl(value);
  return normalized.ok ? normalized.url : null;
});

/** 关键词前缀切换引擎，如 "gh vue" */
const keywordEngine = computed(() => {
  const [first, ...rest] = keyword.value.trim().split(/\s+/);
  if (rest.length === 0 || !first) return null;
  const matched = findSearchEngineByKeyword(first);
  return matched ? { engine: matched, query: rest.join(' ') } : null;
});

const trimmedKeyword = computed(() => keyword.value.trim());
const showResultsPanel = computed(() => trimmedKeyword.value.length > 0);
const hasDropdown = computed(
  () =>
    historyOpen.value &&
    !trimmedKeyword.value &&
    props.historyEnabled &&
    historyItems.value.length > 0,
);

watch(
  () => props.defaultEngineId,
  (value) => {
    engineId.value = value;
  },
);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
});

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
});

function onDocumentPointerDown(event: PointerEvent): void {
  if (!rootRef.value || !(event.target instanceof Node)) return;
  if (!rootRef.value.contains(event.target)) {
    engineMenuOpen.value = false;
    historyOpen.value = false;
  }
}

/** 快捷键：/ 或 Ctrl/⌘+K 聚焦搜索框（在 App 中通过 ref 调用） */
function focus(): void {
  void nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
}

function pickEngine(id: string): void {
  engineId.value = id;
  engineMenuOpen.value = false;
}

function submitSearch(): void {
  const value = keyword.value.trim();
  if (!value) return;

  // 1. 网址优先直接打开
  if (urlCandidate.value) {
    emit('search', { query: urlCandidate.value, engineId: engineId.value });
    keyword.value = '';
    return;
  }

  // 2. 关键词前缀指定的引擎
  const keywordTarget = keywordEngine.value;
  const targetEngine = keywordTarget?.engine ?? engine.value;
  const query = keywordTarget?.query ?? value;
  emit('search', { query, engineId: targetEngine.id });
  keyword.value = '';
  historyOpen.value = false;
  activeResultIndex.value = -1;
}

function openResult(websiteId: string): void {
  emit('open', websiteId);
  keyword.value = '';
  activeResultIndex.value = -1;
}

function onInputFocus(): void {
  if (!trimmedKeyword.value && props.historyEnabled) historyOpen.value = true;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (keyword.value) {
      keyword.value = '';
      activeResultIndex.value = -1;
    } else {
      inputRef.value?.blur();
    }
    engineMenuOpen.value = false;
    historyOpen.value = false;
    return;
  }

  if (event.key === 'ArrowDown' && results.value.length > 0) {
    event.preventDefault();
    activeResultIndex.value = Math.min(activeResultIndex.value + 1, results.value.length - 1);
    return;
  }

  if (event.key === 'ArrowUp' && results.value.length > 0) {
    event.preventDefault();
    activeResultIndex.value = Math.max(activeResultIndex.value - 1, -1);
  }
}

function onEnter(): void {
  if (activeResultIndex.value >= 0) {
    const target = results.value[activeResultIndex.value];
    if (target) {
      openResult(target.website.id);
      return;
    }
  }
  submitSearch();
}

async function useHistoryItem(item: { keyword: string }): Promise<void> {
  keyword.value = item.keyword;
  historyOpen.value = false;
  await nextTick();
  inputRef.value?.focus();
}

watch(historyOpen, (open) => {
  if (open) void loadHistory();
});

defineExpose({ focus });
</script>

<template>
  <div ref="rootRef" class="search-bar">
    <div class="search-bar__box">
      <button
        type="button"
        class="search-bar__engine"
        :title="`当前搜索引擎：${engine.name}（点击切换）`"
        :aria-label="`切换搜索引擎，当前为 ${engine.name}`"
        aria-haspopup="menu"
        :aria-expanded="engineMenuOpen"
        @click="engineMenuOpen = !engineMenuOpen"
      >
        <span class="search-bar__engine-icon">{{ engine.icon }}</span>
        <span class="search-bar__engine-name">{{ engine.name }}</span>
        <SvgIcon name="chevronDown" :size="14" />
      </button>

      <span class="search-bar__divider" />

      <input
        ref="inputRef"
        v-model="keyword"
        class="search-bar__input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="showResultsPanel"
        aria-controls="search-results"
        placeholder="搜索网站，或直接输入网址（回车打开）"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.prevent="onEnter"
        @keydown="onKeydown"
        @focus="onInputFocus"
      />

      <button
        v-if="keyword"
        type="button"
        class="icon-btn search-bar__clear"
        title="清空"
        aria-label="清空搜索内容"
        @click="keyword = ''"
      >
        <SvgIcon name="close" :size="15" />
      </button>

      <button
        type="button"
        class="btn btn--primary search-bar__submit"
        title="提交搜索"
        @click="submitSearch"
      >
        <SvgIcon name="search" :size="15" />
        <span class="search-bar__submit-text">搜索</span>
      </button>

      <button
        type="button"
        class="icon-btn search-bar__quick-add"
        title="快捷添加当前网页"
        aria-label="快捷添加当前网页"
        @click="emit('quick-add')"
      >
        <SvgIcon name="plus" :size="16" />
      </button>

      <div v-if="engineMenuOpen" class="search-bar__menu" role="menu" aria-label="搜索引擎">
        <button
          v-for="item in SEARCH_ENGINES"
          :key="item.id"
          type="button"
          role="menuitemradio"
          class="search-bar__menu-item"
          :class="{ 'search-bar__menu-item--active': item.id === engineId }"
          :aria-checked="item.id === engineId"
          @click="pickEngine(item.id)"
        >
          <span class="search-bar__menu-icon">{{ item.icon }}</span>
          <span class="search-bar__menu-label">{{ item.name }}</span>
          <span v-if="item.keyword" class="search-bar__menu-hint">{{ item.keyword }}</span>
          <SvgIcon v-if="item.id === engineId" name="check" :size="14" />
        </button>
      </div>
    </div>

    <p v-if="shortcutsEnabled" class="search-bar__hint">
      快捷键：<kbd>Ctrl</kbd>+<kbd>K</kbd> 聚焦搜索 · <kbd>/</kbd> 聚焦搜索 · <kbd>Esc</kbd> 清空 · <kbd>Ctrl</kbd>+<kbd>B</kbd> 显示/隐藏导航栏
    </p>

    <!-- 搜索历史 -->
    <div v-if="hasDropdown" class="search-bar__panel" role="listbox" aria-label="搜索历史">
      <div class="search-bar__panel-head">
        <span>最近搜索</span>
        <button type="button" class="btn btn--text btn--sm" @click="clearHistory">清空</button>
      </div>
      <button
        v-for="item in historyItems"
        :key="item.keyword"
        type="button"
        class="search-bar__row"
        @click="useHistoryItem(item)"
      >
        <SvgIcon name="history" :size="15" />
        <span class="search-bar__row-title ellipsis">{{ item.keyword }}</span>
        <span class="search-bar__row-meta">{{ item.engineId }}</span>
        <span
          class="search-bar__row-action"
          role="button"
          tabindex="0"
          title="从历史中删除"
          @click.stop="removeHistory(item.keyword)"
          @keydown.enter.stop="removeHistory(item.keyword)"
        >
          <SvgIcon name="close" :size="13" />
        </span>
      </button>
    </div>

    <!-- 本地搜索结果 -->
    <div v-else-if="showResultsPanel" id="search-results" class="search-bar__panel" role="listbox" aria-label="本地搜索结果">
      <button
        v-if="urlCandidate"
        type="button"
        class="search-bar__row search-bar__row--primary"
        @click="submitSearch"
      >
        <SvgIcon name="external" :size="15" />
        <span class="search-bar__row-title ellipsis">直接打开 {{ getDisplayHost(urlCandidate) }}</span>
        <span class="search-bar__row-meta">网址</span>
      </button>

      <div class="search-bar__panel-head">
        <span>
          本地结果
          <template v-if="results.length">（{{ results.length }}）</template>
        </span>
      </div>

      <button
        v-for="(item, index) in results"
        :key="item.website.id"
        type="button"
        role="option"
        class="search-bar__row"
        :class="{ 'search-bar__row--active': index === activeResultIndex }"
        :aria-selected="index === activeResultIndex"
        @mouseenter="activeResultIndex = index"
        @click="openResult(item.website.id)"
      >
        <span class="search-bar__row-favicon" :title="item.website.url">
          <SvgIcon name="link" :size="14" />
        </span>
        <span class="search-bar__row-body">
          <span class="search-bar__row-title ellipsis">{{ item.website.name }}</span>
          <span class="search-bar__row-desc ellipsis">
            {{ item.page?.name ?? '未归属页面' }} · {{ item.section?.name ?? '未归属分区' }}
            <template v-if="item.website.description"> · {{ item.website.description }}</template>
          </span>
        </span>
        <span v-if="item.website.favorite" class="search-bar__row-fav" title="已收藏">
          <SvgIcon name="star" :size="13" filled />
        </span>
      </button>

      <p v-if="results.length === 0 && !urlCandidate" class="search-bar__empty">
        本地导航中没有匹配「{{ trimmedKeyword }}」的网站，按回车可使用 {{ engine.name }} 搜索网络。
      </p>

      <button type="button" class="search-bar__row search-bar__row--primary" @click="submitSearch">
        <span class="search-bar__row-engine">{{ engine.icon }}</span>
        <span class="search-bar__row-title ellipsis">
          用 {{ engine.name }} 搜索「{{ trimmedKeyword }}」
        </span>
        <span class="search-bar__row-meta">回车</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  position: relative;
  width: 100%;
  max-width: 720px;
}

.search-bar__box {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 6px 6px 6px var(--space-2);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-bar__box:focus-within {
  border-color: var(--brand-400);
  box-shadow: var(--shadow-sm);
}

.search-bar__engine {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--font-sm);
}

.search-bar__engine:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.search-bar__engine-icon {
  font-size: 15px;
  line-height: 1;
}

.search-bar__engine-name {
  max-width: 74px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.search-bar__divider {
  width: 1px;
  height: 20px;
  background: var(--border-color);
  flex: none;
}

.search-bar__input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 6px var(--space-2);
  font-size: var(--font-base);
  outline: none;
}

.search-bar__input::placeholder {
  color: var(--text-tertiary);
}

.search-bar__clear {
  width: 26px;
  height: 26px;
}

.search-bar__submit {
  flex: none;
}

.search-bar__quick-add {
  width: 30px;
  height: 30px;
  flex: none;
}

.search-bar__hint {
  margin-top: 6px;
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.search-bar__hint kbd {
  display: inline-block;
  padding: 0 4px;
  min-width: 16px;
  text-align: center;
  font-family: inherit;
  font-size: 10px;
  line-height: 16px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-color);
  border-bottom-width: 2px;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
}

.search-bar__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 220px;
  padding: var(--space-1);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.search-bar__menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-base);
  color: var(--text-primary);
  text-align: left;
}

.search-bar__menu-item:hover {
  background: var(--bg-hover);
}

.search-bar__menu-item--active {
  color: var(--brand-600);
}

.search-bar__menu-icon {
  font-size: 15px;
  line-height: 1;
}

.search-bar__menu-label {
  flex: 1;
}

.search-bar__menu-hint {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.search-bar__panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 25;
  max-height: min(60vh, 460px);
  overflow-y: auto;
  padding: var(--space-1);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

.search-bar__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-2) var(--space-1);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.search-bar__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
}

.search-bar__row:hover,
.search-bar__row--active {
  background: var(--bg-hover);
}

.search-bar__row--primary {
  color: var(--brand-600);
}

.search-bar__row-favicon,
.search-bar__row-engine {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-secondary);
  flex: none;
}

.search-bar__row-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.search-bar__row-title {
  font-size: var(--font-base);
}

.search-bar__row-desc {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.search-bar__row-meta,
.search-bar__row-action {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  flex: none;
}

.search-bar__row-action:hover {
  color: var(--color-danger);
}

.search-bar__row-fav {
  color: var(--color-warning);
  flex: none;
}

.search-bar__empty {
  padding: var(--space-3) var(--space-2);
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

@media (max-width: 720px) {
  .search-bar__engine-name,
  .search-bar__submit-text {
    display: none;
  }
}
</style>
