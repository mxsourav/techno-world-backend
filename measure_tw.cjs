const sharp = require('sharp');
const path = require('path');

async function main() {
  const logoPath = path.resolve('../app/public/techno_world.png');
  const { data, info } = await sharp(logoPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  console.log('techno_world.png dimensions:', width, height);

  // In techno_world.png, the circular emblem is on the left side.
  // Let's find where the circular emblem ends and the big "TECHNO WORLD" text begins.
  // The 'T' of TECHNO begins around x=150-160.
  let points = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 165; x++) {
      const idx = (y * width + x) * channels;
      const a = data[idx + 3];
      if (a > 50) {
        // Exclude the 'T' of TECHNO which starts at x > 154, y < 65
        if (x > 153 && y < 65) continue;
        points.push({ x, y });
      }
    }
  }

  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));

  console.log('Circle in techno_world.png:', {
    minX, maxX, minY, maxY,
    width: maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2
  });
}

main().catch(console.error);
