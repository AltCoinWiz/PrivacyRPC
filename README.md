<p align="center">
  <img src="desktop-app/src/icon.png" alt="PrivacyRPC" width="100" height="100" />
</p>

<h1 align="center">PrivacyRPC</h1>

<p align="center">
  PrivacyRPC is privacy infrastructure for Solana — build tools that make your RPC private and safe with our proxy, SDKs, and developer tools.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-5AF5F5?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-333?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3" />
  <img src="https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri-orange?style=flat-square&logo=rust&logoColor=white" alt="Rust + Tauri" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Solana-RPC%20Privacy-9945FF?style=flat-square&logo=solana&logoColor=white" alt="Solana" />
  <img src="https://img.shields.io/badge/Tor-Embedded-7D4698?style=flat-square&logo=torproject&logoColor=white" alt="Tor" />
  <img src="https://img.shields.io/badge/SDKs-TypeScript%20%7C%20Rust%20%7C%20Kotlin%20%7C%20Swift-blue?style=flat-square" alt="SDKs" />
</p>

---

## What is PrivacyRPC?

Every Solana RPC call your wallet makes exposes your **IP address**, **transaction patterns**, and **on-chain behavior** to RPC providers and network observers. Phishing sites and wallet drainers probe your balances via RPC **before you even connect your wallet**.

PrivacyRPC is a privacy infrastructure toolkit with two parts:

1. **Desktop App + Chrome Extension** — End-user protection that works silently in the background
2. **Multi-Platform SDKs** — Developer tools so any app, wallet, or dApp can add privacy-preserving RPC routing with a few lines of code

```
  Your App / Wallet               PrivacyRPC                     RPC Providers
 ┌──────────────┐                ┌────────────┐    Forward      ┌─────────────┐
 │  Browser     │   PAC Script   │ Local Proxy│ ─────────────>  │ Helius      │
 │  Node.js     │ ─────────────> │  :8899     │                 │ Alchemy     │
 │  Mobile App  │   SDK / API    └─────┬──────┘                 │ QuickNode   │
 │  Rust CLI    │                      │ (optional)             └─────────────┘
 └──────────────┘                      ▼
                                  Tor Network
                                  (anonymous)
```

---

## Developer SDKs

Build privacy into your Solana application with drop-in SDKs. Embedded Tor, phishing detection, MITM protection — no infrastructure to manage.

### Quick Install

```bash
# TypeScript / Node.js
npm install @privacyrpc/sdk

# Rust
cargo add privacyrpc-sdk

# Kotlin (build.gradle.kts)
implementation("com.privacyrpc:privacyrpc-sdk:1.0.0")

# Swift (Package.swift)
.package(url: "https://github.com/nickshouse/PrivacyRPC", from: "1.0.0")
```

### TypeScript — Get Started in 3 Lines

```typescript
import { PrivacyRPC } from '@privacyrpc/sdk';

const proxy = PrivacyRPC.withHelius('your-api-key', { privacy: 'tor' });
await proxy.start();
// All RPC traffic now routes through Tor — your users' IPs are hidden
```

### Rust

```rust
use privacyrpc_sdk::{PrivacyRPC, Config};

let config = Config::builder()
    .use_helius("your-api-key")
    .proxy_port(8899)
    .build();

let proxy = PrivacyRPC::new(config);
proxy.start().await?;
// proxy.proxy_url() → "http://127.0.0.1:8899"
```

### Provider Factory Methods

```typescript
// One-liner setup for major RPC providers
const proxy = PrivacyRPC.withHelius(apiKey, options);
const proxy = PrivacyRPC.withQuickNode(endpoint, options);
const proxy = PrivacyRPC.withAlchemy(apiKey, chain, options);
```

---

## SDK Modules

The SDK is modular — use only what you need:

| Module | Import | What It Does |
|--------|--------|-------------|
| **Core** | `@privacyrpc/sdk` | RPC proxy with provider presets, request/response interceptors, alert handlers |
| **Tor** | `@privacyrpc/sdk/tor` | Embedded Tor binary management, circuit control, exit IP rotation |
| **Phishing** | `@privacyrpc/sdk/phishing` | 100% local domain analysis — homograph attacks, typosquatting, lookalike detection |
| **MITM** | `@privacyrpc/sdk/mitm` | Certificate pinning, DNS hijacking detection, SSL stripping alerts |
| **Forward Proxy** | `@privacyrpc/sdk/forward-proxy` | HTTP/HTTPS forward proxy for PAC script integration, SOCKS5 upstream |

### Embedded Tor

No system Tor installation needed. The SDK downloads and manages Tor binaries automatically.

```typescript
import { TorManager } from '@privacyrpc/sdk/tor';

const tor = new TorManager({ dataDir: './tor-data' });
await tor.start();

// Request a new exit IP (new Tor circuit)
await tor.newCircuit();

// Check your current exit IP
const ip = await tor.getExitIp();
console.log(`Exiting from: ${ip}`);
```

### Phishing Detection

Local-only detection with no external API calls. Catches homograph attacks, typosquatting, and domain spoofing.

```typescript
import { PhishingDetector } from '@privacyrpc/sdk/phishing';

const detector = new PhishingDetector();
const result = detector.check('phantòm.app'); // homograph 'ò'
// { isPhishing: true, reason: 'homograph_attack', similarity: 0.95 }
```

### Request Interceptors & Alerts

```typescript
const proxy = PrivacyRPC.withHelius('key', {
  onRequest: (req) => {
    console.log(`RPC method: ${req.method}`);
    return req; // modify or pass through
  },
  onAlert: (alert) => {
    // AlertType.MITM_DETECTED, PHISHING_DETECTED,
    // DNS_HIJACKING, SSL_STRIPPING, PUBLIC_RPC_DETECTED,
    // RPC_FAILOVER, TOR_CONNECTED, TOR_NEW_CIRCUIT, etc.
    console.log(`[${alert.severity}] ${alert.message}`);
  }
});
```

---

## Desktop App + Extension

For end users who want privacy without writing code.

### Features

<table>
<tr>
<td width="50%">

**RPC Proxy Routing** — Routes all Solana RPC traffic through a local proxy, breaking the direct link between your IP and on-chain activity. Supports **20+ RPC providers**.

</td>
<td width="50%">

**One-Click Tor** — Route all RPC traffic through the **Tor network** with a single toggle. No IP, no fingerprinting, no correlation.

</td>
</tr>
<tr>
<td width="50%">

**Drainer & Phishing Detection** — Real-time monitoring flags suspicious RPC patterns: sites making **50+ rapid calls** to scan token balances, fake minting sites, airdrop scams, and drainer kits.

</td>
<td width="50%">

**Extension Security Scanner** — Scans all installed Chrome extensions, identifies wallets, flags extensions with dangerous `<all_urls>` permissions.

</td>
</tr>
<tr>
<td width="50%">

**Per-Tab RPC Monitoring** — See exactly what every dApp does behind the scenes: which RPC methods, how often, to which endpoints, and whether the behavior is suspicious.

</td>
<td width="50%">

**Smart Routing** — Only Solana RPC traffic goes through the proxy via PAC scripts. All other browsing stays direct — zero performance impact.

</td>
</tr>
</table>

### Install

| Platform | Download |
|----------|----------|
| Windows | `PrivacyRPC_1.0.0_x64-setup.exe` |
| macOS | `PrivacyRPC_1.0.0_x64.dmg` |
| Linux | `.deb` / `.AppImage` |

Download from [Releases](../../releases), then load the `/extension` folder in Chrome via `chrome://extensions` (Developer Mode).

---

## HTTP Proxy API

The local proxy server exposes a simple HTTP API that any application can use directly:

```
POST http://127.0.0.1:8899/
Content-Type: application/json
X-Target-URL: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["wallet..."]}
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | `POST` | Forward JSON-RPC request to the target URL specified in `X-Target-URL` header |
| `/health` | `GET` | Returns `{"status":"ok","proxy":"running"}` |
| `/status` | `GET` | Returns `{"running":true,"version":"1.0.0"}` |

The proxy binds to `127.0.0.1` only — never exposed to the network. CORS headers included for browser-based usage.

---

## Supported RPC Providers

<details>
<summary><strong>20+ providers auto-detected</strong></summary>

| Provider | Domains |
|----------|---------|
| **Solana** | `api.mainnet-beta.solana.com`, devnet, testnet |
| **Helius** | `*.helius-rpc.com`, `*.helius.xyz` |
| **Alchemy** | `*.alchemy.com` |
| **QuickNode** | `*.quiknode.pro` |
| **GenesysGo** | `*.genesysgo.net` |
| **Triton** | `*.rpcpool.com`, `*.triton.one` |
| **Ankr** | `rpc.ankr.com` |
| **GetBlock** | `sol.getblock.io` |
| **Syndica** | `*.syndica.io` |
| **Extrnode** | `*.extrnode.com` |
| **Blockdaemon** | `*.blockdaemon.com` |
| **Chainstack** | `*.chainstack.com` |

Plus automatic pattern matching for any domain containing `solana`, `helius`, `alchemy`, `quicknode`, `rpc`, `mainnet`, `devnet`, or `testnet`.

</details>

---

## Architecture

```
PrivacyRPC/
├── sdk/
│   ├── typescript/          # @privacyrpc/sdk — Node.js, browser, React Native
│   ├── rust/                # privacyrpc-sdk crate
│   ├── kotlin/              # Android SDK
│   └── swift/               # iOS SDK (Swift Package Manager)
├── desktop-app/
│   └── src-tauri/src/
│       ├── main.rs          # App state, system tray, window management
│       ├── proxy.rs         # Async HTTP proxy server (Tokio)
│       ├── native_messaging.rs  # Chrome native host registration
│       └── native_host.rs   # stdin/stdout IPC protocol
├── extension/
│   ├── manifest.json        # Chrome Manifest V3
│   ├── background.js        # Service worker: PAC scripts, RPC monitoring
│   ├── popup.html / popup.js
│   ├── sidepanel.html
│   └── content/
│       ├── contentScript.js # In-page overlay notifications
│       └── overlayStyles.css
└── README.md
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| SDKs | **TypeScript**, **Rust**, **Kotlin**, **Swift** |
| Desktop Runtime | **Rust** + **Tauri 2.0** |
| Proxy Server | **Tokio** async TCP + **Reqwest** |
| Tor Integration | Embedded Tor binary (auto-downloaded) |
| Browser Extension | **Chrome Manifest V3** + Vanilla JS |
| Communication | Chrome Native Messaging (stdio) |
| Traffic Routing | PAC Script (Proxy Auto-Config) |
| Installers | NSIS (Windows), DMG (macOS), AppImage (Linux) |

---

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+ (for TypeScript SDK)
- [Tauri CLI](https://tauri.app/) — `cargo install tauri-cli`

### Desktop App

```bash
cd desktop-app/src-tauri
cargo tauri build
```

### TypeScript SDK

```bash
cd sdk/typescript
npm install
npm run build
```

### Rust SDK

```bash
cd sdk/rust
cargo build --release
```

### Extension

No build step. Load `/extension` directly in Chrome Developer Mode.

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Proxy Port | `8899` | Local proxy port (1024-65535) |
| Tor Routing | Off | Route RPC through Tor for IP anonymity |
| Custom RPC | None | Private RPC endpoint for maximum privacy |
| OS Notifications | On | Native system alerts |
| In-Page Overlays | On | Security warnings injected into web pages |

---

## Security

| | |
|---|---|
| **Localhost Only** | Proxy binds to `127.0.0.1` — never exposed to the network |
| **No Data Collection** | Everything runs locally. No telemetry, no analytics, no servers |
| **Embedded Tor** | No system Tor installation needed — SDK manages binaries automatically |
| **Phishing Detection** | 100% local analysis — no external API calls, no data leaves your machine |
| **Extension Validation** | Native messaging host only accepts verified extension IDs |
| **Drainer Protection** | Real-time alerts for suspicious RPC patterns before you interact |
| **Single Instance** | Prevents duplicate processes and port conflicts |

---

## Report Scam URLs & Drainer Methods

Help protect the Solana community by reporting phishing sites, wallet drainers, and scam URLs. All reports are pinned to IPFS for permanent, decentralized archival and feed directly into PrivacyRPC's threat detection engine.

### How to Report

| Method | Link |
|--------|------|
| **Website** | [Report a Scam URL](https://privacyrpc.com/report) — submit via web form with community voting |
| **GitHub Issue** | [Open an issue](../../issues/new) — for detailed reports and drainer method documentation |
| **Scam List** | [View all reports & known drainer methods](SCAM_REPORTS.md) |

### What to Report

| Type | Examples |
|------|----------|
| **Phishing Sites** | Fake wallet sites, cloned dApp frontends, fake token claim pages |
| **Wallet Drainers** | Sites that prompt malicious transaction approvals to drain funds |
| **Fake Mints / Airdrops** | Scam NFT mints, fake token airdrops requiring wallet connection |
| **Malicious Extensions** | Chrome extensions stealing keys, injecting transactions, or scraping data |
| **Bookmark Scams** | Malicious bookmarklets that execute code when clicked |
| **Fake Recovery Sites** | Sites posing as wallet recovery tools to steal seed phrases |

### Reporting a Scam URL

When reporting, include:

- **URL** — the full scam URL
- **Category** — type of scam (phishing, drainer, fake mint, etc.)
- **Description** — how the scam works, what it targets
- **Evidence** — screenshots, transaction hashes, or wallet addresses involved

### Documenting Drainer Methods

If you've identified a new drainer technique, open an issue with:

- **Method name** — descriptive name for the technique
- **How it works** — step-by-step breakdown of the attack flow
- **Detection signals** — RPC patterns, DOM indicators, or behavioral signs
- **Affected wallets** — which wallets or dApps are targeted
- **Mitigation** — how users can protect themselves

### Community Voting

Reports submitted on the website can be confirmed by other community members. URLs with more confirmations are prioritized in the threat database and rise to the top of the public scam list.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

## Donate

Support the development of PrivacyRPC. All donations go toward infrastructure, threat research, and keeping the tools free and open source.

**Solana:** `ADm9PybsZq472vJRu3YPaJXYNcuEszRTEebZqK2eoLX5`

## License

[MIT](LICENSE)
