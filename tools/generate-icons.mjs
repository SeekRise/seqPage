/**
 * SeqPage 图标生成脚本
 *
 * 源图：项目根目录的 icon.jfif（正方形 JPEG，可传参换别的路径）。
 * 产物：public/icons/icon{16,32,48,128,192}.png
 *
 * 为什么走 headless Chrome 而不是 sharp / canvas：
 * Node 没有内置 JPEG 解码器，而本仓库的工具链刻意保持**零依赖**
 * （见 tools 下其它脚本）。这里复用 screenshot.mjs / smoke-test.mjs 那套 CDP 方案，
 * 把源图以 data URL 交给浏览器里的 canvas 缩放，再取回 PNG——
 * data URL 不会污染 canvas，所以 toDataURL 可用。
 *
 * 用法：node tools/generate-icons.mjs [源图路径]
 * 未找到 Chrome 时跳过并返回成功（与其它测试脚本一致）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');
const SOURCE = resolve(process.argv[2] ?? join(ROOT, 'icon.jfif'));
const SIZES = [16, 32, 48, 128, 192];
const DEBUG_PORT = 9556;

const MIME_BY_EXT = {
  '.jfif': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const chromePath = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((candidate) => candidate && existsSync(candidate));

if (!chromePath) {
  console.log('未找到 Chrome/Edge，跳过图标生成。');
  process.exit(0);
}

if (!existsSync(SOURCE)) {
  console.error(`未找到源图：${SOURCE}`);
  process.exit(1);
}

const mime = MIME_BY_EXT[extname(SOURCE).toLowerCase()];
if (!mime) {
  console.error(`不支持的源图格式：${extname(SOURCE)}（支持 .jfif/.jpg/.jpeg/.png/.webp）`);
  process.exit(1);
}

const dataUrl = `data:${mime};base64,${readFileSync(SOURCE).toString('base64')}`;
const profileDir = mkdtempSync(join(tmpdir(), 'seqpage-icons-'));

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--disable-extensions',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

function cleanup() {
  try {
    chrome.kill();
  } catch {
    /* 已经退出 */
  }
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清理失败不影响结果 */
  }
}

async function waitForTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 端口还没起来，继续重试 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('等待调试端口超时');
}

try {
  const target = await waitForTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve: res, reject: rej } = pending.get(payload.id);
      pending.delete(payload.id);
      payload.error ? rej(new Error(payload.error.message)) : res(payload.result);
    }
  });
  const call = (method, params = {}) =>
    new Promise((res, rej) => {
      id += 1;
      pending.set(id, { resolve: res, reject: rej });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await call('Runtime.enable');

  const expression = `(async () => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('源图解码失败'));
      img.src = ${JSON.stringify(dataUrl)};
    });

    const out = {};
    for (const size of ${JSON.stringify(SIZES)}) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // 非正方形时按短边居中裁剪（cover），避免图标被拉伸变形
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      out[size] = canvas.toDataURL('image/png');
    }
    return { width: img.width, height: img.height, out };
  })()`;

  const evaluated = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluated.exceptionDetails) {
    throw new Error(evaluated.exceptionDetails.exception?.description ?? '浏览器端处理失败');
  }

  const { width, height, out } = evaluated.result.value;
  console.log(`源图：${SOURCE}（${width}×${height}）`);

  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const base64 = String(out[size]).replace(/^data:image\/png;base64,/, '');
    const png = Buffer.from(base64, 'base64');
    const file = join(OUT_DIR, `icon${size}.png`);
    writeFileSync(file, png);
    console.log(`generated ${file} (${png.length} bytes)`);
  }

  socket.close();
} finally {
  cleanup();
}
