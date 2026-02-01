# PrivacyRPC Test Harness

Test drainer detection features safely in Docker isolation.

## Quick Start (Docker - RECOMMENDED)

```bash
cd test-site
docker-compose up --build
```

Then open: http://localhost:3333

## Manual Start (Local - BE CAREFUL)

```bash
cd test-site
npm install
npm start
```

## Test Pages

| Page | What It Tests |
|------|---------------|
| `/drainer-patterns/rapid-enumeration.html` | 10+ RPC calls in 2 seconds (asset scanning) |
| `/drainer-patterns/immediate-check.html` | Balance check within 100ms of page load |
| `/drainer-patterns/quick-transaction.html` | sendTransaction within 3 seconds |
| `/phishing/seed-phrase-form.html` | 12 input fields (seed phrase phishing) |
| `/phishing/urgency-language.html` | Countdown timers, "limited time", scam language |

## Safety Notes

- Always run in Docker when testing real drainers
- The mock RPC at `/mock-rpc` returns fake data
- No real wallets or transactions involved with these test pages
