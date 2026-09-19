const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function main() {
  const iconPath = path.resolve('../app/src/assets/images/icon.png');
  const { data, info } = await sharp(iconPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  console.log('Original icon dimensions:', width, height);

  // Let's find the circle center and radius.
  // The outer ring has dots and "TECHNO WORLD" text in an arc.
  // Let's inspect the bounding box of the circular logo.
  // The left edge of the circle is at x ~ 3-5.
  // The bottom edge is around y ~ 158.
  // The top edge of the text "TECHNO WORLD" is around y ~ 18.
  
  // Let's measure:
  let points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const a = data[idx + 3];
      // Black/dark pixels
      if (a > 50) {
        // Exclude the top right artifact: it is at x > 140 and y < 50
        if (x > 145 && y < 50) continue;
        if (y < 15 && x > 130) continue;
        points.push({ x, y });
      }
    }
  }

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const radius = Math.max(rx, ry);

  console.log('Detected circle geometry:', { minX, maxX, minY, maxY, cx, cy, rx, ry, radius });
}

main().catch(console.error);
