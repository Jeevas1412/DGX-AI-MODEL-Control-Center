import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, '../build/icon.ico');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return output;
}

function createPngIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const centre = (size - 1) / 2;
  const setPixel = (x, y, red, green, blue, alpha) => {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    raw[offset] = red;
    raw[offset + 1] = green;
    raw[offset + 2] = blue;
    raw[offset + 3] = alpha;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      if (distance <= 116) setPixel(x, y, 20, 220, 120, 255);
      if (distance <= 86) setPixel(x, y, 12, 31, 70, 255);
      if (distance <= 24) setPixel(x, y, 20, 220, 120, 255);
      if (distance <= 13) setPixel(x, y, 244, 255, 250, 255);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(6, 9);
  header.writeUInt8(0, 10);
  header.writeUInt8(0, 11);
  header.writeUInt8(0, 12);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = createPngIcon(256);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const directory = Buffer.alloc(16);
directory.writeUInt8(0, 0);
directory.writeUInt8(0, 1);
directory.writeUInt8(0, 2);
directory.writeUInt8(0, 3);
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(32, 6);
directory.writeUInt32LE(png.length, 8);
directory.writeUInt32LE(22, 12);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, Buffer.concat([header, directory, png]));
console.log(`Generated Windows icon: ${outputPath}`);
