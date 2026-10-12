<script setup lang="ts">
/**
 * 收藏与最近访问面板
 *
 * 说明（任务书 8.3）：
 * - 最近访问只记录「本扩展主动发起」的导航，不采集浏览器历史。
 * - 收藏是网站卡片上的一个字段，可随时取消。
 * - 面板可清空最近访问，清空前会由父组件二次确认。
 */
import { computed, ref } from 'vue';
import SvgIcon from '@/components/SvgIcon.vue';
import type { RecentVisit, Website } from '@/types';
import { formatRelativeTime } from '@/utils/common';
import { getDisplayHost } from '@/utils/url';

const props = defineProps<{
  favorites: Array<{ website: Website; pageName: string; sectionName: string }>;
  recentVisits: RecentVisit[];
  recentEnabled: boolean;
  /** 最近访问对应的网站是否仍存在（用于提示失效项） */
  existingWebsiteIds: string[];
}>();

const emit = defineEmits<{
  open: [websiteId: string];
  'open-url': [payload: { url: string; name: string }];
  'clear-recent': [];
  'set-favorite': [payload: { websiteId: string; favorite: boolean }];
}>();

type TabId = 'favorites' | 'recent';

const activeTab = ref<TabId>('favorites');

const existing = computed(() => new Set(props.existingWebsiteIds));
</script>

<template>
  <div class="panel-dropdown">
    <div class="panel-dropdown__tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="panel-dropdown__tab"
        :class="{ 'panel-dropdown__tab--active': activeTab === 'favorites' }"
        :aria-selected="activeTab === 'favorites'"
        @click="activeTab = 'favorites'"
      >
        <SvgIcon name="star" :size="14" />
        收藏（{{ favorites.length }}）
      </button>
      <button
        v-if="recentEnabled"
        type="button"
        role="tab"
        class="panel-dropdown__tab"
        :class="{ 'panel-dropdown__tab--active': activeTab === 'recent' }"
        :aria-selected="activeTab === 'recent'"
        @click="activeTab = 'recent'"
      >
        <SvgIcon name="history" :size="14" />
        最近访问（{{ recentVisits.length }}）
      </button>
    </div>

    <div class="panel-dropdown__body">
      <!-- 收藏 -->
      <template v-if="activeTab === 'favorites'">
        <p v-if="favorites.length === 0" class="panel-dropdown__empty">
          还没有收藏的网站。把鼠标移到网站卡片上，点击星标即可收藏。
        </p>
        <ul v-else class="panel-dropdown__list">
          <li v-for="item in favorites" :key="item.website.id" class="panel-dropdown__item">
            <button type="button" class="panel-dropdown__link" @click="emit('open', item.website.id)">
              <span class="panel-dropdown__title ellipsis">{{ item.website.name }}</span>
              <span class="panel-dropdown__meta ellipsis">
                {{ item.pageName }} · {{ item.sectionName }} · {{ getDisplayHost(item.website.url) }}
              </span>
            </button>
            <button
              type="button"
              class="icon-btn"
              title="取消收藏"
              aria-label="取消收藏"
              @click="emit('set-favorite', { websiteId: item.website.id, favorite: false })"
            >
              <SvgIcon name="star" :size="14" filled />
            </button>
          </li>
        </ul>
      </template>

      <!-- 最近访问 -->
      <template v-else>
        <div class="panel-dropdown__head">
          <span>仅记录从本扩展打开的网站</span>
          <button
            type="button"
            class="btn btn--text btn--sm"
            :disabled="recentVisits.length === 0"
            @click="emit('clear-recent')"
          >
            清空记录
          </button>
        </div>
        <p v-if="recentVisits.length === 0" class="panel-dropdown__empty">还没有访问记录。</p>
        <ul v-else class="panel-dropdown__list">
          <li v-for="visit in recentVisits" :key="visit.id" class="panel-dropdown__item">
            <button
              type="button"
              class="panel-dropdown__link"
              @click="
                existing.has(visit.websiteId)
                  ? emit('open', visit.websiteId)
                  : emit('open-url', { url: visit.url, name: visit.name })
              "
            >
              <span class="panel-dropdown__title ellipsis">
                {{ visit.name }}
                <span v-if="!existing.has(visit.websiteId)" class="panel-dropdown__tag">已删除</span>
              </span>
              <span class="panel-dropdown__meta ellipsis">
                {{ formatRelativeTime(visit.visitedAt) }} · {{ getDisplayHost(visit.url) }}
              </span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.panel-dropdown {
  width: min(380px, calc(100vw - 32px));
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.panel-dropdown__tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
}

.panel-dropdown__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  justify-content: center;
  padding: var(--space-2);
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.panel-dropdown__tab--active {
  color: var(--brand-600);
  box-shadow: inset 0 -2px 0 var(--brand-500);
  font-weight: 500;
}

.panel-dropdown__body {
  max-height: 320px;
  overflow-y: auto;
  padding: var(--space-1);
}

.panel-dropdown__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.panel-dropdown__list {
  display: flex;
  flex-direction: column;
}

.panel-dropdown__item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  border-radius: var(--radius-sm);
}

.panel-dropdown__item:hover {
  background: var(--bg-hover);
}

.panel-dropdown__link {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
  padding: var(--space-2);
  text-align: left;
  color: var(--text-primary);
}

.panel-dropdown__title {
  font-size: var(--font-base);
}

.panel-dropdown__tag {
  margin-left: 6px;
  padding: 0 4px;
  font-size: var(--font-xs);
  color: var(--text-tertiary);
  background: var(--bg-subtle);
  border-radius: var(--radius-xs);
}

.panel-dropdown__meta {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.panel-dropdown__empty {
  padding: var(--space-4) var(--space-3);
  font-size: var(--font-sm);
  color: var(--text-tertiary);
  text-align: center;
}
</style>
