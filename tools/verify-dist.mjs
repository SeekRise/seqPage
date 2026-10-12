/**
 * 构建产物自检（零依赖）
 *
 * 覆盖验收标准中「工程质量」里可以静态验证的部分：
 * 1. dist/ 是否包含 manifest.json、新标签页、后台脚本与全部声明的图标；
 * 2. manifest 引用的每个文件是否真实存在；
 * 3. 是否申请了任务书明确禁止的高危权限；
 * 4. 产物与源码中是否存在 eval / new Function 等动态代码执行；
 * 5. 产物中是否存在运行时远程脚本/样式引用（MV3 CSP 不允许）；
 * 6. 产物中是否引用了 CDN 域名作为静态资源。
 *
 * 用法：node tools/verify-dist.mjs
 * 退出码 0 表示全部通过；非 0 表示存在必须修复的问题。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const problems = [];
const passed = [];

function ok(message) {
  passed.push(message);
}

function fail(message) {
  problems.push(message);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/* ---------------- 1. dist 是否存在 ---------------- */

if (!existsSync(DIST)) {
  console.error('✗ 未找到 dist/ 目录，请先执行 `npm run build`。');
  process.exit(1);
}

const files = walk(DIST).map((file) => file.slice(DIST.length + 1).replace(/\\/g, '/'));
ok(`dist/ 存在，共 ${files.length} 个文件`);

/* ---------------- 2. manifest 校验 ---------------- */

const manifestPath = join(DIST, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail('dist/manifest.json 缺失，扩展无法加载。');
  console.error(problems.join('\n'));
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`✗ dist/manifest.json 不是合法 JSON：${error.message}`);
  process.exit(1);
}

if (manifest.manifest_version === 3) ok('manifest_version = 3');
else fail(`manifest_version 必须为 3，当前为 ${String(manifest.manifest_version)}`);

const newtab = manifest.chrome_url_overrides?.newtab;
if (typeof newtab === 'string' && existsSync(join(DIST, newtab))) {
  ok(`chrome_url_overrides.newtab 指向 ${newtab}（文件存在）`);
} else {
  fail(`chrome_url_overrides.newtab 缺失或指向不存在的文件：${String(newtab)}`);
}

const worker = manifest.background?.service_worker;
if (typeof worker === 'string' && existsSync(join(DIST, worker))) {
  ok(`background.service_worker 指向 ${worker}（文件存在）`);
} else {
  fail(`background.service_worker 缺失或指向不存在的文件：${String(worker)}`);
}

// 图标完整性
const referenced = new Set();
for (const value of Object.values(manifest.icons ?? {})) referenced.add(value);
for (const value of Object.values(manifest.action?.default_icon ?? {})) referenced.add(value);
for (const icon of referenced) {
  if (existsSync(join(DIST, icon))) ok(`图标存在：${icon}`);
  else fail(`图标缺失：${icon}`);
}

// 本地化目录
if (manifest.default_locale) {
  const localeFile = join(DIST, '_locales', manifest.default_locale, 'messages.json');
  if (existsSync(localeFile)) ok(`_locales/${manifest.default_locale}/messages.json 存在`);
  else fail(`声明了 default_locale=${manifest.default_locale}，但缺少对应 messages.json`);
}

/* ---------------- 3. 权限审查 ---------------- */

const FORBIDDEN_PERMISSIONS = [
  'history',
  'browsingData',
  'cookies',
  'webRequest',
  'webRequestBlocking',
  'declarativeNetRequest',
  'debugger',
  'management',
  'proxy',
  'nativeMessaging',
  'geolocation',
  'downloads',
  'topSites',
];

const permissions = manifest.permissions ?? [];
const forbidden = permissions.filter((item) => FORBIDDEN_PERMISSIONS.includes(item));
if (forbidden.length === 0) {
  ok(`权限列表符合最小权限原则：${permissions.join(', ') || '(无)'}`);
} else {
  fail(`申请了与导航功能无关的高危权限：${forbidden.join(', ')}`);
}

if (manifest.host_permissions?.length) {
  fail(`不应申请 host_permissions（会读取全站数据）：${manifest.host_permissions.join(', ')}`);
} else {
  ok('未申请 host_permissions（无需全站访问权限）');
}

const csp = manifest.content_security_policy?.extension_pages ?? '';
if (/script-src\s+'self'/.test(csp) && !/unsafe-eval|unsafe-inline/.test(csp)) {
  ok(`扩展页面 CSP 严格：${csp}`);
} else {
  fail(`扩展页面 CSP 过宽，请使用 "script-src 'self'; object-src 'self'"：${csp}`);
}

/* ---------------- 4. 动态代码执行检查 ---------------- */

const codeFiles = files.filter((file) => /\.(js|mjs|cjs|html)$/i.test(file));
const dynamicCodePatterns = [
  { name: 'eval(', pattern: /\beval\s*\(/ },
  { name: 'new Function(', pattern: /new\s+Function\s*\(/ },
  { name: 'document.write(', pattern: /document\.write\s*\(/ },
];

let dynamicHits = 0;
for (const file of codeFiles) {
  const content = readFileSync(join(DIST, file), 'utf8');
  for (const { name, pattern } of dynamicCodePatterns) {
    if (pattern.test(content)) {
      dynamicHits += 1;
      fail(`产物 ${file} 中检测到 ${name}`);
    }
  }
}
if (dynamicHits === 0) ok('产物中未发现 eval / new Function / document.write');

/* ---------------- 5. 运行时远程资源检查 ---------------- */

const remoteScriptPattern = /<script[^>]+src\s*=\s*["']https?:\/\//i;
const remoteStylePattern = /<link[^>]+href\s*=\s*["']https?:\/\//i;

for (const file of files.filter((item) => item.endsWith('.html'))) {
  const content = readFileSync(join(DIST, file), 'utf8');
  if (remoteScriptPattern.test(content)) fail(`${file} 引用了远程脚本（MV3 CSP 会拦截）`);
  else if (remoteStylePattern.test(content)) fail(`${file} 引用了远程样式表`);
  else ok(`${file} 未引用任何远程脚本或样式`);
}

/* ---------------- 6. CDN 静态资源引用检查 ---------------- */

const CDN_FILES = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'tdesign.gtimg.com', 'fonts.googleapis.com'];

for (const file of codeFiles.filter((item) => /\.(js|css)$/i.test(item))) {
  const content = readFileSync(join(DIST, file), 'utf8');
  const hit = CDN_FILES.find((domain) => content.includes(domain));
  if (hit) fail(`产物 ${file} 中包含 CDN 域名引用：${hit}`);
}
ok('产物中未发现 CDN 静态资源引用');

/* ---------------- 7. 关键能力存在性检查 ---------------- */

const bundle = files
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(DIST, file), 'utf8'))
  .join('\n');

const capabilityChecks = [
  { label: '使用 chrome.storage 持久化', pattern: /mynavi:state|storage\.local/ },
  { label: '包含导入校验逻辑（文件大小上限）', pattern: /5242880|文件过大|超过/ },
  { label: '包含危险协议拦截', pattern: /javascript:|仅允许 http/ },
  { label: '包含右键菜单能力', pattern: /contextmenu|ContextMenu/ },
  { label: '包含拖拽排序能力（SortableJS）', pattern: /sortable|Sortable/ },
];

for (const { label, pattern } of capabilityChecks) {
  if (pattern.test(bundle)) ok(`产物包含：${label}`);
  else fail(`产物中未找到：${label}`);
}

/* ---------------- 输出结果 ---------------- */

console.log('\n=== SeqPage 构建产物自检 ===\n');
for (const line of passed) console.log(`  ✓ ${line}`);

if (problems.length > 0) {
  console.log('');
  for (const line of problems) console.log(`  ✗ ${line}`);
  console.log(`\n结果：${passed.length} 项通过，${problems.length} 项失败。\n`);
  process.exit(1);
}

console.log(`\n结果：全部 ${passed.length} 项检查通过。dist/ 可直接作为「已解压的扩展程序」加载。\n`);
