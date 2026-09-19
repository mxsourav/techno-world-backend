/**
 * generateOgCover.ts
 *
 * Generates a 1200x630 branded Open Graph cover image for Techno World Books.
 * Uses Sharp (already a server dependency) to composite SVG text/shape layers
 * onto a PNG output without any external font or image dependencies.
 *
 * Run:
 *   npx tsx server/scripts/generateOgCover.ts
 *
 * Output:
 *   app/public/og-cover.png  (1200 x 630 px, ~80-120 KB)
 *
 * Commit the output and deploy with your Vite build so it is served at:
 *   https://technoworldbooks.in/og-cover.png
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Output to app/public (served by Hostinger at the storefront root)
const OUTPUT_PATH = path.resolve(__dirname, '../../app/public/og-cover.png');

const WIDTH = 1200;
const HEIGHT = 630;

// Brand colours (emerald palette from Tailwind / theme)
const BG_DARK   = '#0a2e1f';   // Deep forest green
const BG_MID    = '#0f3d28';   // Slightly lighter panel
const ACCENT    = '#10b981';   // Emerald-500
const ACCENT_LT = '#6ee7b7';   // Emerald-300
const WHITE     = '#ffffff';
const CREAM     = '#f0fdf4';   // Emerald-50
const MUTED     = '#86efac';   // Emerald-300 (muted text)

// Tagline lines (break for balance at 1200px)
const TAGLINE_L1 = "India's Trusted Online Bookstore";
const TAGLINE_L2 = 'College Street, Kolkata';

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">

  <!-- Background gradient -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BG_DARK}"/>
      <stop offset="100%" stop-color="${BG_MID}"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_LT}"/>
    </linearGradient>
    <!-- Book-spine decorative shapes -->
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Main background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Decorative vertical accent band (left) -->
  <rect x="0" y="0" width="8" height="${HEIGHT}" fill="url(#accentGrad)"/>

  <!-- Decorative subtle grid overlay (book texture hint) -->
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}"
        fill="none" stroke="${ACCENT}" stroke-opacity="0.04"
        stroke-width="1"
        style="
          background-image: repeating-linear-gradient(0deg, transparent, transparent 59px, rgba(16,185,129,0.04) 59px, rgba(16,185,129,0.04) 60px),
                            repeating-linear-gradient(90deg, transparent, transparent 59px, rgba(16,185,129,0.04) 59px, rgba(16,185,129,0.04) 60px)
        "/>

  <!-- Large decorative open-book icon (abstract) -->
  <!-- Left page -->
  <rect x="820" y="140" width="140" height="210" rx="4"
        fill="${BG_MID}" stroke="${ACCENT}" stroke-width="1.5" stroke-opacity="0.35"/>
  <!-- Right page -->
  <rect x="970" y="140" width="140" height="210" rx="4"
        fill="${BG_MID}" stroke="${ACCENT}" stroke-width="1.5" stroke-opacity="0.35"/>
  <!-- Spine -->
  <rect x="957" y="135" width="16" height="220" rx="2"
        fill="${ACCENT}" opacity="0.25"/>
  <!-- Lines on pages (reading feel) -->
  ${Array.from({ length: 6 }, (_, i) => `
  <line x1="836" y1="${170 + i * 28}" x2="952" y2="${170 + i * 28}"
        stroke="${ACCENT}" stroke-opacity="0.15" stroke-width="1.5"/>
  <line x1="986" y1="${170 + i * 28}" x2="1102" y2="${170 + i * 28}"
        stroke="${ACCENT}" stroke-opacity="0.15" stroke-width="1.5"/>
  `).join('')}

  <!-- Second smaller floating book (stacked behind) -->
  <rect x="870" y="365" width="120" height="170" rx="4"
        fill="${BG_MID}" stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.2"/>
  <rect x="998" y="365" width="120" height="170" rx="4"
        fill="${BG_MID}" stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.2"/>
  <rect x="987" y="360" width="14" height="180" rx="2"
        fill="${ACCENT}" opacity="0.15"/>

  <!-- Glowing circle accent behind books -->
  <circle cx="960" cy="315" r="200" fill="${ACCENT}" opacity="0.04" filter="url(#glow)"/>

  <!-- ─── LEFT CONTENT PANEL ─────────────────────────────────────── -->

  <!-- Domain badge -->
  <rect x="60" y="60" width="310" height="36" rx="18"
        fill="${ACCENT}" fill-opacity="0.12" stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.4"/>
  <text x="215" y="84" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="15" fill="${ACCENT_LT}" letter-spacing="2">
    technoworldbooks.in
  </text>

  <!-- Main brand name — large -->
  <text x="60" y="200"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="72" font-weight="bold" fill="${WHITE}"
        letter-spacing="-1">
    Techno World
  </text>
  <text x="60" y="284"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="72" font-weight="bold" fill="${ACCENT}"
        letter-spacing="-1">
    Books
  </text>

  <!-- Horizontal rule -->
  <line x1="60" y1="314" x2="480" y2="314"
        stroke="url(#accentGrad)" stroke-width="2" stroke-opacity="0.6"/>

  <!-- Tagline -->
  <text x="60" y="358"
        font-family="Arial, Helvetica, sans-serif"
        font-size="24" fill="${CREAM}" opacity="0.85">
    ${TAGLINE_L1}
  </text>
  <text x="60" y="392"
        font-family="Arial, Helvetica, sans-serif"
        font-size="20" fill="${MUTED}" opacity="0.7">
    ${TAGLINE_L2}
  </text>

  <!-- Benefit pills -->
  <!-- Pill 1 -->
  <rect x="60" y="440" width="148" height="32" rx="16"
        fill="${ACCENT}" fill-opacity="0.15" stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.35"/>
  <text x="134" y="461" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="13" fill="${ACCENT_LT}">
    Free delivery &gt;999
  </text>
  <!-- Pill 2 -->
  <rect x="220" y="440" width="110" height="32" rx="16"
        fill="${ACCENT}" fill-opacity="0.15" stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.35"/>
  <text x="275" y="461" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="13" fill="${ACCENT_LT}">
    COD Available
  </text>
  <!-- Pill 3 -->
  <rect x="342" y="440" width="140" height="32" rx="16"
        fill="${ACCENT}" fill-opacity="0.15" stroke="${ACCENT}" stroke-width="1" stroke-opacity="0.35"/>
  <text x="412" y="461" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="13" fill="${ACCENT_LT}">
    27,000+ Pincodes
  </text>

  <!-- Bottom bar -->
  <rect x="0" y="590" width="${WIDTH}" height="40" fill="${ACCENT}" fill-opacity="0.08"/>
  <text x="${WIDTH / 2}" y="616" text-anchor="middle"
        font-family="Arial, Helvetica, sans-serif"
        font-size="14" fill="${MUTED}" opacity="0.6">
    NEET · JEE · UPSC · Engineering · Medical · School · Fiction · Academic
  </text>

  <!-- Bottom-right accent dot cluster -->
  <circle cx="1150" cy="610" r="4" fill="${ACCENT}" opacity="0.3"/>
  <circle cx="1165" cy="610" r="4" fill="${ACCENT}" opacity="0.2"/>
  <circle cx="1180" cy="610" r="4" fill="${ACCENT}" opacity="0.1"/>
</svg>
`;

async function main() {
  console.log('Generating OG cover image (1200x630)...');

  await sharp(Buffer.from(svg))
    .resize(WIDTH, HEIGHT)
    .png({ compressionLevel: 8, quality: 90 })
    .toFile(OUTPUT_PATH);

  const stats = fs.statSync(OUTPUT_PATH);
  const sizeKb = Math.round(stats.size / 1024);
  console.log(`✓  Generated: ${OUTPUT_PATH}`);
  console.log(`   Size: ${sizeKb} KB`);
  console.log(`   Dimensions: ${WIDTH} x ${HEIGHT} px`);
  console.log(`\nDeploy this file to Hostinger and it will be served at:`);
  console.log(`   https://technoworldbooks.in/og-cover.png`);
}

main().catch((err) => {
  console.error('Failed to generate OG cover:', err);
  process.exit(1);
});
