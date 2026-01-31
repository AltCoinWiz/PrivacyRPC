const sharp = require('sharp');
const bmp = require('bmp-js');
const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '../../sdk/PrivacyRPCLogo.png');
const outputDir = __dirname;

async function pngToBmp24(pngBuffer, outputPath) {
  // Get raw pixel data from PNG as RGB (no alpha)
  const { data, info } = await sharp(pngBuffer)
    .flatten({ background: { r: 10, g: 10, b: 10 } }) // Flatten alpha with dark bg
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  // BMP row padding - rows must be multiple of 4 bytes
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const padding = rowSize - (width * 3);

  // BMP file structure
  const fileHeaderSize = 14;
  const dibHeaderSize = 40; // BITMAPINFOHEADER
  const pixelDataSize = rowSize * height;
  const fileSize = fileHeaderSize + dibHeaderSize + pixelDataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // File header (14 bytes)
  buffer.write('BM', offset); offset += 2;           // Signature
  buffer.writeUInt32LE(fileSize, offset); offset += 4;  // File size
  buffer.writeUInt16LE(0, offset); offset += 2;      // Reserved
  buffer.writeUInt16LE(0, offset); offset += 2;      // Reserved
  buffer.writeUInt32LE(fileHeaderSize + dibHeaderSize, offset); offset += 4; // Pixel data offset

  // DIB header (BITMAPINFOHEADER - 40 bytes)
  buffer.writeUInt32LE(dibHeaderSize, offset); offset += 4;  // Header size
  buffer.writeInt32LE(width, offset); offset += 4;   // Width
  buffer.writeInt32LE(height, offset); offset += 4;  // Height (positive = bottom-up)
  buffer.writeUInt16LE(1, offset); offset += 2;      // Color planes
  buffer.writeUInt16LE(24, offset); offset += 2;     // Bits per pixel
  buffer.writeUInt32LE(0, offset); offset += 4;      // Compression (0 = none)
  buffer.writeUInt32LE(pixelDataSize, offset); offset += 4; // Image size
  buffer.writeInt32LE(2835, offset); offset += 4;    // X pixels per meter
  buffer.writeInt32LE(2835, offset); offset += 4;    // Y pixels per meter
  buffer.writeUInt32LE(0, offset); offset += 4;      // Colors in color table
  buffer.writeUInt32LE(0, offset); offset += 4;      // Important colors

  // Pixel data (bottom-up, BGR format)
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      buffer[offset++] = data[srcIdx + 2]; // B
      buffer[offset++] = data[srcIdx + 1]; // G
      buffer[offset++] = data[srcIdx];     // R
    }
    // Add row padding
    for (let p = 0; p < padding; p++) {
      buffer[offset++] = 0;
    }
  }

  fs.writeFileSync(outputPath, buffer);
}

async function createImages() {
  // Dark background color matching the app theme
  const darkBg = { r: 10, g: 10, b: 10, alpha: 1 }; // #0a0a0a

  // Create sidebar image (164x314) - logo centered with dark bg
  console.log('Creating sidebar image...');
  const sidebarWidth = 164;
  const sidebarHeight = 314;
  const logoSizeSidebar = 130;

  // Create dark background
  const sidebarBg = await sharp({
    create: {
      width: sidebarWidth,
      height: sidebarHeight,
      channels: 4,
      background: darkBg
    }
  }).png().toBuffer();

  // Resize logo
  const logoForSidebar = await sharp(logoPath)
    .resize(logoSizeSidebar, logoSizeSidebar, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Composite logo onto dark background
  const sidebarPng = await sharp(sidebarBg)
    .composite([{
      input: logoForSidebar,
      top: 60,
      left: Math.floor((sidebarWidth - logoSizeSidebar) / 2)
    }])
    .png()
    .toBuffer();

  // Save as PNG (for preview)
  fs.writeFileSync(path.join(outputDir, 'installer-sidebar.png'), sidebarPng);

  // Convert to BMP
  await pngToBmp24(sidebarPng, path.join(outputDir, 'installer-sidebar.bmp'));
  console.log('Sidebar image created: installer-sidebar.bmp');

  // Create header image (150x57) - logo on left with dark bg
  console.log('Creating header image...');
  const headerWidth = 150;
  const headerHeight = 57;
  const logoSizeHeader = 50;

  // Create dark background
  const headerBg = await sharp({
    create: {
      width: headerWidth,
      height: headerHeight,
      channels: 4,
      background: darkBg
    }
  }).png().toBuffer();

  // Resize logo for header
  const logoForHeader = await sharp(logoPath)
    .resize(logoSizeHeader, logoSizeHeader, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Composite logo onto dark background
  const headerPng = await sharp(headerBg)
    .composite([{
      input: logoForHeader,
      top: Math.floor((headerHeight - logoSizeHeader) / 2),
      left: 5
    }])
    .png()
    .toBuffer();

  // Save as PNG (for preview)
  fs.writeFileSync(path.join(outputDir, 'installer-header.png'), headerPng);

  // Convert to BMP
  await pngToBmp24(headerPng, path.join(outputDir, 'installer-header.bmp'));
  console.log('Header image created: installer-header.bmp');

  // Create WiX banner image (493x58) - logo on left with dark bg
  console.log('Creating WiX banner image...');
  const bannerWidth = 493;
  const bannerHeight = 58;
  const logoSizeBanner = 48;

  const bannerBg = await sharp({
    create: {
      width: bannerWidth,
      height: bannerHeight,
      channels: 4,
      background: darkBg
    }
  }).png().toBuffer();

  const logoForBanner = await sharp(logoPath)
    .resize(logoSizeBanner, logoSizeBanner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const bannerPng = await sharp(bannerBg)
    .composite([{
      input: logoForBanner,
      top: Math.floor((bannerHeight - logoSizeBanner) / 2),
      left: 8
    }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(outputDir, 'wix-banner.png'), bannerPng);
  await pngToBmp24(bannerPng, path.join(outputDir, 'wix-banner.bmp'));
  console.log('WiX banner image created: wix-banner.bmp');

  // Create WiX dialog image (493x312) - small logo in bottom-left, rest is dark bg for text readability
  console.log('Creating WiX dialog image...');
  const dialogWidth = 493;
  const dialogHeight = 312;
  const logoSizeDialog = 80;

  const dialogBg = await sharp({
    create: {
      width: dialogWidth,
      height: dialogHeight,
      channels: 4,
      background: darkBg
    }
  }).png().toBuffer();

  const logoForDialog = await sharp(logoPath)
    .resize(logoSizeDialog, logoSizeDialog, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const dialogPng = await sharp(dialogBg)
    .composite([{
      input: logoForDialog,
      top: dialogHeight - logoSizeDialog - 20,
      left: 20
    }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(outputDir, 'wix-dialog.png'), dialogPng);
  await pngToBmp24(dialogPng, path.join(outputDir, 'wix-dialog.bmp'));
  console.log('WiX dialog image created: wix-dialog.bmp');

  console.log('Done!');
}

createImages().catch(console.error);
