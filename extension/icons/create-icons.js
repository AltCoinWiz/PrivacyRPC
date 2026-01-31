/**
 * Simple icon generator for PrivacyRPC extension
 * Run: node create-icons.js
 *
 * This creates simple colored square placeholder icons.
 * For better icons, open generate-icons.html in a browser.
 */

const fs = require('fs');
const path = require('path');

// Simple PNG creation (1x1 pixel scaled)
// This creates minimal valid PNG files as placeholders

// PNG signature
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type);
  const crc = crc32(Buffer.concat([typeBuffer, data]));

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 calculation
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  const table = [];

  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  for (let i = 0; i < buffer.length; i++) {
    crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  }

  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0, 0);
  return result;
}

function createSimplePNG(size) {
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr.writeUInt8(8, 8);        // bit depth
  ihdr.writeUInt8(2, 9);        // color type (RGB)
  ihdr.writeUInt8(0, 10);       // compression
  ihdr.writeUInt8(0, 11);       // filter
  ihdr.writeUInt8(0, 12);       // interlace

  // Create image data (teal/cyan color #00d4aa)
  const rawData = [];
  for (let y = 0; y < size; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < size; x++) {
      // Gradient from teal to purple
      const ratio = (x + y) / (size * 2);
      const r = Math.round(0 + ratio * 123);
      const g = Math.round(212 - ratio * 115);
      const b = Math.round(170 + ratio * 85);
      rawData.push(r, g, b);
    }
  }

  // Compress with zlib
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(Buffer.from(rawData));

  // Build PNG
  const chunks = [
    PNG_SIGNATURE,
    createChunk('IHDR', ihdr),
    createChunk('IDAT', compressed),
    createChunk('IEND', Buffer.alloc(0))
  ];

  return Buffer.concat(chunks);
}

// Create icons
const sizes = [16, 48, 128];
const dir = __dirname;

sizes.forEach(size => {
  const png = createSimplePNG(size);
  const filename = path.join(dir, `icon${size}.png`);
  fs.writeFileSync(filename, png);
  console.log(`Created ${filename}`);
});

console.log('\nIcons created successfully!');
console.log('You can now load the extension in Chrome.');
