package com.privacyrpc.sdk

import java.util.concurrent.ConcurrentHashMap

/**
 * Traffic Monitor
 *
 * Monitors for connections to public/insecure RPC endpoints
 * and alerts users to switch to secure alternatives.
 */
class TrafficMonitor(
    private val alertHandler: AlertHandler?
) {
    private var isRunning = false
    private val recentAlerts = ConcurrentHashMap<String, Long>()
    private val alertCooldown = 60000L // 1 minute

    // Known RPC endpoints and their security tier
    private val knownRpcEndpoints = listOf(
        // Solana - Public (warn users)
        RpcProviderInfo("Solana Public", Chain.SOLANA, RpcTier.PUBLIC, "api.mainnet-beta.solana.com"),
        RpcProviderInfo("Solana Devnet", Chain.SOLANA, RpcTier.PUBLIC, "api.devnet.solana.com"),

        // Solana - Premium (good)
        RpcProviderInfo("Helius", Chain.SOLANA, RpcTier.PREMIUM, "helius-rpc.com"),
        RpcProviderInfo("Helius", Chain.SOLANA, RpcTier.PREMIUM, "helius.xyz"),
        RpcProviderInfo("Alchemy", Chain.SOLANA, RpcTier.PREMIUM, "solana-mainnet.g.alchemy.com"),
        RpcProviderInfo("QuickNode", Chain.SOLANA, RpcTier.PREMIUM, "quiknode.pro"),
        RpcProviderInfo("Triton", Chain.SOLANA, RpcTier.PREMIUM, "rpcpool.com"),
        RpcProviderInfo("GenesysGo", Chain.SOLANA, RpcTier.PREMIUM, "genesysgo.net"),

        // Ethereum - Public
        RpcProviderInfo("Cloudflare", Chain.ETHEREUM, RpcTier.PUBLIC, "cloudflare-eth.com"),
        RpcProviderInfo("Ankr", Chain.ETHEREUM, RpcTier.PUBLIC, "rpc.ankr.com"),

        // Ethereum - Premium
        RpcProviderInfo("Infura", Chain.ETHEREUM, RpcTier.PREMIUM, "infura.io"),
        RpcProviderInfo("Alchemy", Chain.ETHEREUM, RpcTier.PREMIUM, "eth-mainnet.g.alchemy.com"),
        RpcProviderInfo("QuickNode", Chain.ETHEREUM, RpcTier.PREMIUM, "quiknode.pro"),

        // Other chains - Premium
        RpcProviderInfo("Alchemy Polygon", Chain.POLYGON, RpcTier.PREMIUM, "polygon-mainnet.g.alchemy.com"),
        RpcProviderInfo("Alchemy Arbitrum", Chain.ARBITRUM, RpcTier.PREMIUM, "arb-mainnet.g.alchemy.com"),
        RpcProviderInfo("Alchemy Optimism", Chain.OPTIMISM, RpcTier.PREMIUM, "opt-mainnet.g.alchemy.com"),
        RpcProviderInfo("Alchemy Base", Chain.BASE, RpcTier.PREMIUM, "base-mainnet.g.alchemy.com"),
    )

    fun start() {
        isRunning = true
    }

    fun stop() {
        isRunning = false
    }

    /**
     * Check if a hostname is a known RPC endpoint and alert if public
     */
    fun checkEndpoint(hostname: String): RpcCheckResult {
        val provider = knownRpcEndpoints.find { hostname.contains(it.hostPattern) }

        if (provider == null) {
            return RpcCheckResult(
                isKnownRpc = false,
                provider = null,
                shouldWarn = false
            )
        }

        val shouldWarn = provider.tier == RpcTier.PUBLIC

        if (shouldWarn && shouldAlert(hostname)) {
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.PUBLIC_RPC_DETECTED,
                severity = Severity.MEDIUM,
                message = "Detected connection to public RPC: ${provider.name}. " +
                          "Consider using PrivacyRPC proxy for better security.",
                hostname = hostname,
                details = mapOf(
                    "provider" to provider.name,
                    "chain" to provider.chain.name,
                    "tier" to provider.tier.name
                )
            ))
        }

        return RpcCheckResult(
            isKnownRpc = true,
            provider = provider,
            shouldWarn = shouldWarn
        )
    }

    /**
     * Get list of known premium RPC providers
     */
    fun getPremiumProviders(chain: Chain? = null): List<RpcProviderInfo> {
        return knownRpcEndpoints.filter {
            it.tier == RpcTier.PREMIUM && (chain == null || it.chain == chain)
        }
    }

    /**
     * Check if we should send an alert (rate limiting)
     */
    private fun shouldAlert(hostname: String): Boolean {
        val now = System.currentTimeMillis()
        val lastAlert = recentAlerts[hostname] ?: 0

        if (now - lastAlert > alertCooldown) {
            recentAlerts[hostname] = now
            return true
        }

        return false
    }
}

/**
 * Result of checking an RPC endpoint
 */
data class RpcCheckResult(
    val isKnownRpc: Boolean,
    val provider: RpcProviderInfo?,
    val shouldWarn: Boolean
)
