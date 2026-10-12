/**
 * 不可解析数据的保护行为测试（零依赖）
 *
 * 目标：验证当本地已保存的配置**无法解析**时，应用必须做到：
 *   1. 进入只读保护模式，明确告知用户具体原因；
 *   2. 显示空状态而不是伪造数据；
 *   3. **绝不**把这份无法解析的数据覆盖掉（这是最容易造成用户数据永久丢失的路径）。
 *
 * 用法：node tools/corrupt-data-test.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

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
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((candidate) => candidate && existsSync(candidate));

if (!chromePath) {
  console.log('⚠ 未找到 Chrome/Edge，跳过该测试。');
  process.exit(0);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 未找到 dist/index.html，请先执行 npm run build。');
  process.exit(1);
}

/** 无法解析的样本：pages 是字符串，sections/websites 是数字 */
const CORRUPT_DOCUMENT = JSON.stringify({
  schemaVersion: 1,
  meta: { schemaVersion: 1, createdAt: 1, updatedAt: 1, initialized: true, lastImportedAt: null },
  activePageId: 'whatever',
  pages: 'this-is-not-an-array',
  sections: 42,
  websites: null,
});

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

const debugPort = 9888;
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mynavi-corrupt-'))}`,
    '--no-first-run',
    '--disable-extensions',
    '--disable-gpu',
    '--window-size=1400,900',
    pageUrl,
  ],
  { stdio: 'ignore' },
);

function cleanup(code) {
  try {
    chrome.kill();
  } catch {
    /* ignore */
  }
  server.close();
  setTimeout(() => process.exit(code), 100);
}

async function waitForTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
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

const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 失败');
  return r.result?.value;
};

await call('Runtime.enable');
await call('Page.enable');

await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    try {
      Object.defineProperty(window.chrome, 'storage', { value: undefined, configurable: true });
    } catch (e) { /* 忽略 */ }
    if (!location.search.includes('corrupt=1')) return;
    localStorage.setItem('mynavi:state', ${JSON.stringify(CORRUPT_DOCUMENT)});
    window.__CORRUPT_SEED__ = 'seeded';
  })();`,
});

await call('Page.navigate', { url: `${pageUrl}?corrupt=1` });
await new Promise((r) => setTimeout(r, 2800));

const checks = [];
function check(label, value, expected) {
  const pass = expected ? expected(value) : Boolean(value);
  checks.push({ label, pass, detail: pass ? '' : `实际值：${JSON.stringify(value)?.slice(0, 240)}` });
}

const before = await evaluate(`(() => {
  const raw = localStorage.getItem('mynavi:state');
  const banner = document.querySelector('.app__banner--error');
  return {
    seeded: window.__CORRUPT_SEED__ === 'seeded',
    raw,
    bannerText: banner ? banner.textContent.trim() : '',
    hasReloadButton: !!banner && banner.textContent.includes('重新读取'),
    hasKnowButton: !!banner && banner.textContent.includes('知道了'),
    decisions: window.__MYNAVI__ ? window.__MYNAVI__.bootTrace().decision : null,
    loadedPages: window.__MYNAVI__ ? window.__MYNAVI__.bootTrace().loadedPages : -1,
    cards: document.querySelectorAll('.website-card').length,
    emptyState: !!document.querySelector('.app__empty'),
    sidebarItems: document.querySelectorAll('.sidebar__item').length,
  };
})()`);

check('已写入无法解析的样本数据', before.seeded === true);
check('提示中说明了具体原因（pages 字段）', before.bannerText, (v) => String(v).includes('pages'));
check('提示中不再笼统声称"数据损坏"', before.bannerText, (v) => !String(v).includes('结构不完整'));
check('提示提供了「重新读取」入口', before.hasReloadButton === true);
check('提示提供了「知道了」入口', before.hasKnowButton === true);
check('未伪造数据（页面数为 0）', before.loadedPages, (v) => v === 0);
check('显示空状态而非报错崩溃', before.emptyState === true);
check('右侧栏为空（没有凭空生成演示数据）', before.sidebarItems, (v) => v === 0);
check('未渲染任何网站卡片', before.cards, (v) => v === 0);

// 尝试一切可能触发写入的操作，验证原始数据纹丝不动
const after = await evaluate(`(async () => {
  const rawBefore = localStorage.getItem('mynavi:state');
  const steps = [];

  // 1) 逐个点击顶部工具区按钮，记录每一步之后存储是否被改动
  const buttons = [...document.querySelectorAll('.app__tools button')];
  for (const button of buttons) {
    try { button.click(); } catch (e) { /* 忽略 */ }
    await new Promise((r) => setTimeout(r, 150));
    const now = localStorage.getItem('mynavi:state');
    steps.push({ label: button.textContent.trim().slice(0, 12), changed: now !== rawBefore });
    // 关闭可能弹出的弹窗，避免影响后续点击
    document.querySelectorAll('dialog[open] .modal__header button').forEach((b) => b.click());
    await new Promise((r) => setTimeout(r, 150));
  }

  // 2) 点击页面上的其它按钮（空状态下主要是引导按钮）
  const otherButtons = [...document.querySelectorAll('.app__empty button, .sidebar__add, .sidebar__tool')];
  for (const button of otherButtons) {
    try { button.click(); } catch (e) { /* 忽略 */ }
    await new Promise((r) => setTimeout(r, 150));
    const now = localStorage.getItem('mynavi:state');
    steps.push({ label: 'other:' + button.textContent.trim().slice(0, 12), changed: now !== rawBefore });
    document.querySelectorAll('dialog[open] .modal__header button').forEach((b) => b.click());
    await new Promise((r) => setTimeout(r, 150));
  }

  // 3) 直接调用 store 的写接口（模拟最坏情况：绕过界面拦截）
  const bridge = window.__MYNAVI__;
  let writeResults = [];
  if (bridge && typeof bridge.attemptWrites === 'function') {
    writeResults = await bridge.attemptWrites();
  }

  await new Promise((r) => setTimeout(r, 900));
  const rawAfter = localStorage.getItem('mynavi:state');
  return { rawBefore, rawAfter, writeResults, steps };
})()`);

check('点击各类操作按钮后原始数据未被改写', after.rawAfter === before.raw);
if (process.env.MYNAVI_DEBUG === '1') {
  console.log('\n  [debug] 改动发生的步骤 =', JSON.stringify(after.steps.filter((s) => s.changed)));
  console.log('  [debug] writeResults =', JSON.stringify(after.writeResults.map((r) => ({ n: r.name, ok: r.ok }))));
}
check('原始数据逐字节保持不变', after.rawAfter, (v) => v === before.raw);
check(
  '普通写接口被只读保护拦截（设置 / 新建页面）',
  after.writeResults.filter((item) => ['updateSettings', 'addPage'].includes(item.name)),
  (v) => v.length === 2 && v.every((item) => item.ok === false),
);
check(
  '未被确认的覆盖操作默认被拒绝（replaceState）',
  after.writeResults.find((item) => item.name === 'replaceStateNotForced')?.ok,
  (v) => v === false,
);

// 点击「重新读取」，验证仍然失败但不会破坏数据
const reloadAttempt = await evaluate(`(async () => {
  const banner = document.querySelector('.app__banner--error');
  const reloadButton = [...(banner ? banner.querySelectorAll('button') : [])].find((b) =>
    b.textContent.includes('重新读取'),
  );
  reloadButton?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    raw: localStorage.getItem('mynavi:state'),
    stillShowsError: !!document.querySelector('.app__banner--error'),
  };
})()`);

check('「重新读取」不会破坏原始数据', reloadAttempt.raw, (v) => v === before.raw);
check('「重新读取」后仍如实提示错误', reloadAttempt.stillShowsError === true);

// 用户主动「清空本地数据」应当被视为显式放弃保护
const afterClear = await evaluate(`(async () => {
  const bridge = window.__MYNAVI__;
  if (bridge && typeof bridge.forceClear === 'function') {
    const result = await bridge.forceClear();
    return { ok: result.ok, raw: localStorage.getItem('mynavi:state') !== null };
  }
  return { ok: false, raw: true };
})()`);

check('用户显式清空后可正常写入（解除保护）', afterClear.ok === true);
check('清空后存储中写入了新的空配置', afterClear.raw === true);

const protectedAfterClear = await evaluate(`(async () => {
  if (!window.__MYNAVI__) return null;
  return window.__MYNAVI__.writeProtected;
})()`);
check('清空后只读保护已解除', protectedAfterClear, (v) => v === false);

console.log('\n=== My Navi 不可解析数据保护测试 ===\n');
for (const item of checks) {
  console.log(`  ${item.pass ? '✓' : '✗'} ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
}

const failed = checks.filter((item) => !item.pass);
if (failed.length === 0) {
  console.log(`\n结果：全部 ${checks.length} 项通过，无法解析的数据不会被覆盖。\n`);
  cleanup(0);
} else {
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过。\n`);
  cleanup(1);
}
