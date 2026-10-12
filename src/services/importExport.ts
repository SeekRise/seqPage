/**
 * 配置导入 / 导出 / 备份
 *
 * 安全与健壮性要求（对应任务书第十二节）：
 * - 导出：可选是否包含最近访问记录，导出前明确告知内容范围。
 * - 导入：文件大小限制 → JSON 解析 → 版本检查 → 字段与类型校验 → ID 重复检查
 *   → 页面/分区/网站关联检查 → 协议校验 → 数量上限保护。
 * - 导入失败时绝不先清空现有配置（校验全部通过后才由调用方执行覆盖）。
 */
import {
  FIELD_LIMITS,
  MAX_IMPORT_FILE_SIZE,
  SCHEMA_VERSION,
} from '@/utils/constants';
import type { ExportPayload, ImportValidation, NaviState } from '@/types';
import { createEmptyState } from '@/services/repository';
import {
  isPlainObject,
  parsePages,
  parseRecentVisits,
  parseSections,
  parseSettings,
  parseWebsites,
} from '@/utils/validators';
import { DEFAULT_SETTINGS } from '@/utils/constants';
import { formatFileStamp } from '@/utils/common';

/** 生成导出负载 */
export function createExportPayload(
  state: NaviState,
  options: { includeRecentVisits: boolean },
): ExportPayload {
  const recentVisits = options.includeRecentVisits ? state.recentVisits : [];
  return {
    app: 'my-navi',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    includesRecentVisits: options.includeRecentVisits,
    data: {
      schemaVersion: SCHEMA_VERSION,
      pages: state.pages,
      sections: state.sections,
      websites: state.websites,
      settings: state.settings,
      recentVisits,
    },
  };
}

/** 序列化为带缩进的 JSON 文本 */
export function serializeExport(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** 触发浏览器下载（使用 Blob + a[download]，不依赖任何外部服务） */
export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 交给浏览器完成下载后再释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 生成默认导出文件名 */
export function defaultExportFilename(): string {
  return `my-navi-backup-${formatFileStamp()}.json`;
}

/** 校验并解析导入文本，返回可直接使用的状态 */
export function validateImportText(text: string): ImportValidation {
  const warnings: string[] = [];

  const emptyResult: ImportValidation = {
    ok: false,
    message: '',
    state: null,
    warnings,
    stats: null,
  };

  if (!text.trim()) {
    return { ...emptyResult, message: '文件内容为空，请选择由 My Navi 导出的 JSON 备份文件。' };
  }

  // 文件体积按字符数近似判断（UTF-8 中文最多 3 字节/字符，这里保守估计）
  if (text.length > MAX_IMPORT_FILE_SIZE) {
    return {
      ...emptyResult,
      message: `文件过大（约 ${(text.length / 1024 / 1024).toFixed(1)} MB），超过 ${MAX_IMPORT_FILE_SIZE / 1024 / 1024} MB 上限。请拆分后再导入。`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ...emptyResult,
      message: `JSON 格式错误，无法解析：${error instanceof Error ? error.message : '未知原因'}。请确认文件未被截断或修改。`,
    };
  }

  if (!isPlainObject(parsed)) {
    return { ...emptyResult, message: '文件顶层结构应为 JSON 对象，当前不是。' };
  }

  // 兼容两种格式：完整导出负载（含 app/data）与裸快照
  const isWrapped = isPlainObject(parsed.data) || typeof parsed.app === 'string';
  if (isWrapped && typeof parsed.app === 'string' && parsed.app !== 'my-navi') {
    return {
      ...emptyResult,
      message: `该文件来自「${parsed.app}」，不是 My Navi 的备份文件，已取消导入。`,
    };
  }

  const payload = isWrapped && isPlainObject(parsed.data) ? parsed.data : parsed;

  const fileVersion = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
  if (fileVersion > SCHEMA_VERSION) {
    return {
      ...emptyResult,
      message: `备份文件的配置版本为 v${fileVersion}，高于当前扩展支持的 v${SCHEMA_VERSION}。请先升级 My Navi 后再导入。`,
    };
  }
  if (fileVersion === 0) {
    warnings.push('备份文件未标注配置版本，已按 v1 结构尽力解析。');
  }

  if (!Array.isArray(payload.pages)) {
    return { ...emptyResult, message: '备份文件缺少 pages 字段或类型不正确，无法导入。' };
  }

  // 逐实体校验
  const pages = parsePages(payload.pages);
  warnings.push(...pages.reasons);

  if (pages.items.length === 0) {
    return { ...emptyResult, message: '备份文件中没有有效的导航页面，已取消导入以免清空现有数据。' };
  }

  const pageIds = new Set(pages.items.map((page) => page.id));
  const sections = parseSections(payload.sections, pageIds);
  warnings.push(...sections.reasons);

  const sectionPageMap = new Map(sections.items.map((section) => [section.id, section.pageId]));
  const websites = parseWebsites(payload.websites, sectionPageMap);
  warnings.push(...websites.reasons);

  const recentVisits = parseRecentVisits(
    payload.recentVisits,
    new Set(websites.items.map((website) => website.id)),
  );

  const settings = parseSettings(payload.settings, DEFAULT_SETTINGS);

  // 页面没有任何分区时补一个默认分区，避免导入后无法添加网站
  const sectionsWithDefaults = [...sections.items];
  const emptyPages = pages.items.filter(
    (page) => !sectionsWithDefaults.some((section) => section.pageId === page.id),
  );
  if (emptyPages.length > 0) {
    const timestamp = Date.now();
    for (const page of emptyPages) {
      sectionsWithDefaults.push({
        id: `sec_import_${page.id}`,
        pageId: page.id,
        name: '默认分区',
        icon: 'folder',
        color: '#3B6FE0',
        order: 0,
        collapsed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    warnings.push(`有 ${emptyPages.length} 个页面没有任何分区，已自动创建「默认分区」。`);
  }

  const totalWebsites = websites.items.length;
  const maxWebsites = FIELD_LIMITS.maxPages * FIELD_LIMITS.maxSectionsPerPage * 20;
  if (totalWebsites > maxWebsites) {
    return {
      ...emptyResult,
      message: `备份文件包含 ${totalWebsites} 个网站，超过上限 ${maxWebsites}，已取消导入以防止页面卡顿。`,
    };
  }

  const state: NaviState = {
    schemaVersion: SCHEMA_VERSION,
    pages: pages.items,
    sections: sectionsWithDefaults,
    websites: websites.items,
    settings,
    recentVisits,
  };

  const dropped = pages.dropped + sections.dropped + websites.dropped;
  if (dropped > 0) {
    warnings.push(`共跳过 ${dropped} 条无法修复的数据记录。`);
  }

  return {
    ok: true,
    message: '',
    state,
    warnings,
    stats: {
      pages: state.pages.length,
      sections: state.sections.length,
      websites: state.websites.length,
      recentVisits: state.recentVisits.length,
    },
  };
}

/** 读取用户选择的文件文本（带大小校验） */
export async function readFileAsText(file: File): Promise<{ ok: boolean; text: string; message: string }> {
  if (file.size > MAX_IMPORT_FILE_SIZE) {
    return {
      ok: false,
      text: '',
      message: `文件大小为 ${(file.size / 1024 / 1024).toFixed(2)} MB，超过 ${MAX_IMPORT_FILE_SIZE / 1024 / 1024} MB 上限。`,
    };
  }
  try {
    const text = await file.text();
    return { ok: true, text, message: '' };
  } catch (error) {
    return {
      ok: false,
      text: '',
      message: `读取文件失败：${error instanceof Error ? error.message : '未知原因'}。请确认文件未被其他程序占用。`,
    };
  }
}

/** 空状态（用于「清空数据」后构造） */
export { createEmptyState };
