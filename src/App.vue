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
import PageForm from '@/components/PageForm.vue';
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
import { CREATION_LIMITS, buildSearchUrl, findSearchEngine } from '@/utils/constants';
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

const integrityMessage = computed(() => {
  const report = store.state.integrity;
  if (!report || !hasIntegrityIssues(report)) return null;
  return describeIntegrityReport(report);
});

/* ------------------------------------------------------------------ *
 * 界面状态
 * ------------------------------------------------------------------ */

const batchMode = ref(false);
const selectedIds = ref<string[]>([]);
const settingsOpen = ref(false);
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
  }
}

function openWebsiteById(id: string): void {
  const website = store.websiteById(id);
  if (!website) {
    toast.warning('该网站已被删除，无法打开。');
    return;
  }
  void openWebsite(website);
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

/**
 * 新建分区。
 *
 * 传 pageId 用于「在侧栏右键某个页面 → 新建分区」：先切到目标页面再弹表单，
 * 建完立刻能看到结果（与「新建页面后自动切换」是同一套约定）。
 * 注意模板里必须写成 `requestCreateSection()`——直接写方法名会把 MouseEvent 当成 pageId。
 */
async function requestCreateSection(pageId?: string): Promise<void> {
  // 容错：模板里漏写括号（`@click="requestCreateSection"`）会把 MouseEvent 传进来
  const target = typeof pageId === 'string' && pageId ? pageId : store.state.activePageId;
  if (store.sectionCount(target) >= CREATION_LIMITS.maxSectionsPerPage) {
    toast.error(
      '无法新建分区',
      `每个导航页面最多 ${CREATION_LIMITS.maxSectionsPerPage} 个分区，请先删除一个再新建。`,
    );
    return;
  }
  if (target && target !== store.state.activePageId) {
    await selectPage(target);
  }
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
  if (store.websitesOfSection(section.id).length >= CREATION_LIMITS.maxWebsitesPerSection) {
    toast.error(
      '无法添加网站',
      `每个分区最多 ${CREATION_LIMITS.maxWebsitesPerSection} 个网站，请先删除或移走一些。`,
    );
    return;
  }
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
  const websiteCount = store.websitesOfSection(section.id).length;
  const sectionCount = store.sectionCount(section.pageId);
  return [
    {
      id: 'add',
      label: '添加网站',
      icon: 'plus',
      disabled: websiteCount >= CREATION_LIMITS.maxWebsitesPerSection,
      hint:
        websiteCount >= CREATION_LIMITS.maxWebsitesPerSection
          ? `每区最多 ${CREATION_LIMITS.maxWebsitesPerSection} 个`
          : undefined,
      onSelect: () => requestCreateWebsite(section),
    },
    {
      // 顶栏「添加」菜单移除后，非空页面的新建分区入口收敛到这里（右键 + 更多菜单共用）
      id: 'create-section',
      label: '新建分区',
      icon: 'grid',
      disabled: sectionCount >= CREATION_LIMITS.maxSectionsPerPage,
      hint:
        sectionCount >= CREATION_LIMITS.maxSectionsPerPage
          ? `每页最多 ${CREATION_LIMITS.maxSectionsPerPage} 个`
          : undefined,
      onSelect: () => void requestCreateSection(),
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
  const sectionCount = sectionCounts.value[page.id] ?? 0;
  return [
    { id: 'create', label: '新建页面', icon: 'plus', onSelect: requestCreatePage },
    {
      // 侧栏任意页面都能就地新建分区：目标页面此时可能不是当前页，交给 requestCreateSection 切过去
      id: 'create-section',
      label: '新建分区',
      icon: 'grid',
      disabled: sectionCount >= CREATION_LIMITS.maxSectionsPerPage,
      hint:
        sectionCount >= CREATION_LIMITS.maxSectionsPerPage
          ? `每页最多 ${CREATION_LIMITS.maxSectionsPerPage} 个分区`
          : undefined,
      onSelect: () => void requestCreateSection(page.id),
    },
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

async function exportConfig(): Promise<void> {
  const payload = createExportPayload(store.snapshot(), { includeRecentVisits: false });
  const text = serializeExport(payload);
  downloadJson(defaultExportFilename(), text);
  toast.success(
    '已导出配置。',
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
  // 常规入口（侧栏点击等）无方向语义，用淡入淡出
  pageTransition.value = 'page-fade';
  await store.setActivePage(pageId);
}

/** 滚轮切换：带方向感的过渡（下一页自下而上进入，上一页反向） */
async function switchPage(pageId: string, direction: 'forward' | 'back'): Promise<void> {
  pageTransition.value = direction === 'forward' ? 'page-forward' : 'page-back';
  await store.setActivePage(pageId);
}

/* ------------------------------------------------------------------ *
 * 侧边栏自动隐藏
 * ------------------------------------------------------------------ */

/**
 * 侧边栏只有两种形态，永远不存在「彻底消失」的状态：
 * - sidebarAutoHide=false：常驻显示（占据布局宽度）；
 * - sidebarAutoHide=true：默认收起，鼠标靠近 sidebarPosition 一侧的
 *   屏幕边缘时悬浮呼出，远离后收回——不占布局宽度。
 * 历史 setting sidebarVisible 不再参与显示逻辑（其「隐藏」语义会与
 * 收起后的侧栏互锁：设置入口就在侧栏里，隐藏后无法再打开）。
 */
const sidebarAutoHide = computed(() => settings.value.sidebarAutoHide);

/** 自动隐藏模式下侧边栏的呼出状态（由全局鼠标坐标判定驱动） */
const sidebarPeek = ref(false);

/** 距屏幕侧缘多少像素内开始呼出 */
const SIDEBAR_PEEK_THRESHOLD = 24;

/** 侧栏宽度（--sidebar-width）+ 缓冲：超过该距离视为「离开侧栏」 */
const SIDEBAR_PEEK_HOLD = 200;

/**
 * 全局 mousemove 坐标判定：不依赖元素级 hover（热区/侧栏的 hit-testing
 * 受层叠与遮挡影响），鼠标坐标靠近对应侧缘即呼出，绝对可靠。
 * 拖拽排序期间不收回——侧栏中途消失会打断 SortableJS。
 */
function onDocumentMouseMove(event: MouseEvent): void {
  if (!sidebarAutoHide.value) return;
  const fromEdge = settings.value.sidebarPosition === 'left'
    ? event.clientX
    : window.innerWidth - event.clientX;
  if (fromEdge <= SIDEBAR_PEEK_THRESHOLD) {
    sidebarPeek.value = true;
    return;
  }
  if (document.body.classList.contains('is-dragging')) return;
  if (fromEdge >= SIDEBAR_PEEK_HOLD) sidebarPeek.value = false;
}

/* ------------------------------------------------------------------ *
 * 顶部工具栏
 *
 * 操作入口刻意收敛：顶栏右侧只剩「批量管理」一个图标动作。
 * 添加网站走各分区底部的常驻按钮；新建分区走分区「更多」菜单；
 * 收藏 / 最近访问的入口在侧边栏底部（sidebar__tool）。
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 滚轮切换导航页面与切换动画
 * ------------------------------------------------------------------ */

/**
 * 整个页面（内容区、侧边栏）滚动鼠标滚轮即切换导航页面：
 * 向下 = 下一页、向上 = 上一页（循环）。这是侧边栏收起时通用的快速切换方式。
 * 滚轮手势整体让给页面切换：内容超屏时用滚动条浏览，滚轮不再滚动内容。
 * 弹窗与浮层（设置等）渲染在 .app__main / .sidebar
 * 之外，落在其中的滚轮不切换，留给浮层自身的列表滚动。
 * 冷却 250ms：一格滚轮（尤其触控板惯性）会连续触发多次 wheel 事件。
 */
let wheelLocked = false;

/** 页面切换过渡名：滚轮按方向取 page-forward / page-back，其余入口 page-fade */
const pageTransition = ref('page-fade');

function onDocumentWheel(event: WheelEvent): void {
  if (pages.value.length < 2 || wheelLocked) return;
  if (Math.abs(event.deltaY) < 10) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('.app__main, .sidebar')) return;
  if (document.body.classList.contains('is-dragging')) return;

  // 阻止内容区 / 侧栏列表随之滚动：切页后内容会重置回顶部，滚动没有意义
  event.preventDefault();

  wheelLocked = true;
  window.setTimeout(() => {
    wheelLocked = false;
  }, 250);

  const ids = pages.value.map((page) => page.id);
  const index = ids.indexOf(store.state.activePageId);
  if (index < 0) return;
  const next = (index + (event.deltaY > 0 ? 1 : -1) + ids.length) % ids.length;
  const nextId = ids[next];
  if (nextId) void switchPage(nextId, event.deltaY > 0 ? 'forward' : 'back');
}

/** 新页面内容进场前滚回顶部：从长页面切走时不该停留在半截位置 */
const scrollContainer = ref<HTMLElement | null>(null);

function resetScrollTop(): void {
  if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
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
  // 只允许拖动分区本身，避免与外层/内层列表的拖拽冲突
  draggable: '.section-panel',
  // 手柄限定为专用元素：用整个 header 会让标题栏里的按钮点击被拖拽吃掉
  handle: '.section-panel__grip',
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

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  // passive: false：document 级 wheel 默认被动，需显式声明才能 preventDefault
  document.addEventListener('wheel', onDocumentWheel, { passive: false });
  document.addEventListener('mousemove', onDocumentMouseMove);
  void refreshUsage();

  if (store.state.errorMessage) {
    toast.error('本地存储出现问题', store.state.errorMessage);
  }
  if (integrityMessage.value) {
    toast.warning('数据已自动修复', integrityMessage.value);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
  document.removeEventListener('wheel', onDocumentWheel);
  document.removeEventListener('mousemove', onDocumentMouseMove);
  closeContextMenu();
});
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="naiveOverrides" :locale="zhCN">
    <div
      class="app"
      :class="{
        'app--sidebar-autohide': sidebarAutoHide,
        'app--sidebar-peek': sidebarAutoHide && sidebarPeek,
      }"
      :data-sidebar-position="settings.sidebarPosition"
    >
    <!--
      侧边栏放在 DOM 的第一位，通过容器上的 flex-direction: row-reverse
      把它视觉上移到右侧。这样切换左右布局时组件不会重建，
      拖拽实例（SortableJS）与滚动位置都能保持。
      自动隐藏模式下侧边栏改为悬浮定位（仍不重建组件），呼出状态由
      全局 mousemove 坐标判定驱动（见 onDocumentMouseMove）。
      绝不能调整这里的子元素顺序——否则 Vue 会按下标复用，
      把 Sidebar 与 main 一起重建。
    -->
    <Sidebar
      :pages="pages"
      :active-page-id="store.state.activePageId"
      :section-counts="sectionCounts"
      :website-counts="websiteCounts"
      :position="settings.sidebarPosition"
      @select="selectPage"
      @rename="renamePage"
      @edit-page="requestEditPage"
      @remove-page="removePage"
      @open-settings="openSettings"
      @reorder="reorderPages"
      @context-menu="onPageContextMenu"
      @open-actions-menu="onActionsMenu"
    />

    <main class="app__main">
      <!--
        没有独立顶栏：整个视口就是一页内容，搜索框悬浮在内容顶部居中，
        侧边栏常驻于一侧（自动隐藏模式下悬浮呼出、不占布局宽度）。
      -->
      <div ref="scrollContainer" class="app__scroll">
        <div class="app__content">
          <!-- 搜索区：页面内容的第一行，居中悬浮 -->
          <div class="app__search">
            <SearchBar
              ref="searchBarRef"
              :nav-state="store.state.data"
              :default-engine-id="settings.defaultSearchEngine"
              :history-enabled="settings.searchHistoryEnabled"
              @open="openWebsiteById"
              @search="handleSearch"
            />
          </div>

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

            <!--
              页面切换动画：滚轮切换带方向（下一页自下而上、上一页反向），
              侧栏点击等其它入口淡入淡出。out-in 模式下旧页面先离场、
              新页面再进场，任一时刻只有一个分区拖拽容器，useSortable
              的容器 ref 随之销毁重建（其内部 watch 已处理该时序）。
              进场前先把内容滚回顶部（resetScrollTop）。
            -->
            <Transition :name="pageTransition" mode="out-in" @before-enter="resetScrollTop">
              <div :key="store.state.activePageId" class="app__page">
                <!--
                  页面标题区。
                  必须放在 .app__sections 之外：分区拖拽容器靠后代选择器收集
                  [data-sortable-id]，多放任何东西都会被当成待排序项。
                -->
                <div class="app__page-header">
                  <div class="app__page-title">
                    <span class="app__page-icon">
                      <SvgIcon :name="activePage?.icon ?? 'grid'" :size="16" />
                    </span>
                    <h1>{{ activePage?.name ?? '未选择页面' }}</h1>
                    <span class="app__page-stats">
                      {{ sections.length }} 个分区 · {{ activePageWebsites.length }} 个网站
                    </span>
                  </div>
                </div>

                <!-- 还没有任何页面（紧凑空状态：不占大面积、无插画） -->
                <div v-if="pages.length === 0" class="app__empty">
                  <SvgIcon name="layers" :size="18" />
                  <p>还没有导航页面，创建一个开始整理常用网站。</p>
                  <div class="app__empty-actions">
                    <button type="button" class="btn btn--primary btn--sm" @click="requestCreatePage">
                      <SvgIcon name="plus" :size="14" />
                      新建导航页面
                    </button>
                    <button type="button" class="btn btn--text btn--sm" @click="restoreDefaults">
                      <SvgIcon name="refresh" :size="14" />
                      恢复默认演示数据
                    </button>
                  </div>
                </div>

                <!-- 页面存在但没有分区 -->
                <div v-else-if="sections.length === 0" class="app__empty">
                  <SvgIcon name="folder" :size="18" />
                  <p>「{{ activePage?.name }}」还没有分区，分区用于把网站按用途归类。</p>
                  <!-- 必须写成调用表达式：直接写方法名会把 MouseEvent 当成 pageId 传进去 -->
                  <button type="button" class="btn btn--primary btn--sm" @click="requestCreateSection()">
                    <SvgIcon name="plus" :size="14" />
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
              </div>
            </Transition>
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
  /* 默认左侧栏：DOM 顺序即为视觉顺序 */
  flex-direction: row;
  height: 100vh;
  overflow: hidden;
}

/* 侧边栏默认在左侧；设置为右侧时反向排列 */
.app[data-sidebar-position='right'] {
  flex-direction: row-reverse;
}

.app__main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  /* 允许内部滚动容器在内容超高时收缩，否则 .app__scroll 不会滚动 */
  min-height: 0;
}

/*
 * 搜索区：没有独立顶栏，搜索框是页面内容的第一行、水平居中。
 * 顶部留白（margin + 容器 padding 共 100px）让它成为页面视觉起点
 * （新标签页习惯：搜索框不贴顶）。宽度由 SearchBar 组件的
 * --search-max-width 封顶。
 */
.app__search {
  display: flex;
  justify-content: center;
  width: 100%;
  margin-top: 80px; /* 加上 .app__content 的 padding-top(20px)，距视口顶恰好 100px */
}

/*
 * 自动隐藏模式：侧边栏改为悬浮层，默认平移出屏、不可见，
 * 呼出（热区或侧栏本体 hover）时滑回并投影，不占布局宽度——
 * 主区域始终占满整页。仍用 CSS 而非 v-if 切换，组件不重建。
 */
.app--sidebar-autohide :deep(.sidebar) {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 30;
  transform: translateX(-100%);
  visibility: hidden;
  box-shadow: var(--shadow-lg);
  transition:
    transform 0.2s ease,
    visibility 0.2s;
}

.app[data-sidebar-position='right'].app--sidebar-autohide :deep(.sidebar) {
  left: auto;
  right: 0;
  transform: translateX(100%);
}

.app--sidebar-autohide.app--sidebar-peek :deep(.sidebar),
.app[data-sidebar-position='right'].app--sidebar-autohide.app--sidebar-peek :deep(.sidebar) {
  transform: translateX(0);
  visibility: visible;
}

/* 更窄时改为竖向堆叠：侧边栏放到工具栏下方独占一行（左右位置设置不再影响视觉效果） */
@media (max-width: 760px) {
  .app,
  .app[data-sidebar-position='left'],
  .app[data-sidebar-position='right'] {
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

.app__scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/*
 * 分区网格的容器查询锚点。
 *
 * 为什么用容器查询而不是视口媒体查询：真正决定能放几列的是「扣掉侧边栏、
 * 再被 max-width 封顶之后」的可用宽度，视口宽度在这个布局里是错的度量——
 * 同一块屏幕上，显示/隐藏侧边栏会让列数变化，而视口宽度根本没变。
 *
 * container-type 必须打在这层（而不是 .app__scroll）：只有它同时受
 * 侧边栏宽度与 --content-max-width 约束，量出来的才是卡片真正能用的宽度。
 * 具名（workbench）是为了避免日后新增别的容器时规则绑定到错误的祖先。
 */
.app__content {
  container: workbench / inline-size;
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

/*
 * 页面切换动画容器：切页时整块（标题 + 内容）过渡。
 * gap 复刻 .app__content 的间距——包了这一层后，
 * banner / 批量工具栏与页面区块之间的间距仍由 .app__content 的 gap 负责。
 */
.app__page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 过渡时长与滚轮冷却（250ms）匹配：连滚时动画总能完整走完 */
.page-forward-enter-active,
.page-forward-leave-active,
.page-back-enter-active,
.page-back-leave-active,
.page-fade-enter-active,
.page-fade-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

/* 下一页：新页面自下而上进入，旧页面向上让位（与滚轮下滑方向一致） */
.page-forward-enter-from {
  opacity: 0;
  transform: translateY(16px);
}

.page-forward-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}

/* 上一页：反向 */
.page-back-enter-from {
  opacity: 0;
  transform: translateY(-16px);
}

.page-back-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

/* 常规入口（侧栏点击等）：纯淡入淡出 */
.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}

/* 页面标题栏：紧凑一行，不使用横幅或大面积底色 */
.app__page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
  min-height: 32px;
}

.app__page-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.app__page-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: var(--bg-active);
  color: var(--brand-600);
  flex: none;
}

.app__page-title h1 {
  font-size: var(--font-xl);
  font-weight: 600;
  color: var(--text-primary);
}

/* 统计信息：一行次级文字，不用两个徽章 */
.app__page-stats {
  font-size: var(--font-sm);
  color: var(--text-tertiary);
  white-space: nowrap;
}

/*
 * 分区卡片网格（本次改版的核心）
 *
 * - 多列自适应：列数由下面一组的容器查询决定，见 .app__content 上的说明。
 * - align-items: start 是必须的：否则同一行的卡片会被拉伸到等高，
 *   「卡片高度由内容决定」就失效了。
 * - minmax(0, 1fr) 里的 0 也是必须的：默认 min-width: auto 会让内容
 *   （长网址、长名称）把列撑宽，进而产生横向滚动条。
 */
.app__sections {
  display: grid;
  gap: var(--space-4);
  align-items: start;
  grid-template-columns: minmax(0, 1fr);
}

/* 断点按「可用宽度」而非视口宽度取：<650 → 1 列，650/1000/1400 → 2/3/4 列 */
@container workbench (min-width: 650px) {
  .app__sections {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container workbench (min-width: 1000px) {
  .app__sections {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container workbench (min-width: 1400px) {
  .app__sections {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

/* 空状态：紧凑提示 + 一个动作，不用插画、不占大面积 */
.app__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-5) var(--space-4);
  color: var(--text-tertiary);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  text-align: center;
}

.app__empty p {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  max-width: 380px;
}

.app__empty-actions {
  display: flex;
  gap: var(--space-2);
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

@media (max-width: 760px) {
  /* 窄屏侧栏横排在底部：自动隐藏的悬浮定位还原为常规布局 */
  .app--sidebar-autohide :deep(.sidebar),
  .app[data-sidebar-position='right'].app--sidebar-autohide :deep(.sidebar) {
    position: static;
    transform: none;
    visibility: visible;
    box-shadow: none;
  }

  .app__content {
    padding: var(--space-3);
  }
}
</style>
