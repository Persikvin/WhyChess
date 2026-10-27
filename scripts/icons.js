import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, radius) {
  const cx = Math.min(x, 1 - x);
  const cy = Math.min(y, 1 - y);
  if (cx >= radius || cy >= radius) return cx >= 0 && cy >= 0;
  const dx = radius - cx;
  const dy = radius - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(px - x, py - y);
}

function insideTriangle(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = sign({ x: px, y: py }, a, b);
  const d2 = sign({ x: px, y: py }, b, c);
  const d3 = sign({ x: px, y: py }, c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

const BG_TOP = [27, 43, 72];
const BG_BOTTOM = [8, 16, 29];
const BOARD_LIGHT = [38, 56, 84];
const BOARD_DARK = [20, 33, 58];
const GOLD = [242, 193, 78];
const GOLD_LIGHT = [255, 224, 138];

function sample(u, v) {
  if (!insideRoundedRect(u, v, 0.22)) return [0, 0, 0, 0];

  let color = mix(BG_TOP, BG_BOTTOM, Math.min(1, Math.max(0, (u + v) / 2)));
  const boardMin = 0.11;
  const boardMax = 0.89;
  if (u >= boardMin && u <= boardMax && v >= boardMin && v <= boardMax) {
    const fx = Math.min(7, Math.floor(((u - boardMin) / (boardMax - boardMin)) * 8));
    const fy = Math.min(7, Math.floor(((v - boardMin) / (boardMax - boardMin)) * 8));
    color = (fx + fy) % 2 === 0 ? BOARD_LIGHT : BOARD_DARK;
  }

  const start = { x: 0.29, y: 0.71 };
  const end = { x: 0.72, y: 0.28 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const shaftStart = { x: start.x + ux * 0.025, y: start.y + uy * 0.025 };
  const shaftEnd = { x: end.x - ux * 0.13, y: end.y - uy * 0.13 };
  const headBase = { x: end.x - ux * 0.22, y: end.y - uy * 0.22 };
  const wing = 0.13;

  const onShaft = distanceToSegment(u, v, shaftStart.x, shaftStart.y, shaftEnd.x, shaftEnd.y) <= 0.055;
  const onHead = insideTriangle(
    u,
    v,
    end,
    { x: headBase.x - uy * wing, y: headBase.y + ux * wing },
    { x: headBase.x + uy * wing, y: headBase.y - ux * wing },
  );

  if (onShaft || onHead) {
    color = mix(GOLD, GOLD_LIGHT, Math.max(0, 1 - (u + v)));
  }

  return [color[0], color[1], color[2], 255];
}

function render(size) {
  const offsets = [0.125, 0.375, 0.625, 0.875];
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const oy of offsets) {
        for (const ox of offsets) {
          const [sr, sg, sb, sa] = sample((x + ox) / size, (y + oy) / size);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += alpha;
        }
      }
      const index = (y * size + x) * 4;
      if (a > 0) {
        rgba[index] = Math.round(r / a);
        rgba[index + 1] = Math.round(g / a);
        rgba[index + 2] = Math.round(b / a);
        rgba[index + 3] = Math.round((a / 16) * 255);
      }
    }
  }
  return rgba;
}

export function generateIcons(directory, sizes = [16, 32, 48, 96, 128]) {
  const icons = [];
  for (const size of sizes) {
    const rgba = render(size);
    icons.push({ size, png: encodePng(size, size, rgba) });
  }
  return icons;
}
