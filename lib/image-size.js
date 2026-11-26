// An image's pixel size from its first bytes (PNG, GIF, WebP, JPEG), read in the
// mod itself: no python3 or other program, so the same on macOS, Linux and Windows
// (spec 014). Pure: takes the bytes (a Uint8Array), returns { w, h } or null.

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u32le = (b, i) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
const ascii = (b, i, n) => String.fromCharCode(...b.slice(i, i + n));
const size = (w, h) => (w > 0 && h > 0 ? { w, h } : null);

export function imageSizeOf(b) {
  if (!b || b.length < 10) return null;
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b.length >= 24) return size(u32be(b, 16), u32be(b, 20));
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return size(u16le(b, 6), u16le(b, 8));
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const k = ascii(b, 12, 4);
    if (k === "VP8 ") return size(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (k === "VP8L") { const v = u32le(b, 21); return size((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1); }
    if (k === "VP8X") return size(u24le(b, 24) + 1, u24le(b, 27) + 1);
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return size(u16be(b, i + 7), u16be(b, i + 5));
      i += 2 + u16be(b, i + 2);
    }
  }
  return null;
}
