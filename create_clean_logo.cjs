const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateCleanLogos() {
  // Source image: techno_world_circle.png (169x169) or icon.png
  const srcPath = 'C:/Users/rodd/Desktop/techno-world-admin/src/assets/images/techno_world_circle.png';
  const { data, info } = await sharp(srcPath).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  console.log('Source info:', info);

  // Find center of the circular logo:
  // In 169x169:
  // The outer circle has radius ~74.
  // Center is roughly (84, 85).
  // Let's find the exact center by scanning coordinates of the outer black circle
  let circlePixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const a = data[idx + 3];
      // Dark pixel
      if (a > 100) {
        // Exclude the top right artifact (x > 140, y < 45) and top left line (x < 30, y < 30)
        if (x > 140 && y < 45) continue;
        if (x < 30 && y < 30) continue;
        circlePixels.push({ x, y });
      }
    }
  }

  const minX = Math.min(...circlePixels.map(p => p.x));
  const maxX = Math.max(...circlePixels.map(p => p.x));
  const minY = Math.min(...circlePixels.map(p => p.y));
  const maxY = Math.max(...circlePixels.map(p => p.y));

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.max((maxX - minX) / 2, (maxY - minY) / 2);

  console.log('Emblem circle:', { minX, maxX, minY, maxY, cx, cy, radius });

  // Now create a 512x512 canvas with the logo perfectly centered.
  // We will upscale the source cleanly, apply a circular mask with radius = outer circle radius,
  // wipe out the top right and top left artifacts, and turn all dark pixels into pure white!
  
  // Let's create a raw buffer for 512x512
  const targetSize = 512;
  const scale = (targetSize * 0.90) / (radius * 2);
  const targetCx = targetSize / 2;
  const targetCy = targetSize / 2;
  const targetRadius = (targetSize * 0.90) / 2;

  // 1. Transparent White Logo Buffer
  const whiteData = Buffer.alloc(targetSize * targetSize * 4);

  // 2. Emerald Badge Logo Buffer (like WhatsApp's green circular app icon)
  const badgeData = Buffer.alloc(targetSize * targetSize * 4);

  // Bilinear/nearest sampling with circular mask
  for (let ty = 0; ty < targetSize; ty++) {
    for (let tx = 0; tx < targetSize; tx++) {
      const targetIdx = (ty * targetSize + tx) * 4;
      const dx = tx - targetCx;
      const dy = ty - targetCy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Outside the target radius: fully transparent
      if (dist > targetRadius + 2) {
        // Transparent for whiteData
        whiteData[targetIdx] = 0;
        whiteData[targetIdx + 1] = 0;
        whiteData[targetIdx + 2] = 0;
        whiteData[targetIdx + 3] = 0;

        // Transparent for badgeData
        badgeData[targetIdx] = 0;
        badgeData[targetIdx + 1] = 0;
        badgeData[targetIdx + 2] = 0;
        badgeData[targetIdx + 3] = 0;
        continue;
      }

      // Map back to source coordinates
      const sx = cx + dx / scale;
      const sy = cy + dy / scale;

      let srcAlpha = 0;
      if (sx >= 0 && sx < width - 1 && sy >= 0 && sy < height - 1) {
        const x0 = Math.floor(sx);
        const x1 = x0 + 1;
        const y0 = Math.floor(sy);
        const y1 = y0 + 1;
        const fx = sx - x0;
        const fy = sy - y0;

        const i00 = (y0 * width + x0) * channels;
        const i10 = (y0 * width + x1) * channels;
        const i01 = (y1 * width + x0) * channels;
        const i11 = (y1 * width + x1) * channels;

        // Check if sx, sy is in the artifact zone (top right mark)
        const srcDx = sx - cx;
        const srcDy = sy - cy;
        const srcDist = Math.sqrt(srcDx * srcDx + srcDy * srcDy);

        // Circular boundary cutoff to cleanly eliminate top right / left marks
        if (srcDist <= radius + 0.5) {
          const a00 = data[i00 + 3];
          const a10 = data[i10 + 3];
          const a01 = data[i01 + 3];
          const a11 = data[i11 + 3];

          srcAlpha = Math.round(
            (1 - fx) * (1 - fy) * a00 +
            fx * (1 - fy) * a10 +
            (1 - fx) * fy * a01 +
            fx * fy * a11
          );
        }
      }

      // Anti-aliased outer edge mask
      let edgeFactor = 1.0;
      if (dist > targetRadius - 1) {
        edgeFactor = Math.max(0, Math.min(1, targetRadius + 1 - dist));
      }

      const finalAlpha = Math.round(srcAlpha * edgeFactor);

      // --- White Logo on Transparent ---
      whiteData[targetIdx] = 255;     // R = 255
      whiteData[targetIdx + 1] = 255; // G = 255
      whiteData[targetIdx + 2] = 255; // B = 255
      whiteData[targetIdx + 3] = finalAlpha; // A

      // --- Emerald Circular Badge with White Logo (for Favicon / PWA / Sidebar) ---
      // Brand Emerald background: #0a2e1f -> R: 10, G: 46, B: 31
      // Badge edge anti-aliasing
      let badgeEdge = 1.0;
      if (dist > targetRadius - 1.5) {
        badgeEdge = Math.max(0, Math.min(1, targetRadius + 1 - dist));
      }
      const bgAlpha = badgeEdge;
      const fgAlpha = finalAlpha / 255.0;

      // Alpha composite white logo on emerald background
      const rBg = 10, gBg = 46, bBg = 31;
      const rFg = 255, gFg = 255, bFg = 255;

      const outR = Math.round(rFg * fgAlpha + rBg * (1 - fgAlpha));
      const outG = Math.round(gFg * fgAlpha + gBg * (1 - fgAlpha));
      const outB = Math.round(bFg * fgAlpha + bBg * (1 - fgAlpha));
      const outA = Math.round(255 * bgAlpha);

      badgeData[targetIdx] = outR;
      badgeData[targetIdx + 1] = outG;
      badgeData[targetIdx + 2] = outB;
      badgeData[targetIdx + 3] = outA;
    }
  }

  // Generate output files
  const whiteImg = sharp(whiteData, { raw: { width: targetSize, height: targetSize, channels: 4 } });
  const badgeImg = sharp(badgeData, { raw: { width: targetSize, height: targetSize, channels: 4 } });

  // 1. Transparent White Circular Logo
  await whiteImg.clone().png().toFile('../app/public/techno_world_circle_white.png');
  await whiteImg.clone().resize(169, 169).png().toFile('../app/src/assets/images/icon.png');
  await whiteImg.clone().resize(169, 169).png().toFile('../app/public/icon.png');
  console.log('Generated techno_world_circle_white.png and icon.png');

  // 2. High-res Emerald Circular Badge (For Favicon, Edge Sidebar, Apple Touch Icon, Android)
  await badgeImg.clone().png().toFile('../app/public/apple-touch-icon.png');
  await badgeImg.clone().resize(192, 192).png().toFile('../app/public/android-chrome-192x192.png');
  await badgeImg.clone().resize(512, 512).png().toFile('../app/public/android-chrome-512x512.png');
  await badgeImg.clone().resize(64, 64).png().toFile('../app/public/favicon-32x32.png');
  await badgeImg.clone().resize(32, 32).png().toFile('../app/public/favicon.ico');
  await badgeImg.clone().resize(64, 64).png().toFile('../app/public/favicon.png');
  console.log('Generated favicons and webapp badges');

  // 3. Web App Manifest for Edge Sidebar / PWA installation
  const manifest = {
    name: "Techno World Books",
    short_name: "Techno World",
    description: "India's trusted online bookstore from College Street, Kolkata",
    start_url: "/",
    display: "standalone",
    background_color: "#0a2e1f",
    theme_color: "#0a2e1f",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable"
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "512x512",
        type: "image/png"
      }
    ]
  };

  fs.writeFileSync('../app/public/site.webmanifest', JSON.stringify(manifest, null, 2));
  console.log('Generated site.webmanifest');
}

generateCleanLogos().catch(console.error);
