import { test } from "node:test";
import assert from "node:assert/strict";
import { imageSizeOf } from "../lib/image-size.js";

const bytes = (...parts) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

test("imageSizeOf: PNG and GIF headers", () => {
  const png = bytes([0x89], "PNG\r\n\x1a\n", [0, 0, 0, 13], "IHDR", [0, 0, 0x05, 0x00, 0, 0, 0x02, 0xd0], [8, 6, 0, 0, 0]);
  assert.deepEqual(imageSizeOf(png), { w: 1280, h: 720 });
  assert.deepEqual(imageSizeOf(bytes("GIF89a", [0x40, 0x01, 0xf0, 0x00], [0, 0, 0])), { w: 320, h: 240 });
});

test("imageSizeOf: JPEG's first frame header, after other segments", () => {
  const jpeg = bytes([0xff, 0xd8], [0xff, 0xe0, 0x00, 0x04, 0, 0], [0xff, 0xc4, 0x00, 0x03, 0], [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0]);
  assert.deepEqual(imageSizeOf(jpeg), { w: 640, h: 480 });
});

test("imageSizeOf: WebP's three kinds", () => {
  const riff = (kind, body) => bytes("RIFF", [0, 0, 0, 0], "WEBP", kind, body);
  const vp8 = Array(30).fill(0); vp8[26 - 16] = 0x40; vp8[27 - 16] = 0x01; vp8[28 - 16] = 0xf0; vp8[29 - 16] = 0x00;
  assert.deepEqual(imageSizeOf(riff("VP8 ", vp8)), { w: 320, h: 240 });
  // VP8L: 14 bits each of width-1 and height-1 from byte 21.
  const v = (320 - 1) | ((240 - 1) << 14), vp8l = Array(14).fill(0);
  [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255].forEach((x, i) => { vp8l[21 - 16 + i] = x; });
  assert.deepEqual(imageSizeOf(riff("VP8L", vp8l)), { w: 320, h: 240 });
  const vp8x = Array(14).fill(0); vp8x[24 - 16] = 319 & 255; vp8x[25 - 16] = 319 >> 8; vp8x[27 - 16] = 239;
  assert.deepEqual(imageSizeOf(riff("VP8X", vp8x)), { w: 320, h: 240 });
});

test("imageSizeOf: not an image, or cut short", () => {
  assert.equal(imageSizeOf(bytes("hello world, plain text")), null);
  assert.equal(imageSizeOf(bytes([0x89], "PNG")), null);
  assert.equal(imageSizeOf(null), null);
});
