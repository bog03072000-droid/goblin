// One-off (re-run manually if assets/goblin-logo.png changes) generator for
// the app icon: rasterizes the official GoblinAnty logo PNG to every size
// Windows actually uses (taskbar, title bar, Explorer thumbnails, Alt-Tab),
// then bundles those into a single multi-resolution .ico for electron-builder.
// The source image itself is never redrawn or altered — only resized.
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'assets', 'goblin-logo.png');
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const source = fs.readFileSync(sourcePath);
  const pngBuffers = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()));

  // 512x512 fallback PNG — used as the runtime BrowserWindow icon and as a
  // general-purpose app icon outside Windows' .ico requirement.
  await sharp(source).resize(512, 512).png().toFile(path.join(root, 'build', 'icon.png'));

  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);

  console.log(`Generated build/icon.ico (${sizes.join(',')}px) and build/icon.png (512px) from assets/goblin-logo.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
