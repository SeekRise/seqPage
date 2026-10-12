/**
 * My Navi 图标生成脚本（零依赖）
 *
 * 作用：把内置的矢量描述光栅化为 PNG，生成扩展所需的 16/32/48/128(及 192) 图标，
 * 避免引入 sharp/canvas 之类的重型依赖，也避免从网络下载图片资源。
 *
 * 图形：柔和圆角方块（低饱和蓝渐变）+ 白色「导航九宫格」。
 * 光栅化采用 3x3 超采样抗锯齿。
 *
 * 用法：node tools/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../public/icons');

/* ------------------------------------------------------------------ *
 * PNG 编码
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param {number} width @param {number} height @param {Uint8Array} rgba */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * 几何与绘制
 * ------------------------------------------------------------------ */

/** 圆角矩形的有符号距离场（<0 表示在形状内部） */
function sdRoundRect(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function inside(distance) {
  return distance <= 0;
}

/** 在归一化坐标系(0..1)中描述图形 */
function drawIcon(size) {
  const ss = 3; // 超采样倍数
  const out = new Uint8Array(size * size * 4);

  const topColor = [0x5b, 0x8c, 0xf5];
  const bottomColor = [0x33, 0x66, 0xd6];
  const radius = 0.22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          // 归一化到 0..1，取采样点中心
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;

          if (!inside(sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, radius))) continue;

          // 底色：竖向渐变
          const t = v;
          let cr = topColor[0] + (bottomColor[0] - topColor[0]) * t;
          let cg = topColor[1] + (bottomColor[1] - topColor[1]) * t;
          let cb = topColor[2] + (bottomColor[2] - topColor[2]) * t;

          // 覆盖层：白色导航块
          const blocks = [
            // 上排两个方块
            sdRoundRect(u, v, 0.345, 0.395, 0.115, 0.115, 0.035),
            sdRoundRect(u, v, 0.655, 0.395, 0.115, 0.115, 0.035),
          ];
          // 底部通栏
          blocks.push(sdRoundRect(u, v, 0.5, 0.675, 0.27, 0.1, 0.035));

          if (blocks.some(inside)) {
            cr = 255;
            cg = 255;
            cb = 255;
          }

          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }

      const samples = ss * ss;
      const idx = (y * size + x) * 4;
      if (a === 0) continue;
      const covered = a / 255;
      out[idx] = Math.round(r / covered);
      out[idx + 1] = Math.round(g / covered);
      out[idx + 2] = Math.round(b / covered);
      out[idx + 3] = Math.round(a / samples);
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });

const SIZES = [16, 32, 48, 128, 192];
for (const size of SIZES) {
  const rgba = drawIcon(size);
  const png = encodePng(size, size, rgba);
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`generated ${file} (${png.length} bytes)`);
}

// 同时输出一份 SVG 源文件，方便后续替换或再生成
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="My Navi">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5B8CF5"/>
      <stop offset="1" stop-color="#3366D6"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <rect x="29" y="36" width="30" height="30" rx="9" fill="#fff"/>
  <rect x="69" y="36" width="30" height="30" rx="9" fill="#fff"/>
  <rect x="29" y="78" width="70" height="22" rx="8" fill="#fff"/>
</svg>
`;
writeFileSync(resolve(OUT_DIR, 'icon.svg'), svg, 'utf8');
console.log(`generated ${resolve(OUT_DIR, 'icon.svg')}`);
