/**
 * 运行时冒烟测试（零依赖）
 *
 * 目的：验证构建产物在真实 Chromium 中能正常启动，且控制台没有报错。
 * 做法：
 *   1. 用 Node 内置 http 模块把 dist/ 作为静态站点提供；
 *   2. 启动 headless Chrome（带远程调试端口）；
 *   3. 用 Node 内置 WebSocket 连接 CDP，收集控制台消息与异常；
 *   4. 通过 Runtime.evaluate 检查关键界面元素是否渲染出来。
 *
 * 注意：这里是以普通网页方式加载（非 chrome-extension://），
 * 因此会走 localStorage 回退与 favicon 降级路径，正好可以验证"非扩展环境"的容错。
 * 扩展环境下的 chrome.* API 行为仍需在浏览器中手动加载验证，README 中已说明。
 *
 * 用法：node tools/smoke-test.mjs
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
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
  '.ico': 'image/x-icon',
};

const CHROME_CANDIDATES = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
];

const chromePath = CHROME_CANDIDATES.find((candidate) => candidate && existsSync(candidate));
if (!chromePath) {
  console.log('⚠ 未找到 Chrome/Edge，跳过运行时冒烟测试。');
  process.exit(0);
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('✗ 未找到 dist/index.html，请先执行 `npm run build`。');
  process.exit(1);
}

/* ---------------- 静态服务器 ---------------- */

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  const target = join(DIST, relative === '' ? 'index.html' : relative);

  if (!target.startsWith(DIST) || !existsSync(target)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  response.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
  response.end(readFileSync(target));
});

const port = await new Promise((resolvePort) => {
  server.listen(0, '127.0.0.1', () => resolvePort(server.address().port));
});
const pageUrl = `http://127.0.0.1:${port}/index.html`;

/* ---------------- 启动 Chrome ---------------- */

const debugPort = 9333;
const userDataDir = mkdtempSync(join(tmpdir(), 'mynavi-smoke-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu',
    '--window-size=1600,1000',
    pageUrl,
  ],
  { stdio: 'ignore', detached: false },
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

/** 轮询等待 DevTools 就绪 */
async function waitForTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('等待 Chrome 调试端口超时');
}

const target = await waitForTarget();

/* ---------------- CDP 客户端 ---------------- */

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  socket.addEventListener('open', resolveOpen, { once: true });
  socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket 连接失败')), { once: true });
});

let messageId = 0;
const pending = new Map();
const consoleMessages = [];
const pageErrors = [];

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(typeof event.data === 'string' ? event.data : '');
  if (payload.id && pending.has(payload.id)) {
    const { resolve: resolveCall, reject: rejectCall } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) rejectCall(new Error(payload.error.message));
    else resolveCall(payload.result);
    return;
  }

  if (payload.method === 'Runtime.consoleAPICalled') {
    const text = (payload.params.args ?? [])
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(' ');
    consoleMessages.push({ level: payload.params.type, text });
  }

  if (payload.method === 'Runtime.exceptionThrown') {
    const details = payload.params.exceptionDetails;
    pageErrors.push(details?.exception?.description ?? details?.text ?? '未知异常');
  }
});

function call(method, params = {}) {
  messageId += 1;
  const id = messageId;
  return new Promise((resolveCall, rejectCall) => {
    pending.set(id, { resolve: resolveCall, reject: rejectCall });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 失败');
  }
  return result.result?.value;
}

await call('Runtime.enable');
await call('Page.enable');

/**
 * 说明：headless Chrome 同样提供 chrome.storage.local，但它的存储域是真实用户配置，
 * 每次启动都是空的，无法观察"刷新后数据是否保留"。
 * 因此在页面脚本执行前把 chrome.storage.local 置空，让应用走 localStorage 回退路径
 * （同源、可跨刷新保留），这样就能真实检验持久化与刷新恢复。
 * 扩展环境（chrome-extension://）下的 chrome.storage 行为需手动加载扩展验证，README 已说明。
 */
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    try {
      Object.defineProperty(window.chrome, 'storage', { value: undefined, configurable: true });
    } catch (e) { /* 忽略 */ }
    window.__MYNAVI_SMOKE__ = !(window.chrome && window.chrome.storage);
  })();`,
});

await call('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2500));

/* ---------------- 断言 ---------------- */

const checks = [];
function check(label, value, expected) {
  const pass = expected ? expected(value) : Boolean(value);
  checks.push({ label, pass, detail: pass ? '' : `实际值：${JSON.stringify(value)?.slice(0, 220)}` });
}

const probe = await evaluate(`(() => {
  const cards = document.querySelectorAll('.website-card');
  const sections = document.querySelectorAll('.section-panel');
  const sidebarItems = document.querySelectorAll('.sidebar__item');
  const visibleCount = (nodes) => [...nodes].filter((n) => n.offsetParent !== null).length;
  return {
    title: document.title,
    hasApp: !!document.querySelector('.app'),
    sections: visibleCount(sections),
    sidebarItems: visibleCount(sidebarItems),
    cards: visibleCount(cards),
    activePage: document.querySelector('.sidebar__link--active .sidebar__page-name')?.textContent?.trim() ?? '',
    pageHeading: document.querySelector('.app__page-title h1')?.textContent?.trim() ?? '',
    emptyState: document.querySelector('.app__empty')?.textContent?.trim()?.slice(0, 60) ?? '',
    theme: document.documentElement.dataset.theme ?? '',
    density: document.documentElement.dataset.density ?? '',
    storageError: document.querySelector('.app__banner--error')?.textContent?.trim() ?? '',
    loading: !!document.querySelector('.app__loading'),
    focusables: document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]').length,
    bodyScrollWidth: document.body.scrollWidth,
    windowWidth: window.innerWidth,
  };
})()`);

check('页面标题正确', probe.title, (v) => String(v).includes('My Navi'));
check('应用根节点已挂载', probe.hasApp);
check('首屏加载态已结束', !probe.loading);
check('已写入演示数据：导航页面（右侧栏）', probe.sidebarItems, (v) => v >= 4);
check('已写入演示数据：分区', probe.sections, (v) => v >= 3);
check('已写入演示数据：网站卡片', probe.cards, (v) => v >= 8);
check('当前页面高亮已生效', probe.activePage, (v) => v === '工作台');
check('页面标题显示当前页面名', probe.pageHeading, (v) => v === '工作台');
check('主题属性已应用', probe.theme, (v) => v === 'light' || v === 'dark');
check('卡片密度属性已应用', probe.density, (v) => ['compact', 'comfortable', 'loose'].includes(v));
check('无存储错误横幅（本地回退可用）', !probe.storageError);
check('界面可聚焦元素数量充足（可访问性）', probe.focusables, (v) => v >= 20);
check('页面无横向滚动条', probe.bodyScrollWidth <= probe.windowWidth + 1);

// 主题：按 useTheme 的处理函数解析实际生效的背景色（避免只比较 dataset 造成的假阴性）
const themeResult = await evaluate(`(() => {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-9999px;width:800px;height:600px;border:0';
  document.body.appendChild(frame);
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const style = doc.createElement('style');
  style.textContent = ':root{--bg-page:#eef2f8} [data-theme="dark"]{--bg-page:#161a22}';
  doc.head.appendChild(style);

  const read = (theme) => {
    doc.documentElement.dataset.theme = theme;
    return win.getComputedStyle(doc.documentElement).getPropertyValue('--bg-page').trim();
  };
  const light = read('light');
  const dark = read('dark');
  frame.remove();
  return { light, dark };
})()`);
check('深色模式背景与浅色不同', themeResult, (v) => v.dark !== v.light && Boolean(v.dark) && Boolean(v.light));

// 主题开关：确认界面中存在主题切换控件（设置面板）
const themeControls = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('button')];
  const settingsBtn = buttons.find((el) => el.textContent.includes('设置'));
  if (!settingsBtn) return { opened: false };
  settingsBtn.click();
  return { opened: true };
})()`);
check('设置入口可点击', themeControls.opened === true);

await new Promise((r) => setTimeout(r, 400));

const settingsPanel = await evaluate(`(() => {
  const modal = document.querySelector('[data-testid="settings-modal"]');
  const radios = modal ? [...modal.querySelectorAll('[data-testid^="setting-theme-"]')].map((el) => el.textContent.trim()) : [];
  const tabs = modal ? [...modal.querySelectorAll('.n-tabs-tab')].map((el) => el.textContent.trim()) : [];
  return { hasModal: !!modal, radios, tabs };
})()`);
check('设置面板可打开', settingsPanel.hasModal);
check('包含主题模式选项（浅色/深色/跟随系统）', settingsPanel.radios, (v) =>
  ['浅色', '深色', '跟随系统'].every((label) => v.some((item) => item.includes(label))),
);
check('包含四个设置分组', settingsPanel.tabs, (v) => v.length === 4);

// 关闭设置面板
await evaluate(`(() => {
  const modal = document.querySelector('[data-testid="settings-modal"]');
  const closeBtn = modal?.querySelector('[data-testid="settings-done"]');
  closeBtn?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 300));

// 交互：点击侧边栏切换页面
const switched = await evaluate(`(() => {
  const items = [...document.querySelectorAll('.sidebar__link')];
  const target = items.find((el) => el.textContent.includes('开发工具'));
  if (!target) return null;
  target.click();
  return true;
})()`);
check('可以点击侧边栏切换导航页面', switched === true);

await new Promise((r) => setTimeout(r, 500));
const afterSwitch = await evaluate(`(() => ({
  heading: document.querySelector('.app__page-title h1')?.textContent?.trim() ?? '',
  cards: document.querySelectorAll('.website-card').length,
  sections: document.querySelectorAll('.section-panel').length,
}))()`);
check('切换后标题变为「开发工具」', afterSwitch.heading, (v) => v === '开发工具');
check('切换后展示该页面的网站（数据隔离）', afterSwitch.cards, (v) => v >= 8);

// 交互：本地搜索过滤
const search = await evaluate(`(async () => {
  const input = document.querySelector('.search-bar__input');
  if (!input) return null;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, 'github');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const panel = document.querySelector('.search-bar__panel');
  const rows = panel ? [...panel.querySelectorAll('.search-bar__row')].map((r) => r.textContent.trim()) : [];
  return { panelVisible: !!panel, rows: rows.slice(0, 4) };
})()`);
check('本地搜索面板可显示', search?.panelVisible === true);
check(
  '本地搜索命中 GitHub',
  search?.rows ?? [],
  (v) => v.some((row) => row.toLowerCase().includes('github')),
);

// 严重错误统计（忽略资源加载失败：演示数据中的示例域名并不存在）
const fatalConsole = consoleMessages.filter(
  (item) =>
    item.level === 'error' &&
    !/favicon|net::ERR|Failed to load resource|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION/i.test(item.text),
);

// 持久化：修改数据后刷新页面，验证配置仍然存在
const beforeReload = await evaluate(`(() => {
  const items = [...document.querySelectorAll('.sidebar__link')];
  const target = items.find((el) => el.textContent.includes('安全运营'));
  target?.click();
  return { clicked: !!target };
})()`);
check('可以切换到「安全运营」页面', beforeReload.clicked === true);

await new Promise((r) => setTimeout(r, 400));

const mutate = await evaluate(`(async () => {
  // 1) 折叠第一个分区，触发一次真实的状态写入
  const header = document.querySelector('.section-panel__header .section-panel__collapse');
  header?.click();
  await new Promise((r) => setTimeout(r, 900));
  const collapsed = !!document.querySelector('.section-panel__header--collapsed');
  const collapsedInStore = JSON.parse(localStorage.getItem('mynavi:state') ?? '{}')
    .sections.filter((s) => s.collapsed).length;

  // 2) 切换主题为深色，验证设置也被持久化
  const buttons = [...document.querySelectorAll('button')];
  buttons.find((el) => el.textContent.trim() === '设置')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const modal = document.querySelector('[data-testid="settings-modal"]');
  const darkRadio = modal?.querySelector('[data-testid="setting-theme-dark"]');
  darkRadio?.click();
  await new Promise((r) => setTimeout(r, 900));
  const theme = document.documentElement.dataset.theme;
  document.querySelector('[data-testid="settings-done"]')?.click();
  await new Promise((r) => setTimeout(r, 300));

  // 3) 删除一个网站并确认二次确认对话框可用（验证危险操作的确认链路 + 防抖写入落盘）
  const cardsBefore = document.querySelectorAll('.website-card').length;
  const firstDeleteButton = document.querySelector('.website-card__action[aria-label="删除网站"]');
  let dialogText = '';
  firstDeleteButton?.click();
  await new Promise((r) => setTimeout(r, 400));
  const dialog = document.querySelector('dialog[open].confirm, dialog.confirm[open]') ?? document.querySelector('dialog[open]');
  dialogText = (dialog?.textContent ?? '').trim().slice(0, 40);
  // 点击确认删除（危险样式按钮）
  const confirmButton = dialog?.querySelector('.btn--danger');
  confirmButton?.click();
  await new Promise((r) => setTimeout(r, 900));

  const state = JSON.parse(localStorage.getItem('mynavi:state') ?? '{}');
  const storedOnActivePage = Array.isArray(state.websites)
    ? state.websites.filter((w) => w.pageId === state.activePageId).length
    : -1;
  return {
    collapsed,
    collapsedInStore,
    theme,
    dialogText,
    cardsBefore,
    cardsAfter: document.querySelectorAll('.website-card').length,
    storedOnActivePage,
    storedTheme: state.settings ? state.settings.theme : null,
    storedActivePage: state.activePageId ?? '',
  };
})()`);

/* ---------------- 导航栏左右布局 ---------------- */

/** 读取侧边栏相对主内容区的位置 */
const readSidebarSide = () => evaluate(`(() => {
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.app__main');
  if (!sidebar || !main) return null;
  const s = sidebar.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  return {
    attr: app ? app.dataset.sidebarPosition : null,
    sidebarCenterX: Math.round(s.x + s.width / 2),
    mainCenterX: Math.round(m.x + m.width / 2),
    // 侧边栏中心在主内容区中心的左边 → 位于左侧
    side: s.x + s.width / 2 < m.x + m.width / 2 ? 'left' : 'right',
    borderLeft: getComputedStyle(sidebar).borderLeftWidth,
    borderRight: getComputedStyle(sidebar).borderRightWidth,
    sidebarVisible: s.width > 0 && s.height > 0,
  };
})()`);

const sidebarDefault = await readSidebarSide();
check('导航栏默认位于右侧', sidebarDefault?.side, (v) => v === 'right');
check('默认布局下侧边栏有可见尺寸', sidebarDefault?.sidebarVisible === true);

// 打开设置 → 外观分组，切换到「左侧」
const sidebarLeft = await evaluate(`(async () => {
  const buttons = [...document.querySelectorAll('button')];
  buttons.find((el) => el.textContent.trim() === '设置')?.click();
  await new Promise((r) => setTimeout(r, 450));
  const modal = document.querySelector('[data-testid="settings-modal"]');
  const positionRadios = [...(modal?.querySelectorAll('[data-testid^="setting-sidebar-"]') ?? [])]
    .filter((el) => ['左侧', '右侧'].includes(el.textContent.trim()));
  const leftRadio = modal?.querySelector('[data-testid="setting-sidebar-left"]');
  leftRadio?.click();
  await new Promise((r) => setTimeout(r, 550));
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.app__main');
  const s = sidebar.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  const state = JSON.parse(localStorage.getItem('mynavi:state') ?? '{}');
  return {
    optionCount: positionRadios.length,
    attr: app ? app.dataset.sidebarPosition : null,
    side: s.x + s.width / 2 < m.x + m.width / 2 ? 'left' : 'right',
    borderLeft: getComputedStyle(sidebar).borderLeftWidth,
    borderRight: getComputedStyle(sidebar).borderRightWidth,
    stored: state.settings ? state.settings.sidebarPosition : null,
  };
})()`);

check('设置中包含「左侧 / 右侧」两个选项', sidebarLeft.optionCount, (v) => v === 2);
check('切换到左侧后导航栏确实位于左边', sidebarLeft.side, (v) => v === 'left');
check('左侧布局下根节点标记为 left', sidebarLeft.attr, (v) => v === 'left');
check('左侧布局时分隔线画在右边', sidebarLeft.borderRight, (v) => parseFloat(v) > 0);
check('左侧布局时左边没有多余边框', sidebarLeft.borderLeft, (v) => parseFloat(v) === 0);
check('导航栏位置已写入存储', sidebarLeft.stored, (v) => v === 'left');

// 切回右侧并关闭设置
const sidebarBack = await evaluate(`(async () => {
  const modal = document.querySelector('[data-testid="settings-modal"]');
  const rightRadio = modal?.querySelector('[data-testid="setting-sidebar-right"]');
  rightRadio?.click();
  await new Promise((r) => setTimeout(r, 550));
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.app__main');
  const s = sidebar.getBoundingClientRect();
  const m = main.getBoundingClientRect();
  const side = s.x + s.width / 2 < m.x + m.width / 2 ? 'left' : 'right';
  // 关闭设置面板
  document.querySelector('[data-testid="settings-done"]')?.click();
  await new Promise((r) => setTimeout(r, 350));
  return { attr: app ? app.dataset.sidebarPosition : null, side };
})()`);
check('切回右侧后导航栏回到右边', sidebarBack.side, (v) => v === 'right');
check('切回右侧后根节点标记为 right', sidebarBack.attr, (v) => v === 'right');
check('分区可折叠且状态已生效', mutate.collapsed === true);
check('折叠状态已写入存储（防抖写入正常落盘）', mutate.collapsedInStore, (v) => v >= 1);
check('主题可切换为深色', mutate.theme, (v) => v === 'dark');
check('删除网站会弹出二次确认', mutate.dialogText, (v) => String(v).includes('删除网站'));
check('确认后网站卡片数量减少', mutate.cardsAfter, (v) => v === mutate.cardsBefore - 1);
check('删除结果已写入存储', mutate.storedOnActivePage, (v) => v === mutate.cardsAfter);
check('当前页面 id 已随状态持久化', mutate.storedActivePage, (v) => typeof v === 'string' && v.length > 0);

if (process.env.MYNAVI_DEBUG === '1') {
  console.log('\n  [debug] mutate =', JSON.stringify(mutate, null, 2));
}

// 刷新页面
await call('Page.reload', { ignoreCache: false });
await new Promise((r) => setTimeout(r, 2800));

const afterReload = await evaluate(`(() => {
  const store = JSON.parse(localStorage.getItem('mynavi:state') ?? 'null');
  return {
    activePage: document.querySelector('.sidebar__link--active .sidebar__page-name')?.textContent?.trim() ?? '',
    theme: document.documentElement.dataset.theme ?? '',
    collapsedSections: document.querySelectorAll('.section-panel__header--collapsed').length,
    cards: document.querySelectorAll('.website-card').length,
    loading: !!document.querySelector('.app__loading'),
    storageKeys: Object.keys(localStorage),
    storageShimmed: window.__MYNAVI_SMOKE__ === true,
    storedPages: store ? store.pages.length : 0,
    storedTheme: store ? store.settings.theme : null,
    storedSidebarPosition: store && store.settings ? store.settings.sidebarPosition : null,
    sidebarAttr: document.querySelector('.app')?.dataset.sidebarPosition ?? null,
    sidebarIsRight: (() => {
      const sidebar = document.querySelector('.sidebar');
      const main = document.querySelector('.app__main');
      if (!sidebar || !main) return null;
      const s = sidebar.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      return s.x + s.width / 2 >= m.x + m.width / 2;
    })(),
    bootTrace: window.__MYNAVI__ ? window.__MYNAVI__.bootTrace() : null,
  };
})()`);

check('测试环境已切换到 localStorage 回退路径', afterReload.storageShimmed === true);
check('刷新后 localStorage 中仍有 My Navi 配置', afterReload.storageKeys, (v) =>
  v.includes('mynavi:state'),
);

if (process.env.MYNAVI_DEBUG === '1') {
  const dump = await evaluate(`(() => {
    const out = {};
    for (const key of Object.keys(localStorage)) {
      const raw = localStorage.getItem(key) ?? '';
      out[key] = raw.slice(0, 160);
    }
    return out;
  })()`);
  console.log('\n  [debug] localStorage 内容：', JSON.stringify(dump, null, 2));
}
check('刷新后仍停留在「安全运营」页面', afterReload.activePage, (v) => v === '安全运营');
check('刷新后主题保持深色（设置已持久化）', afterReload.theme, (v) => v === 'dark');
check('刷新后配置文档中主题为 dark', afterReload.storedTheme, (v) => v === 'dark');
check('刷新后 4 个导航页面全部保留', afterReload.storedPages, (v) => v === 4);
check('刷新后启动轨迹为「读取已保存配置」', afterReload.bootTrace?.decision, (v) => v === 'use-stored');
check('刷新后分区折叠状态被保留（导航数据已持久化）', afterReload.collapsedSections, (v) => v >= 1);
check('刷新后网站卡片正常渲染', afterReload.cards, (v) => v >= 8);
check('刷新后不再显示加载态', afterReload.loading === false);
check('刷新后导航栏位置设置被保留', afterReload.storedSidebarPosition, (v) => v === 'right');
check('刷新后根节点仍标记为 right', afterReload.sidebarAttr, (v) => v === 'right');
check('刷新后导航栏仍渲染在右侧', afterReload.sidebarIsRight === true);

/* ---------------- 输出 ---------------- */

console.log('\n=== My Navi 运行时冒烟测试（headless Chrome） ===\n');
for (const item of checks) {
  console.log(`  ${item.pass ? '✓' : '✗'} ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
}

if (consoleMessages.length > 0) {
  console.log('\n  控制台输出：');
  for (const item of consoleMessages.slice(0, 20)) console.log(`    [${item.level}] ${item.text.slice(0, 200)}`);
}

if (pageErrors.length > 0) {
  console.log('\n  未捕获异常：');
  for (const error of pageErrors.slice(0, 10)) console.log(`    ${String(error).slice(0, 400)}`);
}

const failed = checks.filter((item) => !item.pass);
const okAll = failed.length === 0 && pageErrors.length === 0 && fatalConsole.length === 0;

if (!okAll) {
  if (fatalConsole.length > 0) {
    console.log('\n  控制台错误：');
    for (const item of fatalConsole.slice(0, 10)) console.log(`    ${item.text.slice(0, 240)}`);
  }
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过，存在需要修复的问题。\n`);
  cleanup(1);
} else {
  console.log(`\n结果：全部 ${checks.length} 项通过，无未捕获异常与控制台错误。\n`);
  cleanup(0);
}
