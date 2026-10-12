<script setup lang="ts">
/**
 * 应用主界面与交互编排
 *
 * 结构：顶部搜索区 + 主内容区（分区与网站卡片）+ 右侧导航栏 + 各类弹窗/菜单。
 * 组件只负责展示与事件上抛，真正的数据变更全部走 services/store.ts，
 * 保证「一次写入 = 一次持久化 + 失败回滚」。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NConfigProvider, zhCN } from 'naive-ui';
import BatchActionBar from '@/components/BatchActionBar.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import FavoritesRecentPanel from '@/components/FavoritesRecentPanel.vue';
import PageForm from '@/components/PageForm.vue';
import PageManagerModal from '@/components/PageManagerModal.vue';
import SearchBar from '@/components/SearchBar.vue';
import SectionForm from '@/components/SectionForm.vue';
import SectionPanel from '@/components/SectionPanel.vue';
import SettingsPanel from '@/components/SettingsPanel.vue';
import Sidebar from '@/components/Sidebar.vue';
import SvgIcon from '@/components/SvgIcon.vue';
import ToastHost from '@/components/ToastHost.vue';
import WebsiteCard from '@/components/WebsiteCard.vue';
import WebsiteForm from '@/components/WebsiteForm.vue';
import { confirmAction } from '@/composables/useConfirm';
import { closeContextMenu, openContextMenu } from '@/composables/useContextMenu';
import { useCurrentPage } from '@/composables/useCurrentPage';
import { useSearchHistory } from '@/composables/useSearchHistory';
import { useSortable } from '@/composables/useSortable';
import { useNaiveTheme } from '@/composables/useNaiveTheme';
import { useAppearance } from '@/composables/useTheme';
import { toast } from '@/composables/useToast';
import {
  defaultExportFilename,
  downloadJson,
  createExportPayload,
  readFileAsText,
  serializeExport,
  validateImportText,
} from '@/services/importExport';
import { describeIntegrityReport, hasIntegrityIssues } from '@/services/navigation';
import { store } from '@/services/store';
import type { AppSettings, ContextMenuItem, NavigationPage, Section, Website } from '@/types';
import { buildSearchUrl, findSearchEngine } from '@/utils/constants';
import { openUrl } from '@/utils/url';

/* ------------------------------------------------------------------ *
 * 响应式数据源
 * ------------------------------------------------------------------ */

const settings = computed<AppSettings>(() => store.state.data.settings);
const pages = computed<NavigationPage[]>(() => store.pages());
const activePage = computed<NavigationPage | undefined>(() => store.activePage());
const sections = computed<Section[]>(() => store.sectionsOfPage(store.state.activePageId));
const allSections = computed<Section[]>(() => store.state.data.sections);
const allWebsites = computed<Website[]>(() => store.state.data.websites);
const activePageWebsites = computed<Website[]>(() =>
  allWebsites.value.filter((website) => website.pageId === store.state.activePageId),
);

const sectionCounts = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const page of pages.value) result[page.id] = store.sectionCount(page.id);
  return result;
});

const websiteCounts = computed<Record<string, number>>(() => {
  const result: Record<string, number> = {};
  for (const page of pages.value) result[page.id] = store.websiteCount(page.id);
  return result;
});

const favorites = computed(() =>
  allWebsites.value
    .filter((website) => website.favorite)
    .map((website) => ({
      website,
      pageName: store.pageById(website.pageId)?.name ?? '未知页面',
      sectionName: store.sectionById(website.sectionId)?.name ?? '未知分区',
    })),
);

const recentVisits = computed(() => store.recentVisits());
const existingWebsiteIds = computed(() => allWebsites.value.map((website) => website.id));

const integrityMessage = computed(() => {
  const report = store.state.integrity;
  if (!report || !hasIntegrityIssues(report)) return null;
  return describeIntegrityReport(report);
});

/* ------------------------------------------------------------------ *
 * 界面状态
 * ------------------------------------------------------------------ */

const sidebarCollapsed = ref(false);
const batchMode = ref(false);
const selectedIds = ref<string[]>([]);
const settingsOpen = ref(false);
const pageManagerOpen = ref(false);
const favoritesOpen = ref(false);
const usage = ref<{ bytes: number; quotaBytes: number } | null>(null);
const creatingPage = ref(false);

/** 搜索框暴露的接口（最小契约，避免依赖组件实例类型） */
interface SearchBarHandle {
  focus: () => void;
}

const searchBarRef = ref<SearchBarHandle | null>(null);
const sectionsContainer = ref<HTMLElement | null>(null);
const pageFormOpen = ref(false);
const editingPage = ref<NavigationPage | null>(null);

const sectionFormOpen = ref(false);
const editingSection = ref<Section | null>(null);

const websiteFormOpen = ref(false);
const editingWebsite = ref<Website | null>(null);
const websiteFormSectionId = ref('');
const websitePrefill = ref<{ name: string; url: string } | null>(null);

const importInput = ref<HTMLInputElement | null>(null);
const busy = ref(false);

const { readCurrentPage } = useCurrentPage();
const { clear: clearSearchHistory } = useSearchHistory();

useAppearance(settings);
const { naiveTheme, naiveOverrides } = useNaiveTheme(settings);

/* ------------------------------------------------------------------ *
 * 打开网站与记录访问
 * ------------------------------------------------------------------ */

async function openWebsite(website: Website, forceNewTab?: boolean): Promise<void> {
  const newTab = forceNewTab ?? (website.openInNewTab || settings.value.defaultOpenMode === 'newTab');
  const ok = await openUrl(website.url, newTab);
  if (!ok) {
    toast.error('无法打开该网站', '地址协议不被允许（仅支持 http/https），请在编辑中修正。');
    return;
  }
  store.recordVisit(website);
}

function openWebsiteById(id: string): void {
  const website = store.websiteById(id);
  if (!website) {
    toast.warning('该网站已被删除，无法打开。');
    return;
  }
  void openWebsite(website);
}

async function openVisitUrl(url: string, name: string): Promise<void> {
  const ok = await openUrl(url, true);
  if (!ok) {
    toast.error(`无法打开「${name}」`, '记录的地址已不再合法，可清空最近访问记录。');
  }
}

async function handleSearch(payload: { query: string; engineId: string }): Promise<void> {
  const engine = findSearchEngine(payload.engineId);
  // 网址直接打开
  if (/^https?:\/\//i.test(payload.query)) {
    const ok = await openUrl(payload.query, true);
    if (!ok) {
      toast.error('无法打开该地址', '仅支持 http/https 协议的网址。');
      return;
    }
    return;
  }
  const url = buildSearchUrl(engine, payload.query);
  const ok = await openUrl(url, true);
  if (!ok) {
    toast.error('无法发起搜索', `生成的搜索地址无效（${engine.name}），请在设置中更换搜索引擎。`);
  }
}

/* ------------------------------------------------------------------ *
 * 页面操作
 * ------------------------------------------------------------------ */

function requestCreatePage(): void {
  creatingPage.value = true;
  editingPage.value = null;
  pageFormOpen.value = true;
  if (pageManagerOpen.value) pageManagerOpen.value = false;
}

function requestEditPage(page: NavigationPage): void {
  creatingPage.value = false;
  editingPage.value = page;
  pageFormOpen.value = true;
}

async function submitPageForm(payload: { name: string; icon: string }): Promise<void> {
  if (creatingPage.value) {
    const result = await store.addPage(payload);
    pageFormOpen.value = false;
    if (result.ok) {
      toast.success(`已创建导航页面「${payload.name}」并切换过去。`);
    } else {
      toast.error('创建页面失败', result.message);
    }
    return;
  }

  const target = editingPage.value;
  if (!target) return;
  const result = await store.updatePage(target.id, payload);
  pageFormOpen.value = false;
  if (result.ok) {
    toast.success('页面已更新。');
  } else {
    toast.error('更新页面失败', result.message);
  }
}

async function renamePage(payload: { page: NavigationPage; name: string }): Promise<void> {
  const result = await store.updatePage(payload.page.id, { name: payload.name });
  if (!result.ok) toast.error('重命名失败', result.message);
}

async function removePage(page: NavigationPage): Promise<void> {
  const sectionCount = store.sectionCount(page.id);
  const websiteCount = store.websiteCount(page.id);
  const choice = await confirmAction({
    title: `删除导航页面「${page.name}」`,
    message: `该页面包含 ${sectionCount} 个分区、${websiteCount} 个网站，删除后这些数据会一并移除。`,
    detail: '该操作不可撤销。建议先在「设置 → 数据管理」中导出备份。',
    confirmText: '删除页面',
    danger: true,
  });
  if (choice !== 'confirm') return;

  const result = await store.deletePage(page.id);
  if (result.ok) {
    toast.success(result.message);
  } else {
    toast.error('删除页面失败', result.message);
  }
}

async function reorderPages(orderedIds: string[]): Promise<void> {
  const result = await store.reorderPages(orderedIds);
  if (!result.ok) toast.error('保存页面顺序失败', result.message);
}

/** 键盘替代方案：上移 / 下移页面（触屏或不便拖拽时使用） */
async function movePage(page: NavigationPage, direction: -1 | 1): Promise<void> {
  const ids = pages.value.map((item) => item.id);
  const index = ids.indexOf(page.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  await reorderPages(next);
}

/* ------------------------------------------------------------------ *
 * 分区操作
 * ------------------------------------------------------------------ */

function requestCreateSection(): void {
  editingSection.value = null;
  sectionFormOpen.value = true;
}

function requestEditSection(section: Section): void {
  editingSection.value = section;
  sectionFormOpen.value = true;
}

async function submitSectionForm(payload: { name: string; icon: string; color: string }): Promise<void> {
  const pageId = store.state.activePageId;
  if (!pageId) {
    toast.error('请先选择一个导航页面。');
    return;
  }

  if (editingSection.value) {
    const result = await store.updateSection(editingSection.value.id, payload);
    sectionFormOpen.value = false;
    if (result.ok) toast.success('分区已更新。');
    else toast.error('更新分区失败', result.message);
    return;
  }

  const result = await store.addSection(pageId, payload);
  sectionFormOpen.value = false;
  if (result.ok) toast.success(`已创建分区「${payload.name}」。`);
  else toast.error('创建分区失败', result.message);
}

async function removeSection(section: Section): Promise<void> {
  const count = store.websitesOfSection(section.id).length;

  // 空分区：直接确认删除即可
  if (count === 0) {
    const choice = await confirmAction({
      title: `删除分区「${section.name}」`,
      message: '该分区目前没有任何网站，删除后不可恢复。',
      confirmText: '删除分区',
      danger: true,
    });
    if (choice !== 'confirm') return;
    const result = await store.deleteSection(section.id, 'delete');
    if (result.ok) toast.success(result.message);
    else toast.error('删除分区失败', result.message);
    return;
  }

  // 非空分区：必须明确告知网站如何处理
  const otherSections = sections.value.filter((item) => item.id !== section.id);
  const choice = await confirmAction({
    title: `删除分区「${section.name}」`,
    message: `该分区中有 ${count} 个网站，请选择如何处理这些网站。`,
    detail: '「同时删除网站」会永久移除这些网站记录；「移动网站到其它分区」会先迁移再删除分区。',
    confirmText: '同时删除网站',
    cancelText: '取消',
    danger: true,
    ...(otherSections.length > 0
      ? {
          extraAction: {
            id: 'move',
            label: '移动网站到其它分区',
            description: '删除分区前先把网站迁移到你选择的分区',
          },
        }
      : {}),
  });

  if (choice === 'cancel') return;

  if (choice === 'extra') {
    const targetId = await pickSection({
      title: `把「${section.name}」中的 ${count} 个网站移动到哪里？`,
      sections: otherSections,
    });
    if (!targetId) return;
    const result = await store.deleteSection(section.id, 'move', targetId);
    if (result.ok) toast.success(result.message);
    else toast.error('删除分区失败', result.message);
    return;
  }

  const result = await store.deleteSection(section.id, 'delete');
  if (result.ok) toast.success(result.message);
  else toast.error('删除分区失败', result.message);
}

/**
 * 选择目标分区。
 * 分区可能跨页面，因此按页面分组展示，并提示跨页面移动会改变网站所属页面。
 */
const sectionPicker = ref<{
  open: boolean;
  title: string;
  sections: Section[];
  resolve: ((sectionId: string | null) => void) | null;
}>({ open: false, title: '', sections: [], resolve: null });

function pickSection(options: { title: string; sections: Section[] }): Promise<string | null> {
  sectionPicker.value = {
    open: true,
    title: options.title,
    sections: options.sections,
    resolve: null,
  };
  return new Promise<string | null>((resolve) => {
    sectionPicker.value = { ...sectionPicker.value, resolve };
  });
}

function resolveSectionPick(sectionId: string | null): void {
  const resolve = sectionPicker.value.resolve;
  sectionPicker.value = { ...sectionPicker.value, open: false, resolve: null };
  resolve?.(sectionId);
}

const pickerGroups = computed(() => {
  const groups: Array<{ page: NavigationPage | undefined; sections: Section[] }> = [];
  for (const page of pages.value) {
    const pageSections = sectionPicker.value.sections.filter((section) => section.pageId === page.id);
    if (pageSections.length > 0) groups.push({ page, sections: pageSections });
  }
  return groups;
});

async function toggleSection(section: Section): Promise<void> {
  const result = await store.toggleSectionCollapsed(section.id);
  if (!result.ok) toast.error('操作失败', result.message);
}

async function reorderSections(orderedIds: string[]): Promise<void> {
  const result = await store.reorderSections(store.state.activePageId, orderedIds);
  if (!result.ok) toast.error('保存分区顺序失败', result.message);
}

async function moveSection(section: Section, direction: -1 | 1): Promise<void> {
  const ids = sections.value.map((item) => item.id);
  const index = ids.indexOf(section.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  const next = [...ids];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  await reorderSections(next);
}

/* ------------------------------------------------------------------ *
 * 网站操作
 * ------------------------------------------------------------------ */

function requestCreateWebsite(section: Section): void {
  editingWebsite.value = null;
  websiteFormSectionId.value = section.id;
  websitePrefill.value = null;
  websiteFormOpen.value = true;
}

function requestEditWebsite(website: Website): void {
  editingWebsite.value = website;
  websiteFormSectionId.value = website.sectionId;
  websitePrefill.value = null;
  websiteFormOpen.value = true;
}

/** 快捷添加当前网页 */
async function quickAddCurrentPage(): Promise<void> {
  const result = await readCurrentPage();
  if (!result.ok || !result.page) {
    toast.warning('无法读取当前网页', result.message);
    // 仍然打开表单，让用户手动填写，避免"点了没反应"
    editingWebsite.value = null;
    websiteFormSectionId.value = sections.value[0]?.id ?? '';
    websitePrefill.value = null;
    websiteFormOpen.value = true;
    return;
  }

  if (sections.value.length === 0) {
    toast.warning('当前页面还没有分区', '请先创建一个分区，然后再添加网站。');
    requestCreateSection();
    return;
  }

  editingWebsite.value = null;
  websiteFormSectionId.value = sections.value[0]?.id ?? '';
  websitePrefill.value = { name: result.page.title, url: result.page.url };
  websiteFormOpen.value = true;
}

async function submitWebsiteForm(payload: {
  sectionId: string;
  data: {
    name: string;
    url: string;
    description: string;
    icon: string;
    iconType: Website['iconType'];
    openInNewTab: boolean;
  };
}): Promise<void> {
  const target = editingWebsite.value;

  if (target) {
    const result = await store.updateWebsite(target.id, {
      ...payload.data,
      sectionId: payload.sectionId,
    });
    websiteFormOpen.value = false;
    if (result.ok) toast.success('网站已更新。');
    else toast.error('更新网站失败', result.message);
    return;
  }

  const targetSection = store.sectionById(payload.sectionId);
  if (!targetSection) {
    toast.error('所属分区不存在', '该分区可能已被删除，请重新选择。');
    return;
  }

  // 同页面内重复地址提醒（允许保存，但明确告知）
  if (store.isWebsiteUrlTaken(targetSection.pageId, payload.data.url)) {
    const choice = await confirmAction({
      title: '该地址已存在',
      message: `当前页面中已经添加过「${payload.data.url}」，仍然要继续添加吗？`,
      confirmText: '仍然添加',
      cancelText: '取消',
    });
    if (choice !== 'confirm') return;
  }

  const result = await store.addWebsite(targetSection.pageId, payload.sectionId, payload.data);
  websiteFormOpen.value = false;
  if (result.ok) toast.success(`已添加网站「${payload.data.name}」。`);
  else toast.error('添加网站失败', result.message);
}

async function removeWebsite(website: Website): Promise<void> {
  const choice = await confirmAction({
    title: `删除网站「${website.name}」`,
    message: '删除后无法恢复，但不会影响同分区中的其它网站。',
    confirmText: '删除',
    danger: true,
  });
  if (choice !== 'confirm') return;

  const result = await store.deleteWebsite(website.id);
  if (result.ok) toast.success('网站已删除。');
  else toast.error('删除失败', result.message);
}

async function toggleFavorite(website: Website): Promise<void> {
  const result = await store.updateWebsite(website.id, { favorite: !website.favorite });
  if (!result.ok) toast.error('更新收藏状态失败', result.message);
}

async function moveWebsite(website: Website): Promise<void> {
  const candidates = allSections.value.filter((section) => section.id !== website.sectionId);
  if (candidates.length === 0) {
    toast.warning('没有其它分区可以接收该网站', '请先创建新的分区。');
    return;
  }
  const targetId = await pickSection({
    title: `把「${website.name}」移动到哪个分区？`,
    sections: candidates,
  });
  if (!targetId) return;

  const target = store.sectionById(targetId);
  const result = await store.moveWebsite(website.id, targetId);
  if (result.ok) {
    const crossPage = target && target.pageId !== website.pageId;
    toast.success(
      crossPage
        ? `已移动到「${target?.name}」，该分区属于其它导航页面，请切换页面查看。`
        : `已移动到「${target?.name}」。`,
    );
  } else {
    toast.error('移动失败', result.message);
  }
}

async function toggleFavoriteFromPanel(payload: { websiteId: string; favorite: boolean }): Promise<void> {
  const result = await store.setFavorite([payload.websiteId], payload.favorite);
  if (!result.ok) toast.error('更新收藏状态失败', result.message);
}

async function copyUrl(url: string, name: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(`已复制「${name}」的网址。`);
  } catch {
    // 剪贴板可能被权限策略拒绝，提供可复制的降级方案
    toast.error('复制失败', `浏览器拒绝了剪贴板访问，请手动复制：${url}`);
  }
}

async function reorderWebsites(sectionId: string, orderedIds: string[]): Promise<void> {
  const result = await store.reorderWebsites(sectionId, orderedIds);
  if (!result.ok) toast.error('保存网站顺序失败', result.message);
}

/** 网站卡片拖拽到其它分区的替代入口：键盘/菜单移动（已在 moveWebsite 实现） */

/* ------------------------------------------------------------------ *
 * 批量管理
 * ------------------------------------------------------------------ */

function toggleBatchMode(): void {
  batchMode.value = !batchMode.value;
  if (!batchMode.value) selectedIds.value = [];
}

function toggleSelect(website: Website): void {
  if (selectedIds.value.includes(website.id)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== website.id);
  } else {
    selectedIds.value = [...selectedIds.value, website.id];
  }
}

function selectAllInSection(payload: { section: Section; selected: boolean }): void {
  const ids = store.websitesOfSection(payload.section.id).map((website) => website.id);
  if (payload.selected) {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...ids]));
  } else {
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id));
  }
}

function selectAllOnPage(selected: boolean): void {
  selectedIds.value = selected ? activePageWebsites.value.map((website) => website.id) : [];
}

const selectedWebsites = computed(() =>
  allWebsites.value.filter((website) => selectedIds.value.includes(website.id)),
);

const allSelectedFavorite = computed(
  () => selectedWebsites.value.length > 0 && selectedWebsites.value.every((website) => website.favorite),
);

async function batchMove(targetSectionId: string): Promise<void> {
  if (!targetSectionId || selectedIds.value.length === 0) return;
  const target = store.sectionById(targetSectionId);
  const result = await store.moveWebsites(selectedIds.value, targetSectionId);
  if (result.ok) {
    toast.success(`已把 ${selectedIds.value.length} 个网站移动到「${target?.name}」。`);
    selectedIds.value = [];
  } else {
    toast.error('批量移动失败', result.message);
  }
}

async function batchFavorite(value: boolean): Promise<void> {
  const result = await store.setFavorite(selectedIds.value, value);
  if (result.ok) toast.success(value ? '已批量收藏。' : '已批量取消收藏。');
  else toast.error('批量操作失败', result.message);
}

async function batchOpenMode(newTab: boolean): Promise<void> {
  const result = await store.setOpenInNewTab(selectedIds.value, newTab);
  if (result.ok) toast.success(newTab ? '已设为在新标签页打开。' : '已设为在当前标签页打开。');
  else toast.error('批量操作失败', result.message);
}

async function batchDelete(): Promise<void> {
  const count = selectedIds.value.length;
  if (count === 0) return;
  const choice = await confirmAction({
    title: `批量删除 ${count} 个网站`,
    message: `即将删除已选中的 ${count} 个网站记录，删除后无法恢复。`,
    detail: '建议先导出备份；取消不会修改任何数据。',
    confirmText: `删除 ${count} 个网站`,
    danger: true,
  });
  if (choice !== 'confirm') return;

  const result = await store.deleteWebsites(selectedIds.value);
  if (result.ok) {
    toast.success(`已删除 ${count} 个网站。`);
    selectedIds.value = [];
  } else {
    toast.error('批量删除失败', result.message);
  }
}

/* ------------------------------------------------------------------ *
 * 右键菜单
 * ------------------------------------------------------------------ */

function websiteMenuItems(website: Website): ContextMenuItem[] {
  const candidates = allSections.value.filter((section) => section.id !== website.sectionId);
  return [
    {
      id: 'open-current',
      label: '在当前标签页打开',
      icon: 'external',
      onSelect: () => void openWebsite(website, false),
    },
    {
      id: 'open-new',
      label: '在新标签页打开',
      icon: 'external',
      onSelect: () => void openWebsite(website, true),
    },
    { id: 'd1', label: '', divider: true },
    { id: 'edit', label: '编辑网站', icon: 'pencil', onSelect: () => requestEditWebsite(website) },
    {
      id: 'copy',
      label: '复制网址',
      icon: 'copy',
      onSelect: () => void copyUrl(website.url, website.name),
    },
    {
      id: 'favorite',
      label: website.favorite ? '取消收藏' : '添加到收藏',
      icon: 'star',
      onSelect: () => void toggleFavorite(website),
    },
    {
      id: 'move',
      label: '移动到其它分区',
      icon: 'move',
      disabled: candidates.length === 0,
      hint: candidates.length === 0 ? '无其它分区' : undefined,
      onSelect: () => void moveWebsite(website),
    },
    { id: 'd2', label: '', divider: true },
    {
      id: 'delete',
      label: '删除网站',
      icon: 'trash',
      danger: true,
      onSelect: () => void removeWebsite(website),
    },
  ];
}

function sectionMenuItems(section: Section): ContextMenuItem[] {
  return [
    {
      id: 'add',
      label: '添加网站',
      icon: 'plus',
      onSelect: () => requestCreateWebsite(section),
    },
    { id: 'edit', label: '编辑分区', icon: 'pencil', onSelect: () => requestEditSection(section) },
    {
      id: 'collapse',
      label: section.collapsed ? '展开分区' : '折叠分区',
      icon: section.collapsed ? 'expand' : 'collapse',
      onSelect: () => void toggleSection(section),
    },
    { id: 'd1', label: '', divider: true },
    {
      id: 'up',
      label: '上移分区',
      icon: 'chevronUp',
      onSelect: () => void moveSection(section, -1),
    },
    {
      id: 'down',
      label: '下移分区',
      icon: 'chevronDown',
      onSelect: () => void moveSection(section, 1),
    },
    { id: 'd2', label: '', divider: true },
    {
      id: 'delete',
      label: '删除分区',
      icon: 'trash',
      danger: true,
      onSelect: () => void removeSection(section),
    },
  ];
}

function pageMenuItems(page: NavigationPage): ContextMenuItem[] {
  const index = pages.value.findIndex((item) => item.id === page.id);
  return [
    { id: 'create', label: '新建页面', icon: 'plus', onSelect: requestCreatePage },
    { id: 'edit', label: '重命名 / 修改图标', icon: 'pencil', onSelect: () => requestEditPage(page) },
    { id: 'd1', label: '', divider: true },
    {
      id: 'up',
      label: '上移页面',
      icon: 'chevronUp',
      disabled: index <= 0,
      onSelect: () => void movePage(page, -1),
    },
    {
      id: 'down',
      label: '下移页面',
      icon: 'chevronDown',
      disabled: index >= pages.value.length - 1,
      onSelect: () => void movePage(page, 1),
    },
    {
      id: 'manage',
      label: '进入页面管理',
      icon: 'layers',
      onSelect: () => {
        pageManagerOpen.value = true;
      },
    },
    { id: 'd2', label: '', divider: true },
    {
      id: 'delete',
      label: '删除页面',
      icon: 'trash',
      danger: true,
      disabled: pages.value.length <= 1,
      hint: pages.value.length <= 1 ? '至少保留一个页面' : undefined,
      onSelect: () => void removePage(page),
    },
  ];
}

function showMenu(event: MouseEvent, items: ContextMenuItem[], title?: string): void {
  if (!settings.value.contextMenuEnabled) return;
  openContextMenu({
    items,
    x: event.clientX,
    y: event.clientY,
    title,
    trigger: event.currentTarget instanceof HTMLElement ? event.currentTarget : null,
  });
}

function onWebsiteContextMenu(payload: { website: Website; event: MouseEvent }): void {
  showMenu(payload.event, websiteMenuItems(payload.website), payload.website.name);
}

function onSectionContextMenu(payload: { section: Section; event: MouseEvent }): void {
  showMenu(payload.event, sectionMenuItems(payload.section), payload.section.name);
}

function onPageContextMenu(payload: { page: NavigationPage; event: MouseEvent }): void {
  showMenu(payload.event, pageMenuItems(payload.page), payload.page.name);
}

/** 「更多操作」按钮：把菜单定位到按钮下方 */
function onActionsMenu(payload: { section?: Section; page?: NavigationPage; event: MouseEvent }): void {
  const target = payload.event.currentTarget;
  const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
  const items = payload.section
    ? sectionMenuItems(payload.section)
    : payload.page
      ? pageMenuItems(payload.page)
      : [];
  if (items.length === 0) return;
  openContextMenu({
    items,
    x: rect ? rect.right - 180 : payload.event.clientX,
    y: rect ? rect.bottom + 4 : payload.event.clientY,
    title: payload.section?.name ?? payload.page?.name ?? '',
    trigger: target instanceof HTMLElement ? target : null,
  });
}

/* ------------------------------------------------------------------ *
 * 设置与数据管理
 * ------------------------------------------------------------------ */

async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const result = await store.updateSettings(patch);
  if (!result.ok) toast.error('保存设置失败', result.message);
}

async function refreshUsage(): Promise<void> {
  const result = await store.estimateUsage();
  usage.value = result.ok && result.data ? result.data : null;
}

async function openSettings(): Promise<void> {
  settingsOpen.value = true;
  await refreshUsage();
}

async function exportConfig(options: { includeRecentVisits: boolean }): Promise<void> {
  const payload = createExportPayload(store.snapshot(), options);
  const text = serializeExport(payload);
  downloadJson(defaultExportFilename(), text);
  toast.success(
    options.includeRecentVisits ? '已导出完整配置（含最近访问记录）。' : '已导出配置（不含最近访问记录）。',
    `共 ${payload.data.pages.length} 个页面、${payload.data.websites.length} 个网站。`,
  );
}

function pickImportFile(): void {
  importInput.value?.click();
}

async function onImportFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  busy.value = true;
  try {
    const read = await readFileAsText(file);
    if (!read.ok) {
      toast.error('无法读取文件', read.message);
      return;
    }

    const validation = validateImportText(read.text);
    if (!validation.ok || !validation.state || !validation.stats) {
      toast.error('导入已取消', validation.message);
      return;
    }

    const stats = validation.stats;
    const warningText = validation.warnings.length
      ? `\n\n注意事项：\n· ${validation.warnings.slice(0, 5).join('\n· ')}`
      : '';

    const choice = await confirmAction({
      title: '导入配置',
      message: `即将用备份覆盖当前配置：${stats.pages} 个页面、${stats.sections} 个分区、${stats.websites} 个网站。\n当前配置将被替换，操作不可撤销。${warningText}`,
      detail: '建议先导出当前配置作为备份。',
      confirmText: '覆盖导入',
      danger: true,
    });
    if (choice !== 'confirm') return;

    const result = await store.replaceState(validation.state, { markImported: true, force: true });
    if (result.ok) {
      toast.success('导入成功。', validation.warnings[0] ?? `已载入 ${stats.websites} 个网站。`);
      await refreshUsage();
    } else {
      toast.error('导入失败，现有数据未改动', result.message);
    }
  } finally {
    busy.value = false;
  }
}

async function restoreDefaults(): Promise<void> {
  const choice = await confirmAction({
    title: '恢复默认配置',
    message: '将用内置演示数据替换当前所有页面、分区与网站。',
    detail: '当前配置会被覆盖，建议先导出备份。设置（主题、搜索引擎等）保持不变。',
    confirmText: '恢复默认',
    danger: true,
  });
  if (choice !== 'confirm') return;

  const result = await store.restoreDefaults();
  if (result.ok) {
    toast.success('已恢复默认配置。');
    await refreshUsage();
  } else {
    toast.error('恢复默认失败', result.message);
  }
}

async function clearAllData(): Promise<void> {
  const choice = await confirmAction({
    title: '清空全部导航数据',
    message: '将删除所有导航页面、分区与网站，清空后无法恢复。',
    detail: '设置项会保留。强烈建议先导出备份。',
    confirmText: '确认清空',
    danger: true,
  });
  if (choice !== 'confirm') return;

  const result = await store.clearNavigationData();
  if (result.ok) {
    toast.success('导航数据已清空。', '可以在任意页面下新建分区并重新添加网站。');
    await refreshUsage();
  } else {
    toast.error('清空失败', result.message);
  }
}

async function clearRecentVisits(): Promise<void> {
  const choice = await confirmAction({
    title: '清空最近访问记录',
    message: `将删除 ${recentVisits.value.length} 条最近访问记录，不影响网站卡片本身。`,
    confirmText: '清空记录',
  });
  if (choice !== 'confirm') return;
  const result = await store.clearRecentVisits();
  if (result.ok) toast.success('最近访问记录已清空。');
  else toast.error('清空失败', result.message);
}

async function clearAllSearchHistory(): Promise<void> {
  const choice = await confirmAction({
    title: '清空搜索历史',
    message: '将删除本地保存的全部搜索关键词记录。',
    confirmText: '清空历史',
  });
  if (choice !== 'confirm') return;
  await clearSearchHistory();
  toast.success('搜索历史已清空。');
}

async function selectPage(pageId: string): Promise<void> {
  await store.setActivePage(pageId);
}

/**
 * 重新从本地存储读取配置。
 * 用于存储读取失败（例如扩展刚更新、存储被占用）后不刷新页面即可重试。
 */
async function reloadFromStorage(): Promise<void> {
  await store.reload();
  if (store.state.errorMessage) {
    toast.error('仍然无法读取本地配置', store.state.errorMessage);
    return;
  }
  toast.success('已重新读取本地配置。');
  await refreshUsage();
}

/* ------------------------------------------------------------------ *
 * 排序（SortableJS）
 * ------------------------------------------------------------------ */

useSortable({
  container: sectionsContainer,
  // 只允许拖动分区本身，避免与外层/内层卡片网格的拖拽冲突
  draggable: '.section-panel',
  handle: '.section-panel__header',
  order: () => sections.value.map((section) => section.id),
  onReorder: (ids) => void reorderSections(ids),
});

/* ------------------------------------------------------------------ *
 * 快捷键
 * ------------------------------------------------------------------ */

function onKeydown(event: KeyboardEvent): void {
  const target = event.target;
  const isTyping =
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

  if (!settings.value.shortcutsEnabled) return;

  // Ctrl/⌘ + K：聚焦搜索
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchBarRef.value?.focus();
    return;
  }

  // Ctrl/⌘ + B：显示/隐藏导航栏
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
    event.preventDefault();
    sidebarCollapsed.value = !sidebarCollapsed.value;
    return;
  }

  if (isTyping) return;

  // /：聚焦搜索
  if (event.key === '/') {
    event.preventDefault();
    searchBarRef.value?.focus();
    return;
  }

  // Esc：退出批量模式 / 关闭浮层
  if (event.key === 'Escape') {
    closeContextMenu();
    if (batchMode.value) {
      batchMode.value = false;
      selectedIds.value = [];
    }
  }

  // Ctrl/⌘ + A：批量模式下全选
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && batchMode.value) {
    event.preventDefault();
    selectAllOnPage(true);
  }
}

/* ------------------------------------------------------------------ *
 * 组件状态检测
 * ------------------------------------------------------------------ */

const isNarrow = ref(false);
let resizeObserver: (() => void) | null = null;

function updateNarrow(): void {
  isNarrow.value = window.innerWidth < 760;
}

onMounted(() => {
  updateNarrow();
  window.addEventListener('resize', updateNarrow);
  document.addEventListener('keydown', onKeydown);
  resizeObserver = () => window.removeEventListener('resize', updateNarrow);
  void refreshUsage();

  if (store.state.errorMessage) {
    toast.error('本地存储出现问题', store.state.errorMessage);
  }
  if (integrityMessage.value) {
    toast.warning('数据已自动修复', integrityMessage.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.();
  document.removeEventListener('keydown', onKeydown);
  closeContextMenu();
});
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="naiveOverrides" :locale="zhCN">
    <div
      class="app"
      :class="{ 'app--narrow': isNarrow, 'app--sidebar-left': settings.sidebarPosition === 'left' }"
      :data-sidebar-position="settings.sidebarPosition"
    >
    <!--
      侧边栏放在 DOM 的第一位，通过容器上的 flex-direction: row-reverse
      把它视觉上移到右侧。这样切换左右布局时组件不会重建，
      拖拽实例（SortableJS）与折叠状态都能保持。
    -->
    <Sidebar
      :pages="pages"
      :active-page-id="store.state.activePageId"
      :section-counts="sectionCounts"
      :website-counts="websiteCounts"
      :collapsed="sidebarCollapsed"
      :position="settings.sidebarPosition"
      @select="selectPage"
      @create-page="requestCreatePage"
      @rename="renamePage"
      @edit-page="requestEditPage"
      @remove-page="removePage"
      @manage-pages="pageManagerOpen = true"
      @open-settings="openSettings"
      @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
      @context-menu="onPageContextMenu"
      @open-actions-menu="onActionsMenu"
    />

    <main class="app__main">
      <header class="app__toolbar">
        <div class="app__brand" :title="`My Navi · 本地导航工作台（数据保存在 ${store.info.backend}）`">
          <span class="app__logo">
            <SvgIcon name="grid" :size="18" filled />
          </span>
          <span class="app__brand-text">
            <strong>My Navi</strong>
            <small>数据保存在本地 · 不联网同步</small>
          </span>
        </div>

        <div class="app__search">
          <SearchBar
            ref="searchBarRef"
            :nav-state="store.state.data"
            :default-engine-id="settings.defaultSearchEngine"
            :history-enabled="settings.searchHistoryEnabled"
            :shortcuts-enabled="settings.shortcutsEnabled"
            @open="openWebsiteById"
            @search="handleSearch"
            @quick-add="quickAddCurrentPage"
          />
        </div>

        <div class="app__tools">
          <div class="app__tool-wrapper">
            <button
              type="button"
              class="btn btn--default btn--sm"
              :aria-expanded="favoritesOpen"
              aria-haspopup="true"
              title="收藏与最近访问"
              @click="favoritesOpen = !favoritesOpen"
            >
              <SvgIcon name="star" :size="15" />
              收藏 / 最近
              <span v-if="favorites.length" class="badge badge--brand">{{ favorites.length }}</span>
            </button>
            <div v-if="favoritesOpen" class="app__popover">
              <FavoritesRecentPanel
                :favorites="favorites"
                :recent-visits="recentVisits"
                :recent-enabled="settings.recentVisitsEnabled"
                :existing-website-ids="existingWebsiteIds"
                @open="openWebsiteById"
                @open-url="(payload) => openVisitUrl(payload.url, payload.name)"
                @clear-recent="clearRecentVisits"
                @set-favorite="toggleFavoriteFromPanel"
              />
            </div>
          </div>

          <button
            type="button"
            class="btn btn--default btn--sm"
            :class="{ 'btn--active': batchMode }"
            title="批量管理网站"
            @click="toggleBatchMode"
          >
            <SvgIcon name="check" :size="15" />
            批量
          </button>

          <button type="button" class="btn btn--default btn--sm" title="新建分区" @click="requestCreateSection">
            <SvgIcon name="plus" :size="15" />
            新分区
          </button>

          <button type="button" class="btn btn--primary btn--sm" title="新增网站" @click="quickAddCurrentPage">
            <SvgIcon name="plus" :size="15" />
            添加网站
          </button>
        </div>
      </header>

      <div class="app__scroll">
        <div class="app__content">
          <div v-if="!store.state.ready" class="app__loading">
            <SvgIcon name="refresh" :size="18" />
            <span>正在读取本地配置…</span>
          </div>

          <template v-else>
            <div v-if="store.state.errorMessage" class="app__banner app__banner--error">
              <SvgIcon name="warning" :size="15" />
              <span>{{ store.state.errorMessage }}</span>
              <button type="button" class="btn btn--default btn--sm" @click="reloadFromStorage">
                <SvgIcon name="refresh" :size="14" />
                重新读取
              </button>
              <button type="button" class="btn btn--text btn--sm" @click="store.clearError()">知道了</button>
            </div>

            <div v-if="integrityMessage" class="app__banner app__banner--warning">
              <SvgIcon name="info" :size="15" />
              <span>{{ integrityMessage }}</span>
            </div>

            <BatchActionBar
              v-if="batchMode"
              :selected-count="selectedIds.length"
              :sections="sections"
              :total="activePageWebsites.length"
              :all-favorite="allSelectedFavorite"
              @select-all="selectAllOnPage"
              @move-to="batchMove"
              @favorite="batchFavorite"
              @open-mode="batchOpenMode"
              @remove="batchDelete"
              @exit="toggleBatchMode"
            />

            <header class="app__page-header">
              <div class="app__page-title">
                <span class="app__page-icon">
                  <SvgIcon :name="activePage?.icon ?? 'grid'" :size="18" />
                </span>
                <h1>{{ activePage?.name ?? '未选择页面' }}</h1>
                <span class="badge">{{ sections.length }} 个分区</span>
                <span class="badge badge--brand">{{ activePageWebsites.length }} 个网站</span>
              </div>
              <div class="app__page-actions">
                <button type="button" class="btn btn--default btn--sm" @click="requestCreateSection">
                  <SvgIcon name="plus" :size="14" />
                  新建分区
                </button>
              </div>
            </header>

            <!-- 还没有任何页面 -->
            <div v-if="pages.length === 0" class="app__empty app__empty--large">
              <SvgIcon name="layers" :size="24" />
              <h2>还没有导航页面</h2>
              <p>创建一个导航页面来开始整理你的常用网站。</p>
              <div class="app__empty-actions">
                <button type="button" class="btn btn--primary" @click="requestCreatePage">
                  <SvgIcon name="plus" :size="15" />
                  新建导航页面
                </button>
                <button type="button" class="btn btn--default" @click="restoreDefaults">
                  <SvgIcon name="refresh" :size="15" />
                  恢复默认演示数据
                </button>
              </div>
            </div>

            <!-- 页面存在但没有分区 -->
            <div v-else-if="sections.length === 0" class="app__empty app__empty--large">
              <SvgIcon name="folder" :size="24" />
              <h2>「{{ activePage?.name }}」还没有分区</h2>
              <p>分区用于把网站按用途归类，例如「开发环境」「威胁情报」。</p>
              <button type="button" class="btn btn--primary" @click="requestCreateSection">
                <SvgIcon name="plus" :size="15" />
                新建分区
              </button>
            </div>

            <!-- 分区列表（可拖拽排序） -->
            <div v-else ref="sectionsContainer" class="app__sections">
              <SectionPanel
                v-for="section in sections"
                :key="`${section.id}:${settings.showDescription}:${settings.remoteFavicon}`"
                :section="section"
                :websites="store.websitesOfSection(section.id)"
                :selected-ids="selectedIds"
                :batch-mode="batchMode"
                @toggle-collapse="toggleSection"
                @edit-section="requestEditSection"
                @remove="removeSection"
                @add-website="requestCreateWebsite"
                @context-menu="onSectionContextMenu"
                @open-actions-menu="onActionsMenu"
                @select-all="selectAllInSection"
                @reorder="(ids) => reorderWebsites(section.id, ids)"
              >
                <template #websites>
                  <WebsiteCard
                    v-for="website in store.websitesOfSection(section.id)"
                    :key="website.id"
                    :website="website"
                    :batch-mode="batchMode"
                    :selected="selectedIds.includes(website.id)"
                    :show-description="settings.showDescription"
                    :remote-favicon="settings.remoteFavicon"
                    @open="openWebsite"
                    @edit="requestEditWebsite"
                    @remove="removeWebsite"
                    @favorite="toggleFavorite"
                    @move="moveWebsite"
                    @context-menu="onWebsiteContextMenu"
                    @toggle-select="toggleSelect"
                  />
                </template>
              </SectionPanel>
            </div>
          </template>
        </div>
      </div>
    </main>

    <!-- 弹窗 -->
    <PageForm
      v-model="pageFormOpen"
      :page="editingPage"
      :sibling-names="pages.map((page) => page.name)"
      @submit="submitPageForm"
    />

    <PageManagerModal
      v-model="pageManagerOpen"
      :pages="pages"
      :active-page-id="store.state.activePageId"
      :section-counts="sectionCounts"
      :website-counts="websiteCounts"
      @select="selectPage"
      @create-page="requestCreatePage"
      @edit-page="requestEditPage"
      @remove-page="removePage"
      @reorder="reorderPages"
    />

    <SectionForm
      v-model="sectionFormOpen"
      :section="editingSection"
      :sibling-names="sections.map((section) => section.name)"
      @submit="submitSectionForm"
    />

    <WebsiteForm
      v-model="websiteFormOpen"
      :website="editingWebsite"
      :page-id="store.state.activePageId"
      :sections="sections"
      :default-section-id="websiteFormSectionId"
      :default-open-in-new-tab="settings.defaultOpenMode === 'newTab'"
      :prefill="websitePrefill"
      @submit="submitWebsiteForm"
    />

    <SettingsPanel
      v-model="settingsOpen"
      :settings="settings"
      :stats="{
        pages: pages.length,
        sections: allSections.length,
        websites: allWebsites.length,
        recentVisits: recentVisits.length,
      }"
      :usage="usage"
      :backend="store.info.backend"
      :extension-context="store.info.extensionContext"
      :integrity-message="integrityMessage"
      @change="updateSettings"
      @export="exportConfig"
      @pick-import="pickImportFile"
      @restore-defaults="restoreDefaults"
      @clear-data="clearAllData"
      @clear-recent="clearRecentVisits"
      @clear-search-history="clearAllSearchHistory"
    />

    <!-- 分区选择器（移动网站 / 删除分区时迁移网站） -->
    <div v-if="sectionPicker.open" class="picker-mask" @click.self="resolveSectionPick(null)">
      <div class="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
        <header class="picker__header">
          <h2 id="picker-title" class="picker__title">{{ sectionPicker.title }}</h2>
          <button
            type="button"
            class="icon-btn"
            aria-label="取消"
            title="取消（Esc）"
            @click="resolveSectionPick(null)"
          >
            <SvgIcon name="close" :size="16" />
          </button>
        </header>
        <div class="picker__body">
          <p v-if="pickerGroups.length === 0" class="picker__empty">没有可用的目标分区。</p>
          <div v-for="group in pickerGroups" :key="group.page?.id ?? 'unknown'" class="picker__group">
            <p class="picker__group-title">{{ group.page?.name ?? '未知页面' }}</p>
            <button
              v-for="item in group.sections"
              :key="item.id"
              type="button"
              class="picker__option"
              @click="resolveSectionPick(item.id)"
            >
              <span class="picker__option-icon" :style="{ color: item.color }">
                <SvgIcon :name="item.icon" :size="15" />
              </span>
              <span class="picker__option-name">{{ item.name }}</span>
              <span class="picker__option-meta">
                {{ store.websitesOfSection(item.id).length }} 个网站
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 隐藏的文件选择器：导入配置 -->
    <input
      ref="importInput"
      class="sr-only"
      type="file"
      accept="application/json,.json"
      aria-label="选择要导入的配置文件"
      @change="onImportFileChange"
    />

    <ContextMenu />
    <ConfirmDialog />
    <ToastHost />
  </div>
  </NConfigProvider>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: row-reverse;
  height: 100vh;
  overflow: hidden;
}

/* 侧边栏默认在右侧；设置为左侧时取消反向排列 */
.app[data-sidebar-position='left'] {
  flex-direction: row;
}

.app__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.app__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  background: var(--bg-app-bar);
  border-bottom: 1px solid var(--border-color);
  backdrop-filter: blur(8px);
}

.app__brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

/*
 * 导航栏在左侧时，侧边栏顶部已经展示了品牌信息，
 * 这里只保留图标，避免同一屏出现两处「My Navi」。
 */
.app--sidebar-left .app__brand-text {
  display: none;
}

.app__logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  background: var(--brand-600);
  color: #fff;
}

.app__brand-text {
  display: flex;
  flex-direction: column;
}

.app__brand-text strong {
  font-size: var(--font-base);
  color: var(--text-primary);
}

.app__brand-text small {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.app__search {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
}

.app__tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

/* 搜索栏在窄屏下换行显示更合适 */
@media (max-width: 1180px) {
  .app__search {
    order: 3;
    flex-basis: 100%;
  }

  .app__toolbar {
    flex-wrap: wrap;
  }
}

/* 更窄时改为竖向堆叠：侧边栏放到工具栏下方独占一行（左右位置设置不再影响视觉效果） */
@media (max-width: 760px) {
  .app,
  .app[data-sidebar-position='left'] {
    flex-direction: column;
  }

  .app__main {
    order: 1;
    min-height: 0;
  }

  .app :deep(.sidebar) {
    height: auto;
    flex: none;
  }
}

.app__tool-wrapper {
  position: relative;
}

.app__popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
}

.btn--active {
  border-color: var(--brand-400);
  color: var(--brand-600);
  background: var(--brand-50);
}

.app__scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.app__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: var(--space-5);
  width: 100%;
}

.app__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-8);
  color: var(--text-tertiary);
}

.app__banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.app__banner--error {
  background: var(--color-danger-bg);
  color: var(--color-danger);
}

.app__banner--warning {
  background: var(--color-warning-bg);
  color: var(--color-warning);
}

.app__banner span {
  flex: 1;
}

.app__page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.app__page-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.app__page-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-sm);
  background: var(--bg-active);
  color: var(--brand-600);
}

.app__page-title h1 {
  font-size: var(--font-xl);
  font-weight: 600;
}

.app__sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.app__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-6);
  color: var(--text-tertiary);
  background: var(--bg-panel-translucent);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  text-align: center;
}

.app__empty h2 {
  font-size: var(--font-lg);
  color: var(--text-primary);
}

.app__empty p {
  font-size: var(--font-base);
  max-width: 420px;
}

.app__empty-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
  flex-wrap: wrap;
  justify-content: center;
}

/* 分区选择器 */
.picker-mask {
  position: fixed;
  inset: 0;
  z-index: 1500;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-overlay);
}

.picker {
  width: min(460px, calc(100vw - 32px));
  max-height: min(70vh, 520px);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-color);
}

.picker__title {
  font-size: var(--font-base);
  font-weight: 600;
}

.picker__body {
  padding: var(--space-2);
  overflow-y: auto;
}

.picker__group + .picker__group {
  margin-top: var(--space-2);
}

.picker__group-title {
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.picker__option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: left;
}

.picker__option:hover {
  background: var(--bg-hover);
}

.picker__option-icon {
  display: flex;
  align-items: center;
  flex: none;
}

.picker__option-name {
  flex: 1;
}

.picker__option-meta {
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

.picker__empty {
  padding: var(--space-4);
  text-align: center;
  font-size: var(--font-sm);
  color: var(--text-tertiary);
}

@media (max-width: 1100px) {
  .app__toolbar {
    flex-wrap: wrap;
  }

  .app__brand-text {
    display: none;
  }
}

@media (max-width: 760px) {
  .app__toolbar {
    padding: var(--space-3);
  }

  .app__tools {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .app__content {
    padding: var(--space-3);
  }
}
</style>
