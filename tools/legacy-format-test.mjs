/**
 * 旧格式兼容性回归测试（零依赖）
 *
 * 背景：早期构建把数组序列化成了以数字为键的对象：
 *   "pages": {"0":{…},"1":{…}}
 * 新版读取逻辑若只用 Array.isArray 判定，就会把完全正常的配置误判为
 * "结构不完整"并拒绝加载（用户看到"本地存储出现问题"）。
 *
 * 本测试专门锁定这个回归：
 *   1. 在页面脚本运行前，向存储写入一份"对象映射格式"的配置；
 *   2. 加载应用，断言数据被正确读入（而不是被判为损坏）、界面渲染正常、
 *      并且读取后会被规范化为数组写回存储。
 *
 * 用法：node tools/legacy-format-test.mjs
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
  console.log('⚠ 未找到 Chrome/Edge，跳过旧格式兼容性测试。');
  process.exit(0);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 未找到 dist/index.html，请先执行 npm run build。');
  process.exit(1);
}

/* ---------------- 静态服务器 ---------------- */

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

/* ---------------- 启动 Chrome ---------------- */

const debugPort = 9777;
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mynavi-legacy-'))}`,
    '--no-first-run',
    '--disable-extensions',
    '--disable-gpu',
    '--window-size=1500,950',
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
const pageErrors = [];
const consoleErrors = [];

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  if (payload.id && pending.has(payload.id)) {
    const { resolve: res, reject: rej } = pending.get(payload.id);
    pending.delete(payload.id);
    payload.error ? rej(new Error(payload.error.message)) : res(payload.result);
    return;
  }
  if (payload.method === 'Runtime.exceptionThrown') {
    pageErrors.push(payload.params.exceptionDetails?.exception?.description ?? '未知异常');
  }
  if (payload.method === 'Runtime.consoleAPICalled' && payload.params.type === 'error') {
    const text = (payload.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    consoleErrors.push(text);
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

/* ---------------- 关键：在应用脚本之前写入旧格式数据 ---------------- */

await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    // 让应用走 localStorage 回退路径（同源、可控）
    try {
      Object.defineProperty(window.chrome, 'storage', { value: undefined, configurable: true });
    } catch (e) { /* 忽略 */ }

    // 只在带 ?legacy=1 的这次导航中写入旧格式样本。
    // 原因：Chrome 启动时已经用真实 URL 加载过一次页面（那时本脚本尚未注册），
    // 应用可能已经写入了演示数据；用 URL 标记可以精确控制注入时机。
    if (!location.search.includes('legacy=1')) {
      window.__LEGACY_SEED__ = 'not-target-navigation';
      return;
    }

    const ts = Date.now();
    const toMap = (arr) => {
      const map = {};
      arr.forEach((item, index) => { map[String(index)] = item; });
      return map;
    };

    const pages = [
      { id: 'page_legacy1', name: '旧格式页面', icon: 'code', order: 0, createdAt: ts, updatedAt: ts },
      { id: 'page_legacy2', name: '第二个旧页面', icon: 'shield', order: 1, createdAt: ts, updatedAt: ts },
    ];
    const sections = [
      { id: 'sec_legacy1', pageId: 'page_legacy1', name: '旧格式分区', icon: 'folder', color: '#3B6FE0',
        order: 0, collapsed: false, createdAt: ts, updatedAt: ts },
      { id: 'sec_legacy2', pageId: 'page_legacy2', name: '安全分区', icon: 'server', color: '#D9534F',
        order: 0, collapsed: false, createdAt: ts, updatedAt: ts },
    ];
    const websites = [
      { id: 'web_legacy1', pageId: 'page_legacy1', sectionId: 'sec_legacy1', name: '旧格式网站',
        url: 'https://legacy.example.com/', description: '来自对象映射格式', icon: '', iconType: 'auto',
        openInNewTab: true, favorite: true, order: 0, createdAt: ts, updatedAt: ts },
      { id: 'web_legacy2', pageId: 'page_legacy1', sectionId: 'sec_legacy1', name: '旧格式网站二',
        url: 'https://legacy2.example.com/', description: '', icon: '', iconType: 'auto',
        openInNewTab: true, favorite: false, order: 1, createdAt: ts, updatedAt: ts },
      { id: 'web_legacy3', pageId: 'page_legacy2', sectionId: 'sec_legacy2', name: '旧格式安全站',
        url: 'https://legacy3.example.com/', description: '', icon: '', iconType: 'auto',
        openInNewTab: true, favorite: false, order: 0, createdAt: ts, updatedAt: ts },
    ];

    localStorage.setItem('mynavi:state', JSON.stringify({
      schemaVersion: 1,
      meta: { schemaVersion: 1, createdAt: ts, updatedAt: ts, initialized: true, lastImportedAt: null },
      activePageId: 'page_legacy1',
      pages: toMap(pages),          // ← 旧格式：数组被写成对象
      sections: toMap(sections),    // ← 旧格式
      websites: toMap(websites),    // ← 旧格式
      recentVisits: {},             // ← 旧格式
      settings: {
        theme: 'system', defaultSearchEngine: 'bing', defaultOpenMode: 'newTab',
        showDescription: true, cardDensity: 'compact',
        background: { type: 'solid', color: '#eef2f8', gradientFrom: '#eaf1fb', gradientTo: '#dfe7f3',
          imageUrl: '', panelOpacity: 1, radius: 12 },
        recentVisitsEnabled: true, searchHistoryEnabled: true, contextMenuEnabled: true,
        shortcutsEnabled: true, remoteFavicon: true, recentVisitsLimit: 30,
      },
    }));
    window.__LEGACY_SEED__ = 'seeded';
  })();`,
});

// 明确导航到目标页面（带 legacy=1 标记）：此时上面注册的 pre-document 脚本
// 会在应用脚本之前写入旧格式数据，从而保证应用读取到的就是旧格式。
await call('Page.navigate', { url: `${pageUrl}?legacy=1` });
await new Promise((r) => setTimeout(r, 2800));

/* ---------------- 断言 ---------------- */

const checks = [];
function check(label, value, expected) {
  const pass = expected ? expected(value) : Boolean(value);
  checks.push({ label, pass, detail: pass ? '' : `实际值：${JSON.stringify(value)?.slice(0, 240)}` });
}

const probe = await evaluate(`(() => {
  const store = JSON.parse(localStorage.getItem('mynavi:state') ?? 'null');
  const trace = window.__MYNAVI__ ? window.__MYNAVI__.bootTrace() : null;
  return {
    seedState: window.__LEGACY_SEED__ ?? null,
    href: location.href,
    rawKeys: store ? Object.keys(store) : null,
    rawPagesKeys: store && store.pages ? Object.keys(store.pages).slice(0, 4) : null,
    decision: trace ? trace.decision : null,
    loadedPages: trace ? trace.loadedPages : -1,
    loadedWebsites: trace ? trace.loadedWebsites : -1,
    pageNames: trace ? trace.loadedPageNames : [],
    loadedTheme: trace ? trace.loadedTheme : null,
    heading: document.querySelector('.app__page-title h1')?.textContent?.trim() ?? '',
    sidebar: [...document.querySelectorAll('.sidebar__page-name')].map((el) => el.textContent.trim()),
    cardNames: [...document.querySelectorAll('.website-card__name')].map((el) => el.textContent.trim()),
    sectionNames: [...document.querySelectorAll('.section-panel__name')].map((el) => el.textContent.trim()),
    errorBanner: document.querySelector('.app__banner--error')?.textContent?.trim() ?? '',
    storedPagesIsArray: Array.isArray(store ? store.pages : null),
    storedSectionsIsArray: Array.isArray(store ? store.sections : null),
    storedWebsitesIsArray: Array.isArray(store ? store.websites : null),
    storedWebsiteCount: store && Array.isArray(store.websites) ? store.websites.length : -1,
    storedSearchEngine: store && store.settings ? store.settings.defaultSearchEngine : null,
    storedDensity: store && store.settings ? store.settings.cardDensity : null,
    storedFavorite: store && Array.isArray(store.websites)
      ? (store.websites.find((w) => w.id === 'web_legacy1') || {}).favorite
      : null,
  };
})()`);

check('旧格式未被判定为损坏（启动轨迹为读取已保存配置）', probe.decision, (v) => v === 'use-stored');
if (process.env.MYNAVI_DEBUG === '1') {
  console.log('\n  [debug] probe =', JSON.stringify(probe, null, 2));
}
check('未出现「配置无法解析」错误横幅', probe.errorBanner === '');
check('旧格式的 2 个页面全部读入', probe.loadedPages, (v) => v === 2);
check('旧格式的 3 个网站全部读入', probe.loadedWebsites, (v) => v === 3);
check(
  '页面名称与顺序正确（对象键按数值升序还原）',
  probe.pageNames,
  (v) => v[0] === '旧格式页面' && v[1] === '第二个旧页面',
);
check('当前页面按 activePageId 恢复', probe.heading, (v) => v === '旧格式页面');
check('右侧栏渲染出全部页面', probe.sidebar, (v) => v.length === 2);
check('分区名称正确渲染', probe.sectionNames, (v) => v.includes('旧格式分区'));
check('网站卡片正确渲染', probe.cardNames, (v) => v.includes('旧格式网站') && v.includes('旧格式网站二'));
check('设置项被保留（默认搜索引擎 bing）', probe.storedSearchEngine, (v) => v === 'bing');
check('设置项被保留（卡片密度 compact）', probe.storedDensity, (v) => v === 'compact');

// 触发一次真实写入，验证规范化后的数据会被正确持久化（数组格式回写）
const afterWrite = await evaluate(`(async () => {
  // 点击第一个网站卡片的收藏按钮，触发一次 store 写入
  const favoriteButton = document.querySelector('.website-card__action[aria-label="收藏"], .website-card__action[aria-label="取消收藏"]');
  favoriteButton?.click();
  await new Promise((r) => setTimeout(r, 900));
  const store = JSON.parse(localStorage.getItem('mynavi:state') ?? 'null');
  return {
    pagesIsArray: Array.isArray(store ? store.pages : null),
    sectionsIsArray: Array.isArray(store ? store.sections : null),
    websitesIsArray: Array.isArray(store ? store.websites : null),
    websiteCount: store && Array.isArray(store.websites) ? store.websites.length : -1,
    sectionCount: store && Array.isArray(store.sections) ? store.sections.length : -1,
    pageCount: store && Array.isArray(store.pages) ? store.pages.length : -1,
    names: store && Array.isArray(store.websites) ? store.websites.map((w) => w.name).sort() : [],
    favoriteToggled: store && Array.isArray(store.websites)
      ? (store.websites.find((w) => w.id === 'web_legacy1') || {}).favorite
      : null,
  };
})()`);

check('写入后 pages 已规范化为数组', afterWrite.pagesIsArray === true);
check('写入后 sections 已规范化为数组', afterWrite.sectionsIsArray === true);
check('写入后 websites 已规范化为数组', afterWrite.websitesIsArray === true);
check('写入后页面数量不变（无数据丢失）', afterWrite.pageCount, (v) => v === 2);
check('写入后分区数量不变（无数据丢失）', afterWrite.sectionCount, (v) => v === 2);
check('写入后网站数量不变（无数据丢失）', afterWrite.websiteCount, (v) => v === 3);
check(
  '写入后网站名称完整保留',
  afterWrite.names,
  (v) => v.includes('旧格式网站') && v.includes('旧格式网站二') && v.includes('旧格式安全站'),
);
check('收藏状态可正常切换并持久化', afterWrite.favoriteToggled, (v) => v === false);

// 切换页面，验证跨页面数据隔离在旧格式下同样成立
const switched = await evaluate(`(async () => {
  const items = [...document.querySelectorAll('.sidebar__link')];
  const target = items.find((el) => el.textContent.includes('第二个旧页面'));
  target?.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    heading: document.querySelector('.app__page-title h1')?.textContent?.trim() ?? '',
    cards: [...document.querySelectorAll('.website-card__name')].map((el) => el.textContent.trim()),
  };
})()`);
check('可切换到第二个旧页面', switched.heading, (v) => v === '第二个旧页面');
check('第二个页面的网站隔离正确', switched.cards, (v) => v.length === 1 && v[0] === '旧格式安全站');

/* ---------------- 输出 ---------------- */

console.log('\n=== My Navi 旧格式兼容性回归测试 ===\n');
for (const item of checks) {
  console.log(`  ${item.pass ? '✓' : '✗'} ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
}

if (pageErrors.length > 0) {
  console.log('\n  未捕获异常：');
  for (const error of pageErrors.slice(0, 5)) console.log(`    ${String(error).slice(0, 300)}`);
}

const fatalConsole = consoleErrors.filter(
  (text) => !/favicon|net::ERR|Failed to load resource|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(text),
);
if (fatalConsole.length > 0) {
  console.log('\n  控制台错误：');
  for (const text of fatalConsole.slice(0, 5)) console.log(`    ${text.slice(0, 240)}`);
}

const failed = checks.filter((item) => !item.pass);
if (failed.length === 0 && pageErrors.length === 0 && fatalConsole.length === 0) {
  console.log(`\n结果：全部 ${checks.length} 项通过，旧格式配置可正常加载并自动规范化。\n`);
  cleanup(0);
} else {
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过，存在需要修复的问题。\n`);
  cleanup(1);
}
