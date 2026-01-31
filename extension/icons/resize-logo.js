/**
 * Generate PNG icons from SVG logo
 * Run: npm install sharp && node resize-logo.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputPath = 'C:\\Users\\Eddie\\Desktop\\PrivacyRPC\\sdk\\PrivacyRPCLogo.png';
const outputDir = __dirname;

const sizes = [16, 48, 128];

async function generateIcons() {
  console.log('Reading logo from:', inputPath);

  if (!fs.existsSync(inputPath)) {
    console.error('Logo file not found at:', inputPath);
    process.exit(1);
  }

  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon${size}.png`);

    // Resize with high quality settings
    await sharp(inputPath)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: 'lanczos3'
      })
      .png({ quality: 100 })
      .toFile(outputPath);

    console.log(`Created: ${outputPath} (${size}x${size})`);
  }

  console.log('\nDone! Icons created successfully.');
}

generateIcons().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
