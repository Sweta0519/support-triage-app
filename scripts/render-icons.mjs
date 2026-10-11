// Regenerates the raster icons from the one source of the logo artwork,
// app/icon.svg: app/apple-icon.png (180px, full-bleed and opaque -- iOS
// rounds the corners itself and fills transparency with black) and
// app/favicon.ico (16/32/48px, for browsers without SVG favicons).
//
//   node scripts/render-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("app/icon.svg", "utf8");

// Square corners for iOS: the tile's own rx is dropped.
const square = Buffer.from(svg.replace(/<rect width="32" height="32" rx="8"/, '<rect width="32" height="32"'));
await sharp(square, { density: 1200 }).resize(180, 180).flatten({ background: "#6366f1" }).png().toFile("app/apple-icon.png");

// An ICO with PNG-encoded entries (supported by every current browser).
const sizes = [16, 32, 48];
const pngs = await Promise.all(
  sizes.map((s) => sharp(Buffer.from(svg), { density: 600 }).resize(s, s).png().toBuffer())
);
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = pngs.map((png, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(sizes[i], 0);
  entry.writeUInt8(sizes[i], 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += png.length;
  return entry;
});
writeFileSync("app/favicon.ico", Buffer.concat([header, ...entries, ...pngs]));
console.log("Wrote app/apple-icon.png and app/favicon.ico from app/icon.svg");
