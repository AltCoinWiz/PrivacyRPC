# PrivacyRPC SDK

**Privacy-first RPC protection for crypto wallets.**

> 🏆 Built for the Helius/QuickNode Hackathon - Best Privacy Project

## What It Does

PrivacyRPC protects your crypto transactions without watching you:

- **MITM Protection** - Detects man-in-the-middle attacks on RPC connections
- **Phishing Detection** - Blocks fake wallet sites (100% local, no tracking)
- **IP Privacy** - Optional Tor/VPN routing hides you from RPC providers
- **Upgrade Prompts** - Warns when using insecure public RPCs

## Quick Start

```bash
npm install @privacyrpc/sdk
```

```typescript
import { PrivacyRPC } from '@privacyrpc/sdk';

const privacyRpc = PrivacyRPC.withHelius('your-api-key');
await privacyRpc.start();

// Configure your wallet to use:
console.log(privacyRpc.proxyUrl); // http://127.0.0.1:8899
```

## Privacy Modes

```typescript
// Standard - RPC sees your IP
PrivacyRPC.withHelius('key');

// Tor - IP hidden, max privacy
PrivacyRPC.withHelius('key', { privacy: 'tor' });

// VPN - IP hidden, faster
PrivacyRPC.withHelius('key', { privacy: 'vpn', vpn: VpnPresets.mullvad() });
```

## Features

| Feature | Privacy | Description |
|---------|---------|-------------|
| RPC Proxy | 🟢 Local | Routes wallet traffic through secure RPC |
| MITM Detection | 🟢 Local | Blocks proxy certificates, DNS hijacking |
| Phishing Detection | 🟢 Local | Detects fake sites without external APIs |
| Tor Routing | 🟢 Anonymous | Hides IP from RPC providers |
| VPN Routing | 🟡 Semi-private | Hides IP (VPN sees traffic) |

## Supported Providers

```typescript
// Helius
PrivacyRPC.withHelius('api-key');

// QuickNode
PrivacyRPC.withQuickNode('https://your-endpoint.quiknode.pro/xxx');

// Custom RPC
new PrivacyRPC({ primaryRpc: 'https://your-rpc.com' });
```

## Documentation

- [Architecture](./ARCHITECTURE.md) - How it works under the hood
- [API Reference](./docs/API.md) - Full SDK documentation
- [Examples](./examples/) - Code examples for each platform

## Platforms

| Platform | Package | Status |
|----------|---------|--------|
| TypeScript/Node.js | `@privacyrpc/sdk` | ✅ |
| Android | `com.privacyrpc:sdk` | ✅ |
| iOS | `PrivacyRPCSDK` | ✅ |
| Rust | `privacyrpc-sdk` | ✅ |

## Demo

```bash
cd demo && npm install && npm start
```

## License

MIT
