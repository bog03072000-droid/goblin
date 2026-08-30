// One-off (re-run manually whenever build/icon.svg changes) generator for
// the app icon: rasterizes the hand-authored SVG to PNG at every size
// Windows actually uses (taskbar, title bar, Explorer thumbnails, Alt-Tab),
// then bundles those into a single multi-resolution .ico for electron-builder.
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build', 'icon.svg');
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const svg = fs.readFileSync(svgPath);
  const pngBuffers = await Promise.all(
    sizes.map((size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()),
  );

  // 512x512 fallback PNG — used as the runtime BrowserWindow icon and as a
  // general-purpose app icon outside Windows' .ico requirement.
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(path.join(root, 'build', 'icon.png'));

  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);

  console.log(`Generated build/icon.ico (${sizes.join(',')}px) and build/icon.png (512px)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
