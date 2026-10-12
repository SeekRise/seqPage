/**
 * 界面截图工具（零依赖）
 *
 * 用法：node tools/screenshot.mjs [输出目录]
 * 产物：my-navi-light.png / my-navi-dark.png
 *
 * 说明：以普通网页方式加载 dist/（使用 localStorage 回退），
 * 用于快速检查布局、间距、配色与深色模式效果。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT_DIR = resolve(process.argv[2] ?? join(ROOT, 'screenshots'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const chromePath = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].find((candidate) => candidate && existsSync(candidate));

if (!chromePath) {
  console.log('未找到 Chrome，跳过截图。');
  process.exit(0);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('未找到 dist/index.html，请先执行 npm run build。');
  process.exit(1);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  const target = join(DIST, relative === '' ? 'index.html' : relative);
  if (!target.startsWith(DIST) || !existsSync(target)) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
  response.end(readFileSync(target));
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const pageUrl = `http://127.0.0.1:${port}/index.html`;

const debugPort = 9555;
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mynavi-shot-'))}`,
    '--no-first-run',
    '--disable-extensions',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1600,1000',
    pageUrl,
  ],
  { stdio: 'ignore' },
);

async function waitForTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('等待调试端口超时');
}

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
const evaluate = (expression) => call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

await call('Runtime.enable');
await call('Page.enable');
await call('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

mkdirSync(OUT_DIR, { recursive: true });

async function shoot(name, prepare) {
  if (prepare) {
    await evaluate(prepare);
    await new Promise((r) => setTimeout(r, 900));
  }
  const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(OUT_DIR, `${name}.png`);
  writeFileSync(file, Buffer.from(result.data, 'base64'));
  console.log(`已生成 ${file}`);
}

await shoot('my-navi-light');
await shoot(
  'my-navi-dark',
  `(async () => {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.setProperty('--bg-page', '#161a22');
    return true;
  })()`,
);
// 设置面板（Naive UI 版）：打开面板截取外观分组，检查观感
await shoot(
  'my-navi-settings',
  `(async () => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.removeProperty('--bg-page');
    const buttons = [...document.querySelectorAll('button')];
    buttons.find((el) => el.textContent.trim() === '设置')?.click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`,
);

// 通过设置面板把导航栏切到右侧（非默认布局），验证左右布局都能正常渲染
await shoot(
  'my-navi-sidebar-right',
  `(async () => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.removeProperty('--bg-page');
    const buttons = [...document.querySelectorAll('button')];
    buttons.find((el) => el.textContent.trim() === '设置')?.click();
    await new Promise((r) => setTimeout(r, 450));
    const modal = document.querySelector('[data-testid="settings-modal"]');
    const rightRadio = modal?.querySelector('[data-testid="setting-sidebar-right"]');
    rightRadio?.click();
    await new Promise((r) => setTimeout(r, 500));
    document.querySelector('[data-testid="settings-done"]')?.click();
    await new Promise((r) => setTimeout(r, 600));
    return true;
  })()`,
);

try {
  chrome.kill();
} catch {
  /* ignore */
}
server.close();
process.exit(0);
