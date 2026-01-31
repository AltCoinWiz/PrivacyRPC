# Scam URL Reports & Drainer Methods

Community-maintained list of reported scam URLs, phishing sites, wallet drainers, and known attack methods targeting Solana users.

> To add a report, submit via the [website](https://privacyrpc.com/report) or [open an issue](https://github.com/AltCoinWiz/PrivacyRPC/issues/new).

---

## Reported Scam URLs

| URL | Category | Date | Confirmations |
|-----|----------|------|---------------|
| <!-- Reports will be added here --> | | | |

---

## Known Drainer Methods

### 1. Balance Scanner Drainer

- **Category:** Wallet Drainer
- **How it works:** Site makes 50+ rapid `getTokenAccountsByOwner` and `getBalance` RPC calls to scan all token balances before prompting a single "approve" transaction that drains everything.
- **Detection signals:** High-frequency RPC calls from a single tab, bulk token account enumeration, `signAllTransactions` prompt.
- **Affected wallets:** Phantom, Solflare, Backpack
- **Mitigation:** PrivacyRPC flags tabs making excessive RPC calls. Never approve bulk transaction signing on unfamiliar sites.

### 2. Fake Mint / Claim Page

- **Category:** Fake Mint
- **How it works:** Cloned NFT project frontend with a "mint" or "claim" button that triggers a transaction sending SOL to the attacker's wallet instead of a mint instruction.
- **Detection signals:** Domain doesn't match official project, transaction transfers SOL rather than calling a mint program, recently registered domain.
- **Affected wallets:** All Solana wallets
- **Mitigation:** Verify domain matches official project links. Check transaction simulation before signing.

### 3. Fake Airdrop Claim

- **Category:** Fake Airdrop
- **How it works:** Site claims user has unclaimed tokens. Prompts wallet connection, then requests signing a transaction that includes a token approval or SOL transfer to the attacker.
- **Detection signals:** Unsolicited airdrop claim, domain not associated with any known project, transaction includes unexpected transfers.
- **Affected wallets:** All Solana wallets
- **Mitigation:** Never connect wallet to claim unsolicited airdrops. Verify claims through official project channels.

### 4. Malicious Bookmarklet

- **Category:** Bookmark Scam
- **How it works:** User is tricked into saving a "tool" bookmark that contains `javascript:` code. When clicked on a dApp page, the bookmarklet reads wallet state or injects malicious transactions.
- **Detection signals:** Bookmark URL starts with `javascript:`, executes in context of current page.
- **Affected wallets:** Any wallet with an open dApp session
- **Mitigation:** Never add bookmarks from untrusted sources. PrivacyRPC blocks `javascript:` URI patterns.

### 5. Fake Recovery / Seed Phrase Phishing

- **Category:** Fake Recovery Site
- **How it works:** Site poses as a wallet recovery or migration tool, asking the user to enter their seed phrase to "restore" their wallet. Seed phrase is sent to attacker's server.
- **Detection signals:** Any site requesting seed phrase input, domains mimicking wallet brands (homograph attacks, typosquatting).
- **Affected wallets:** All wallets
- **Mitigation:** Never enter your seed phrase on any website. Wallets never ask for seed phrases online. PrivacyRPC's phishing detector flags lookalike domains.

---

## Contributing

To add a new scam URL or drainer method:

1. **Website:** Submit at [privacyrpc.com/report](https://privacyrpc.com/report)
2. **GitHub Issue:** [Open an issue](https://github.com/AltCoinWiz/PrivacyRPC/issues/new) with the URL, category, and evidence
3. **Pull Request:** Add entries directly to this file following the format above
