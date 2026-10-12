/**
 * 扩展打包脚本（零依赖）
 *
 * 把 dist/ 打成一个 zip：它既是 Chrome Web Store 的提交格式，
 * 也是分发给别人时最省事的形态（对方解压后在 chrome://extensions
 * 用「加载已解压的扩展程序」即可）。
 *
 * 为什么不调 PowerShell Compress-Archive、也不引入 archiver：
 * 本仓库工具链刻意保持零依赖（参见 generate-icons.mjs 手写 PNG 编码器），
 * 而 zip 只需要 store / deflate 两条最简路径，node:zlib 已经提供了 deflate。
 *
 * 产物时间戳固定为 1980-01-01：内容不变则 zip 逐字节一致，
 * 便于比对「重新打包后产物是否真的变了」。
 *
 * 用法：node tools/package-extension.mjs
 * 前置：npm run build（dist/manifest.json 必须存在）
 */
import { deflateRawSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/* ------------------------------------------------------------------ *
 * ZIP 基础件
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 固定的 DOS 时间戳：1980-01-01 00:00:00（让打包结果可复现） */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const STORE = 0;
const DEFLATE = 8;

function localHeader(nameLength, method, crc, compressedSize, rawSize) {
  const buf = Buffer.alloc(30);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(20, 4); // 解压所需版本
  buf.writeUInt16LE(0x0800, 6); // 位 11：文件名按 UTF-8 解释
  buf.writeUInt16LE(method, 8);
  buf.writeUInt16LE(DOS_TIME, 10);
  buf.writeUInt16LE(DOS_DATE, 12);
  buf.writeUInt32LE(crc, 14);
  buf.writeUInt32LE(compressedSize, 18);
  buf.writeUInt32LE(rawSize, 22);
  buf.writeUInt16LE(nameLength, 26);
  buf.writeUInt16LE(0, 28); // 扩展字段长度
  return buf;
}

function centralHeader(nameLength, method, crc, compressedSize, rawSize, offset) {
  const buf = Buffer.alloc(46);
  buf.writeUInt32LE(0x02014b50, 0);
  buf.writeUInt16LE(20, 4); // 创建版本
  buf.writeUInt16LE(20, 6); // 解压所需版本
  buf.writeUInt16LE(0x0800, 8);
  buf.writeUInt16LE(method, 10);
  buf.writeUInt16LE(DOS_TIME, 12);
  buf.writeUInt16LE(DOS_DATE, 14);
  buf.writeUInt32LE(crc, 16);
  buf.writeUInt32LE(compressedSize, 20);
  buf.writeUInt32LE(rawSize, 24);
  buf.writeUInt16LE(nameLength, 28);
  buf.writeUInt16LE(0, 30); // 扩展字段
  buf.writeUInt16LE(0, 32); // 注释
  buf.writeUInt16LE(0, 34); // 起始磁盘号
  buf.writeUInt16LE(0, 36); // 内部属性
  buf.writeUInt32LE(0, 38); // 外部属性
  buf.writeUInt32LE(offset, 42); // 对应 local header 的偏移
  return buf;
}

function endOfCentralDirectory(count, cdSize, cdOffset) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(0, 4); // 本磁盘号
  buf.writeUInt16LE(0, 6); // 中央目录所在磁盘号
  buf.writeUInt16LE(count, 8);
  buf.writeUInt16LE(count, 10);
  buf.writeUInt32LE(cdSize, 12);
  buf.writeUInt32LE(cdOffset, 16);
  buf.writeUInt16LE(0, 20); // 注释长度
  return buf;
}

/* ------------------------------------------------------------------ *
 * 收集 dist 并打包
 * ------------------------------------------------------------------ */

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error('未找到 dist/manifest.json，请先执行 npm run build。');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const outFile = join(ROOT, `${pkg.name}-${manifest.version}.zip`);

// 排序让打包顺序稳定，产物可复现
const files = collectFiles(DIST).sort();

const chunks = [];
const entries = [];
let offset = 0;
let rawTotal = 0;

for (const file of files) {
  // zip 内部一律用正斜杠，Windows 的反斜杠会被解压工具当成文件名的一部分
  const name = relative(DIST, file).split(sep).join('/');
  const nameBuf = Buffer.from(name, 'utf8');
  const data = readFileSync(file);

  const deflated = deflateRawSync(data, { level: 9 });
  // 已经压过的资源（PNG 等）再 deflate 往往更大，此时直接 store
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;
  const method = useDeflate ? DEFLATE : STORE;

  const crc = crc32(data);
  const local = localHeader(nameBuf.length, method, crc, payload.length, data.length);

  chunks.push(local, nameBuf, payload);
  entries.push(
    centralHeader(nameBuf.length, method, crc, payload.length, data.length, offset),
    nameBuf,
  );

  offset += local.length + nameBuf.length + payload.length;
  rawTotal += data.length;
}

const centralSize = entries.reduce((sum, buf) => sum + buf.length, 0);
const zip = Buffer.concat([
  ...chunks,
  ...entries,
  endOfCentralDirectory(files.length, centralSize, offset),
]);

writeFileSync(outFile, zip);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
console.log(`已生成 ${outFile}`);
console.log(`  文件 ${files.length} 个 · 原始 ${kb(rawTotal)} → 压缩后 ${kb(zip.length)}`);
console.log(`  版本 ${manifest.version}（来自 dist/manifest.json）`);
console.log('  安装：解压后在 chrome://extensions 用「加载已解压的扩展程序」选择解压目录');
