// Generates src-tauri/icons/app-icon.png (1024×1024 RGBA) without external deps:
// indigo→violet gradient rounded square + white toolbox glyph (handle + body + latch).
// Rerun via `npm run icon`, which then invokes `tauri icon` to produce the full set.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const px = new Float64Array(SIZE * SIZE * 4);

// --- geometry helpers -------------------------------------------------------

function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - r;
}

/** Signed distance → per-pixel coverage with 1px anti-aliasing falloff. */
const coverage = (sd) => Math.min(Math.max(0.5 - sd, 0), 1);
const lerp = (a, b, t) => a + (b - a) * t;

function composite(index, cov, r, g, b) {
  if (cov <= 0) return;
  const i = index * 4;
  px[i] = px[i] * (1 - cov) + r * cov;
  px[i + 1] = px[i + 1] * (1 - cov) + g * cov;
  px[i + 2] = px[i + 2] * (1 - cov) + b * cov;
  px[i + 3] = px[i + 3] * (1 - cov) + 255 * cov;
}

// --- layers -----------------------------------------------------------------

const INDIGO = [79, 70, 229]; // #4F46E5
const VIOLET = [139, 92, 246]; // #8B5CF6
const WHITE = [255, 255, 255];

const BG = { cx: 512, cy: 512, hw: 500, hh: 500, r: 232 };
const HANDLE_OUT = { cx: 512, cy: 430, hw: 148, hh: 106, r: 80 };
const HANDLE_IN = { cx: 512, cy: 430, hw: 104, hh: 62, r: 42 };
const BODY = { cx: 512, cy: 642, hw: 254, hh: 130, r: 38 };
const SEAM = { cx: 512, cy: 606, hw: 254, hh: 5, r: 5 };
const LATCH = { cx: 512, cy: 648, hw: 34, hh: 52, r: 16 };

const sd = ({ cx, cy, hw, hh, r }, x, y) => sdRoundRect(x, y, cx, cy, hw, hh, r);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = y * SIZE + x;
    const t = (x + y) / (2 * (SIZE - 1)); // diagonal gradient
    const gr = lerp(INDIGO[0], VIOLET[0], t);
    const gg = lerp(INDIGO[1], VIOLET[1], t);
    const gb = lerp(INDIGO[2], VIOLET[2], t);

    // background rounded square with gradient
    composite(idx, coverage(sd(BG, x, y)), gr, gg, gb);

    // handle ring: inside outer rounded rect, outside inner one
    const handleSd = Math.max(sd(HANDLE_OUT, x, y), -sd(HANDLE_IN, x, y));
    composite(idx, coverage(handleSd), WHITE[0], WHITE[1], WHITE[2]);

    // body
    const bodySd = sd(BODY, x, y);
    composite(idx, coverage(bodySd), WHITE[0], WHITE[1], WHITE[2]);

    // lid seam (gradient line across the body)
    const seamSd = Math.max(sd(SEAM, x, y), bodySd);
    composite(idx, coverage(seamSd), gr, gg, gb);

    // latch over the seam
    composite(idx, coverage(sd(LATCH, x, y)), gr, gg, gb);
  }
}

// --- PNG encoding -------------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const rowLen = SIZE * 4 + 1; // filter byte + RGBA
const raw = Buffer.alloc(rowLen * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * rowLen] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const o = y * rowLen + 1 + x * 4;
    raw[o] = Math.round(px[i]);
    raw[o + 1] = Math.round(px[i + 1]);
    raw[o + 2] = Math.round(px[i + 2]);
    raw[o + 3] = Math.round(px[i + 3]);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src-tauri",
  "icons"
);
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "app-icon.png");
writeFileSync(outFile, png);
console.log(`wrote ${outFile} (${SIZE}x${SIZE})`);
