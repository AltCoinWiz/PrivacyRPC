package com.privacyrpc.sdk

/**
 * ZK Compression Module for PrivacyRPC
 *
 * Tracks and manages ZK-compressed Solana RPC calls,
 * matching the ZK Compression panel in the Chrome extension.
 * Powered by Light Protocol.
 */
class ZkCompression {

    /** ZK Compression statistics */
    data class ZkStats(
        val compressedCalls: Long = 0,
        val regularCalls: Long = 0,
        val cacheHits: Long = 0,
        val estimatedSavings: Long = 0 // in lamports
    )

    private var stats = ZkStats()
    private val cache = mutableMapOf<String, CachedResult>()
    private val cacheTtlMs = 30_000L // 30 second cache

    private data class CachedResult(
        val result: String,
        val timestamp: Long
    )

    /** ZK Compression RPC methods (Light Protocol) */
    companion object {
        val ZK_METHODS = setOf(
            "getCompressedAccount",
            "getCompressedAccountsByOwner",
            "getCompressedBalance",
            "getCompressedBalanceByOwner",
            "getCompressedTokenAccountBalance",
            "getCompressedTokenAccountsByOwner",
            "getCompressedTokenAccountsByDelegate",
            "getCompressedTokenBalancesByOwner",
            "getCompressedMintTokenHolders",
            "getValidityProof",
            "getMultipleCompressedAccounts"
        )

        /** Estimated lamport savings per compressed call */
        private const val ESTIMATED_SAVINGS_PER_CALL = 1000L
    }

    /** Check if an RPC method is a ZK compression method */
    fun isZkMethod(method: String): Boolean {
        return method in ZK_METHODS
    }

    /** Record a ZK compressed call */
    fun recordCompressedCall(method: String, cacheKey: String? = null) {
        val now = System.currentTimeMillis()

        // Check cache
        if (cacheKey != null) {
            val cached = cache[cacheKey]
            if (cached != null && now - cached.timestamp < cacheTtlMs) {
                stats = stats.copy(
                    cacheHits = stats.cacheHits + 1,
                    estimatedSavings = stats.estimatedSavings + ESTIMATED_SAVINGS_PER_CALL
                )
                return
            }
        }

        stats = stats.copy(
            compressedCalls = stats.compressedCalls + 1,
            estimatedSavings = stats.estimatedSavings + ESTIMATED_SAVINGS_PER_CALL
        )
    }

    /** Record a regular (non-compressed) call */
    fun recordRegularCall() {
        stats = stats.copy(regularCalls = stats.regularCalls + 1)
    }

    /** Cache a ZK compression result */
    fun cacheResult(key: String, result: String) {
        cache[key] = CachedResult(result, System.currentTimeMillis())

        // Evict old entries
        val now = System.currentTimeMillis()
        cache.entries.removeIf { now - it.value.timestamp > cacheTtlMs }
    }

    /** Get current ZK stats */
    fun getStats(): ZkStats = stats

    /** Format savings for display */
    fun formatSavings(lamports: Long): String {
        return when {
            lamports < 1000 -> "$lamports lam"
            lamports < 1_000_000 -> "${lamports / 1000.0}K"
            else -> "${"%.4f".format(lamports / 1_000_000_000.0)} SOL"
        }
    }

    /** Reset stats */
    fun reset() {
        stats = ZkStats()
        cache.clear()
    }
}
