const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const path = require('path');
const fs = require('fs');

async function main() {
  const svgPath = path.resolve(__dirname, '..', 'src', 'assets', 'logo-icon.svg');
  const svg = fs.readFileSync(svgPath, 'utf-8');
  const tmpDir = path.resolve(__dirname, '..', 'build', '.tmp-icons');
  fs.mkdirSync(tmpDir, { recursive: true });

  const sizes = [16, 32, 48, 64, 128, 256];
  const tmpFiles = await Promise.all(
    sizes.map(async (s) => {
      const p = path.join(tmpDir, `${s}.png`);
      await sharp(Buffer.from(svg)).resize(s, s).png().toFile(p);
      return p;
    })
  );

  const ico = await pngToIco.default(tmpFiles);
  fs.writeFileSync(path.resolve(__dirname, '..', 'build', 'icon.ico'), ico);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('icon.ico generated');
}

main().catch(console.error);
