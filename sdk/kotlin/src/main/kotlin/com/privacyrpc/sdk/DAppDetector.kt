package com.privacyrpc.sdk

/**
 * dApp & Wallet Detector for PrivacyRPC
 *
 * Detects known Solana dApps and crypto wallets, matching the
 * Chrome extension's detection databases.
 */
class DAppDetector {

    // ── Data Models ──────────────────────────────────────────

    data class DAppInfo(
        val hostname: String,
        val name: String,
        val category: DAppCategory,
        val isTrusted: Boolean = true
    )

    enum class DAppCategory {
        DEX, LENDING, NFT, WALLET, EXPLORER, INFRASTRUCTURE, BRIDGE, GOVERNANCE, OTHER
    }

    data class WalletInfo(
        val id: String,
        val name: String,
        val type: String = "wallet"
    )

    data class SiteAnalysis(
        val hostname: String,
        val isDApp: Boolean,
        val dAppInfo: DAppInfo?,
        val isWalletSite: Boolean,
        val category: DAppCategory?
    )

    // ── Known Solana dApps (matching extension popup.js) ─────

    companion object {
        val KNOWN_DAPPS: Map<String, DAppInfo> = mapOf(
            // DEXs
            "jup.ag" to DAppInfo("jup.ag", "Jupiter", DAppCategory.DEX),
            "jupiter.ag" to DAppInfo("jupiter.ag", "Jupiter", DAppCategory.DEX),
            "raydium.io" to DAppInfo("raydium.io", "Raydium", DAppCategory.DEX),
            "orca.so" to DAppInfo("orca.so", "Orca", DAppCategory.DEX),
            "lifinity.io" to DAppInfo("lifinity.io", "Lifinity", DAppCategory.DEX),
            "meteora.ag" to DAppInfo("meteora.ag", "Meteora", DAppCategory.DEX),
            "phoenix.trade" to DAppInfo("phoenix.trade", "Phoenix", DAppCategory.DEX),
            "drift.trade" to DAppInfo("drift.trade", "Drift", DAppCategory.DEX),
            "zeta.markets" to DAppInfo("zeta.markets", "Zeta Markets", DAppCategory.DEX),

            // Lending / DeFi
            "marinade.finance" to DAppInfo("marinade.finance", "Marinade", DAppCategory.LENDING),
            "solend.fi" to DAppInfo("solend.fi", "Solend", DAppCategory.LENDING),
            "mango.markets" to DAppInfo("mango.markets", "Mango Markets", DAppCategory.LENDING),
            "kamino.finance" to DAppInfo("kamino.finance", "Kamino", DAppCategory.LENDING),
            "marginfi.com" to DAppInfo("marginfi.com", "marginfi", DAppCategory.LENDING),
            "solblaze.org" to DAppInfo("solblaze.org", "SolBlaze", DAppCategory.LENDING),
            "jito.network" to DAppInfo("jito.network", "Jito", DAppCategory.LENDING),

            // NFT Marketplaces
            "magiceden.io" to DAppInfo("magiceden.io", "Magic Eden", DAppCategory.NFT),
            "tensor.trade" to DAppInfo("tensor.trade", "Tensor", DAppCategory.NFT),
            "hyperspace.xyz" to DAppInfo("hyperspace.xyz", "Hyperspace", DAppCategory.NFT),
            "exchange.art" to DAppInfo("exchange.art", "Exchange Art", DAppCategory.NFT),
            "formfunction.xyz" to DAppInfo("formfunction.xyz", "Formfunction", DAppCategory.NFT),
            "solanart.io" to DAppInfo("solanart.io", "Solanart", DAppCategory.NFT),
            "opensea.io" to DAppInfo("opensea.io", "OpenSea", DAppCategory.NFT),

            // Wallets
            "phantom.app" to DAppInfo("phantom.app", "Phantom", DAppCategory.WALLET),
            "solflare.com" to DAppInfo("solflare.com", "Solflare", DAppCategory.WALLET),
            "backpack.app" to DAppInfo("backpack.app", "Backpack", DAppCategory.WALLET),
            "glow.app" to DAppInfo("glow.app", "Glow", DAppCategory.WALLET),

            // Explorers
            "solana.com" to DAppInfo("solana.com", "Solana", DAppCategory.EXPLORER),
            "solscan.io" to DAppInfo("solscan.io", "Solscan", DAppCategory.EXPLORER),
            "solanabeach.io" to DAppInfo("solanabeach.io", "Solana Beach", DAppCategory.EXPLORER),
            "explorer.solana.com" to DAppInfo("explorer.solana.com", "Solana Explorer", DAppCategory.EXPLORER),
            "xray.helius.xyz" to DAppInfo("xray.helius.xyz", "XRAY", DAppCategory.EXPLORER),
            "solana.fm" to DAppInfo("solana.fm", "SolanaFM", DAppCategory.EXPLORER),

            // Infrastructure
            "squads.so" to DAppInfo("squads.so", "Squads", DAppCategory.GOVERNANCE),
            "realms.today" to DAppInfo("realms.today", "Realms", DAppCategory.GOVERNANCE),
            "dialect.to" to DAppInfo("dialect.to", "Dialect", DAppCategory.INFRASTRUCTURE),
            "helius.dev" to DAppInfo("helius.dev", "Helius", DAppCategory.INFRASTRUCTURE),
            "shyft.to" to DAppInfo("shyft.to", "Shyft", DAppCategory.INFRASTRUCTURE),
            "quicknode.com" to DAppInfo("quicknode.com", "QuickNode", DAppCategory.INFRASTRUCTURE),
            "alchemy.com" to DAppInfo("alchemy.com", "Alchemy", DAppCategory.INFRASTRUCTURE)
        )

        /** Known wallet extension IDs (matching extension background.js) */
        val KNOWN_WALLETS: Map<String, WalletInfo> = mapOf(
            // Phantom
            "bfnaelmomeimhlpmgjnjophhpkkoljpa" to WalletInfo("bfnaelmomeimhlpmgjnjophhpkkoljpa", "Phantom"),
            "gojhcdgcpbpfigcaejpfhfegekdlneif" to WalletInfo("gojhcdgcpbpfigcaejpfhfegekdlneif", "Phantom (Dev)"),
            // Backpack
            "aflkmfhebedbjioipglgcbcmnbpgliof" to WalletInfo("aflkmfhebedbjioipglgcbcmnbpgliof", "Backpack"),
            "jnlgamecbpmbajjfhmmmlhejkemejdma" to WalletInfo("jnlgamecbpmbajjfhmmmlhejkemejdma", "Backpack"),
            // Solflare
            "bhhhlbepdkbapadjdnnojkbgioiodbic" to WalletInfo("bhhhlbepdkbapadjdnnojkbgioiodbic", "Solflare"),
            // MetaMask
            "nkbihfbeogaeaoehlefnkodbefgpgknn" to WalletInfo("nkbihfbeogaeaoehlefnkodbefgpgknn", "MetaMask"),
            "ejbalbakoplchlghecdalmeeeajnimhm" to WalletInfo("ejbalbakoplchlghecdalmeeeajnimhm", "MetaMask (Edge)"),
            // OKX
            "mcohilncbfahbmgdjkbpemcciiolgcge" to WalletInfo("mcohilncbfahbmgdjkbpemcciiolgcge", "OKX Wallet"),
            // Binance
            "fhbohimaelbohpjbbldcngcnapndodjp" to WalletInfo("fhbohimaelbohpjbbldcngcnapndodjp", "Binance Wallet"),
            // Glow
            "cfadjkfokiepapnlpbpdmaeajnhheghf" to WalletInfo("cfadjkfokiepapnlpbpdmaeajnhheghf", "Glow"),
            // Coinbase
            "dlcobpjiigpikoobohmabehhmhfoodbb" to WalletInfo("dlcobpjiigpikoobohmabehhmhfoodbb", "Coinbase Wallet"),
            "hnfanknocfeofbddgcijnmhnfnkdnaad" to WalletInfo("hnfanknocfeofbddgcijnmhnfnkdnaad", "Coinbase Wallet (Dev)"),
            // Slope
            "pocmplpaccanhmnllbbkpgfliimjljgo" to WalletInfo("pocmplpaccanhmnllbbkpgfliimjljgo", "Slope"),
            // Trust Wallet
            "ibnejdfjmmkpcnlpebklmnkoeoihofec" to WalletInfo("ibnejdfjmmkpcnlpebklmnkoeoihofec", "Trust Wallet"),
            "egjidjbpglichdcondbcbdnbeeppgdph" to WalletInfo("egjidjbpglichdcondbcbdnbeeppgdph", "Trust Wallet"),
            // Exodus
            "aholpfdialjgjfhomihkjbmgjidlcdno" to WalletInfo("aholpfdialjgjfhomihkjbmgjidlcdno", "Exodus"),
            // Rabby
            "acmacodkjbdgmoleebolmdjonilkdbch" to WalletInfo("acmacodkjbdgmoleebolmdjonilkdbch", "Rabby Wallet"),
            // Keplr
            "dmkamcknogkgcdfhhbddcghachkejeap" to WalletInfo("dmkamcknogkgcdfhhbddcghachkejeap", "Keplr"),
            // Leap
            "fcfcfllfndlomdhbehjjcoimbgofdncg" to WalletInfo("fcfcfllfndlomdhbehjjcoimbgofdncg", "Leap Wallet"),
            // Magic Eden
            "mkpegjkblkkefacfnmkajcjmabijhclg" to WalletInfo("mkpegjkblkkefacfnmkajcjmabijhclg", "Magic Eden Wallet"),
            // TipLink
            "gfkepgoophebjcgfkfgjbdkfgfcndbag" to WalletInfo("gfkepgoophebjcgfkfgjbdkfgfcndbag", "TipLink Wallet")
        )

        /** Trusted RPC endpoints (matching extension popup.js) */
        val TRUSTED_RPC_ENDPOINTS = listOf(
            "api.mainnet-beta.solana.com",
            "api.devnet.solana.com",
            "api.testnet.solana.com",
            "solana-api.projectserum.com",
            "rpc.helius.xyz",
            "mainnet.helius-rpc.com",
            "solana-mainnet.g.alchemy.com",
            "solana-mainnet.quiknode.pro",
            "ssc-dao.genesysgo.net"
        )

        /** Wallet-related name keywords */
        private val WALLET_KEYWORDS = listOf(
            "wallet", "phantom", "solana", "crypto", "backpack",
            "solflare", "metamask", "coinbase", "trust", "ledger",
            "trezor", "defi", "ethereum", "web3"
        )
    }

    // ── Detection Methods ────────────────────────────────────

    /** Check if a hostname belongs to a known dApp */
    fun isDApp(hostname: String): Boolean {
        return KNOWN_DAPPS.any { hostname.contains(it.key) }
    }

    /** Get dApp info for a hostname */
    fun getDAppInfo(hostname: String): DAppInfo? {
        return KNOWN_DAPPS.entries.firstOrNull { hostname.contains(it.key) }?.value
    }

    /** Analyze a site and return structured info */
    fun analyzeSite(hostname: String): SiteAnalysis {
        val dAppInfo = getDAppInfo(hostname)
        return SiteAnalysis(
            hostname = hostname,
            isDApp = dAppInfo != null,
            dAppInfo = dAppInfo,
            isWalletSite = dAppInfo?.category == DAppCategory.WALLET,
            category = dAppInfo?.category
        )
    }

    /** Check if a wallet extension ID is known */
    fun isKnownWallet(extensionId: String): Boolean {
        return extensionId in KNOWN_WALLETS
    }

    /** Get wallet info by extension ID */
    fun getWalletInfo(extensionId: String): WalletInfo? {
        return KNOWN_WALLETS[extensionId]
    }

    /** Check if a name looks like a wallet extension */
    fun isWalletByName(name: String): Boolean {
        val lower = name.lowercase()
        return WALLET_KEYWORDS.any { lower.contains(it) }
    }

    /** Check if an RPC endpoint is trusted */
    fun isTrustedEndpoint(url: String): Boolean {
        return TRUSTED_RPC_ENDPOINTS.any { url.contains(it) }
    }
}
