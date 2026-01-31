#!/usr/bin/env node
/**
 * Download and bundle Tor Expert Bundle for all platforms
 *
 * This script downloads pre-compiled Tor binaries from the official
 * Tor Project and bundles them with the SDK.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Tor Expert Bundle - direct download URLs
// These are official Tor Project releases
const TOR_VERSION = '15.0.4';

const PLATFORMS = {
  'win32-x64': {
    url: `https://dist.torproject.org/torbrowser/${TOR_VERSION}/tor-expert-bundle-windows-x86_64-${TOR_VERSION}.tar.gz`,
    binary: 'tor/tor.exe',
    extractDir: null,
  },
  'darwin-x64': {
    url: `https://dist.torproject.org/torbrowser/${TOR_VERSION}/tor-expert-bundle-macos-x86_64-${TOR_VERSION}.tar.gz`,
    binary: 'tor/tor',
    extractDir: null,
  },
  'darwin-arm64': {
    url: `https://dist.torproject.org/torbrowser/${TOR_VERSION}/tor-expert-bundle-macos-aarch64-${TOR_VERSION}.tar.gz`,
    binary: 'tor/tor',
    extractDir: null,
  },
  'linux-x64': {
    url: `https://dist.torproject.org/torbrowser/${TOR_VERSION}/tor-expert-bundle-linux-x86_64-${TOR_VERSION}.tar.gz`,
    binary: 'tor/tor',
    extractDir: null,
  },
  'linux-arm64': {
    url: `https://dist.torproject.org/torbrowser/${TOR_VERSION}/tor-expert-bundle-linux-aarch64-${TOR_VERSION}.tar.gz`,
    binary: 'tor/tor',
    extractDir: null,
  },
};

const BIN_DIR = path.join(__dirname, '..', 'bin');

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading: ${url}`);

    const file = fs.createWriteStream(dest);

    const request = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          const percent = ((downloaded / total) * 100).toFixed(1);
          process.stdout.write(`\r  Progress: ${percent}%`);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\n  Done!');
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    };

    request(url);
  });
}

async function extractTarGz(archive, destDir) {
  console.log(`Extracting to: ${destDir}`);
  fs.mkdirSync(destDir, { recursive: true });

  try {
    // Try using tar command (works on Windows with Git Bash, macOS, Linux)
    execSync(`tar -xzf "${archive}" -C "${destDir}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to extract with tar, trying alternative method...');
    // Fallback: use zlib and tar-stream if available
    throw new Error('Please install tar or run this script in Git Bash on Windows');
  }
}

async function downloadPlatform(platform) {
  const config = PLATFORMS[platform];
  if (!config) {
    console.log(`Skipping unknown platform: ${platform}`);
    return;
  }

  const platformDir = path.join(BIN_DIR, platform);
  const archivePath = path.join(BIN_DIR, `tor-${platform}.tar.gz`);

  // Check if already downloaded
  const binaryPath = path.join(platformDir, config.binary);
  if (fs.existsSync(binaryPath)) {
    console.log(`[${platform}] Already exists, skipping`);
    return;
  }

  console.log(`\n[${platform}] Downloading Tor Expert Bundle...`);

  try {
    // Download archive
    await downloadFile(config.url, archivePath);

    // Extract
    await extractTarGz(archivePath, platformDir);

    // Move binary to correct location
    const extractedDir = path.join(platformDir, config.extractDir);
    if (fs.existsSync(extractedDir)) {
      const files = fs.readdirSync(extractedDir);
      for (const file of files) {
        const src = path.join(extractedDir, file);
        const dest = path.join(platformDir, file);
        fs.renameSync(src, dest);
      }
      fs.rmdirSync(extractedDir, { recursive: true });
    }

    // Make binary executable on Unix
    if (platform !== 'win32-x64') {
      fs.chmodSync(binaryPath, 0o755);
    }

    // Clean up archive
    fs.unlinkSync(archivePath);

    console.log(`[${platform}] Success!`);
  } catch (err) {
    console.error(`[${platform}] Failed: ${err.message}`);
  }
}

async function main() {
  console.log('PrivacyRPC Tor Bundler');
  console.log('=====================');
  console.log(`Tor Version: ${TOR_VERSION}`);
  console.log(`Output: ${BIN_DIR}\n`);

  // Create bin directory
  fs.mkdirSync(BIN_DIR, { recursive: true });

  // Get platforms to download
  const platforms = process.argv.slice(2);

  if (platforms.length === 0) {
    // Download all platforms
    console.log('Downloading for all platforms...');
    for (const platform of Object.keys(PLATFORMS)) {
      await downloadPlatform(platform);
    }
  } else if (platforms[0] === '--current') {
    // Download for current platform only
    const current = `${process.platform}-${process.arch}`;
    console.log(`Downloading for current platform: ${current}`);
    await downloadPlatform(current);
  } else {
    // Download specified platforms
    for (const platform of platforms) {
      await downloadPlatform(platform);
    }
  }

  console.log('\nDone! Tor binaries are in:', BIN_DIR);
}

main().catch(console.error);
