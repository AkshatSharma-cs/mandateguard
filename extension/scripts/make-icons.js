// extension/scripts/make-icons.js
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data) { let c = 0xffffffff; for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, crc]); }
function makePng(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const blue = [0, 41, 148, 255], white = [255, 255, 255, 255];
  const pattern = ['10001', '11011', '10101', '10101', '10101', '10101', '10101'];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const corner = Math.min(x, y, size - 1 - x, size - 1 - y), rounded = corner >= Math.ceil(size * 0.16) || ((x - (corner < Math.ceil(size * 0.16) ? (x < size / 2 ? Math.ceil(size * 0.16) : size - 1 - Math.ceil(size * 0.16)) : x)) ** 2 + (y - (corner < Math.ceil(size * 0.16) ? (y < size / 2 ? Math.ceil(size * 0.16) : size - 1 - Math.ceil(size * 0.16)) : y)) ** 2 <= (size * 0.16) ** 2);
    const sx = Math.floor(x * 5 / size), sy = Math.floor((y - size * 0.23) * 7 / (size * 0.54));
    const isM = sx >= 0 && sx < 5 && sy >= 0 && sy < 7 && pattern[sy][sx] === '1';
    const offset = y * (size * 4 + 1) + 1 + x * 4; pixels.set(isM && rounded ? white : blue, offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir(path.join(root, 'icons'), { recursive: true });
for (const size of [16, 48, 128]) await writeFile(path.join(root, 'icons', `${size}.png`), makePng(size));
