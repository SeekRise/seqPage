/**
 * 背景图片本地化
 *
 * 用户上传的图片在这里被等比缩放并编码成 WebP data URL，之后随配置一起存进
 * `chrome.storage.local`。这样做的理由：
 * - 不引入独立的文件表或新权限，存储模型仍然只有 `mynavi:state` 一个物理键；
 * - 页面依然零网络请求，MV3 CSP 与离线可用性都不受影响；
 * - 导出 / 导入是同一份 JSON，背景图跟着配置走，不会丢。
 *
 * 输出统一为 WebP：体积比 PNG/JPEG 小，且保留透明通道（PNG 截图转 JPEG 会变黑底）。
 */
import type { BackgroundConfig } from '@/types';
import { BACKGROUND_IMAGE_LIMITS } from '@/utils/constants';

export interface BackgroundImageResult {
  ok: boolean;
  /** 成功时为 data:image/webp;base64,... */
  dataUrl: string;
  /** 失败原因，成功时为空串 */
  message: string;
}

/**
 * 只接受栅格图。SVG 被排除：它是可执行文档（可内嵌脚本与外链），
 * 画进 canvas 还可能因跨源引用触发 taint，不值得为一个背景图承担这些分支。
 */
const ACCEPTED_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
];

function fail(message: string): BackgroundImageResult {
  return { ok: false, dataUrl: '', message };
}

/** data URL 的字符数换算成近似字节数（base64 部分每 4 个字符 3 字节） */
export function dataUrlByteSize(dataUrl: string): number {
  return Math.round((dataUrl.length * 3) / 4);
}

/** 把用户选择的图片文件转成可直接写进 background.imageUrl 的 data URL */
export async function fileToBackgroundDataUrl(file: File): Promise<BackgroundImageResult> {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return fail('只支持 PNG / JPEG / WebP / GIF / BMP 图片。');
  }
  if (file.size > BACKGROUND_IMAGE_LIMITS.maxFileBytes) {
    const limitMb = Math.round(BACKGROUND_IMAGE_LIMITS.maxFileBytes / 1024 / 1024);
    return fail(`图片不能超过 ${limitMb} MB，请先自行压缩。`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fail('图片解码失败，请换一张试试。');
  }

  const { maxEdge, quality, maxDataUrlChars } = BACKGROUND_IMAGE_LIMITS;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return fail('当前环境不支持画布，无法处理图片。');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/webp', quality);
  if (!dataUrl.startsWith('data:image/')) {
    return fail('图片编码失败，请换一张试试。');
  }
  if (dataUrl.length > maxDataUrlChars) {
    return fail('图片压缩后仍然过大，请换一张分辨率更低的图片。');
  }

  return { ok: true, dataUrl, message: '' };
}

/** 背景图是否来自本地上传（而非用户填写的远程地址） */
export function isUploadedBackground(background: BackgroundConfig): boolean {
  return background.imageUrl.startsWith('data:image/');
}
