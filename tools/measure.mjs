/**
 * 布局测量工具：输出卡片与内部的真实尺寸，用于定位样式问题。
 * 用法：node tools/measure.mjs
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
const chromePath = `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  const target = join(DIST, rel === '' ? 'index.html' : rel);
  if (!target.startsWith(DIST) || !existsSync(target)) {
    res.writeHead(404).end('nf');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const debugPort = 9666;
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mynavi-measure-'))}`,
    '--no-first-run',
    '--disable-extensions',
    '--disable-gpu',
    '--window-size=1600,1000',
    `http://127.0.0.1:${port}/index.html`,
  ],
  { stdio: 'ignore' },
);

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
  throw new Error('timeout');
}

const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => socket.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const p = JSON.parse(e.data);
  if (p.id && pending.has(p.id)) {
    const { resolve: res, reject: rej } = pending.get(p.id);
    pending.delete(p.id);
    p.error ? rej(new Error(p.error.message)) : res(p.result);
  }
});
const call = (method, params = {}) =>
  new Promise((res, rej) => {
    id += 1;
    pending.set(id, { resolve: res, reject: rej });
    socket.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.value;
};

await call('Runtime.enable');
await new Promise((r) => setTimeout(r, 2500));

const info = await evaluate(`(() => {
  const grid = document.querySelector('.section-panel__grid');
  const card = document.querySelector('.website-card');
  const main = card?.querySelector('.website-card__main');
  const icon = card?.querySelector('.website-card__icon');
  const text = card?.querySelector('.website-card__text');
  const name = card?.querySelector('.website-card__name');
  const desc = card?.querySelector('.website-card__desc');
  const actions = card?.querySelector('.website-card__actions');
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) }; };
  const cs = (el, props) => { if (!el) return null; const c = getComputedStyle(el); const o = {}; for (const p of props) o[p] = c.getPropertyValue(p); return o; };
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    grid: { ...rect(grid), cols: cs(grid, ['grid-template-columns','gap','width']) },
    card: rect(card),
    main: { ...rect(main), ...cs(main, ['display','padding','gap','flex']) },
    icon: { ...rect(icon), ...cs(icon, ['width','flex']) },
    text: { ...rect(text), ...cs(text, ['min-width','flex','width','overflow']) },
    name: { ...rect(name), ...cs(name, ['white-space','overflow','text-overflow','font-size']) },
    desc: rect(desc),
    actions: rect(actions),
    nameText: name?.textContent,
  };
})()`);

console.log(JSON.stringify(info, null, 2));

try {
  chrome.kill();
} catch {
  /* ignore */
}
server.close();
process.exit(0);
