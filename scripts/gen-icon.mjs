// Gera app-icon.png (512x512) usado pelo `tauri icon`. Sem dependências externas.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 512;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

const BG = [26, 27, 35];
const PANES = [
  [166, 139, 255],
  [79, 209, 139],
  [243, 201, 105],
  [255, 107, 129],
];

function insideRounded(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let color = null;
    if (insideRounded(x, y, 16, 16, 496, 496, 96)) color = BG;
    // 2x2 painéis
    const cells = [
      [80, 80, 248, 248],
      [264, 80, 432, 248],
      [80, 264, 248, 432],
      [264, 264, 432, 432],
    ];
    cells.forEach(([x0, y0, x1, y1], i) => {
      if (insideRounded(x, y, x0, y0, x1, y1, 22)) color = PANES[i];
    });
    const offset = (y * SIZE + x) * 4;
    if (color) {
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync('app-icon.png', png);
console.log('app-icon.png gerado');
