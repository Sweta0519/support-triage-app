// Renders the homepage's social-share card (SUP-52): 1200x630, the demo
// video's title card (logo, name, one line on deep indigo), as
// public/marketing/og.png. Re-run after changing the wording.
//
//   node scripts/render-og-image.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const W = 1200;
const H = 630;
const logo = readFileSync(join(process.cwd(), "app", "icon.svg")).toString("base64");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="22%" cy="0%" r="110%">
      <stop offset="0%" stop-color="#2A2170"/>
      <stop offset="45%" stop-color="#14112F"/>
      <stop offset="100%" stop-color="#0B0A1A"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <image href="data:image/svg+xml;base64,${logo}" x="96" y="96" width="88" height="88"/>
  <text x="96" y="318" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="68" font-weight="700" fill="#FFFFFF" letter-spacing="-1.5">Every new ticket, read and sorted</text>
  <text x="96" y="398" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="68" font-weight="700" fill="#FFFFFF" letter-spacing="-1.5">before anyone opens it.</text>
  <text x="96" y="520" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="32" fill="#C4C0E8">Support Triage: an AI help desk where people decide.</text>
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(process.cwd(), "public", "marketing", "og.png"));
console.log("public/marketing/og.png");
