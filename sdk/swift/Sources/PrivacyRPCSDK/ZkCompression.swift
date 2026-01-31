import Foundation

/// ZK Compression Module for PrivacyRPC
///
/// Tracks and manages ZK-compressed Solana RPC calls.
/// Powered by Light Protocol.
/// Matches the Chrome extension's ZK Compression panel.
public class ZkCompression {

    // MARK: - Models

    public struct ZkStats {
        public let compressedCalls: Int
        public let regularCalls: Int
        public let cacheHits: Int
        public let estimatedSavings: Int // in lamports

        public static let zero = ZkStats(compressedCalls: 0, regularCalls: 0, cacheHits: 0, estimatedSavings: 0)
    }

    // MARK: - Constants

    /// ZK Compression RPC methods (Light Protocol)
    public static let zkMethods: Set<String> = [
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
    ]

    /// Estimated lamport savings per compressed call
    private static let estimatedSavingsPerCall = 1000

    // MARK: - State

    private var compressedCalls = 0
    private var regularCalls = 0
    private var cacheHits = 0
    private var estimatedSavings = 0

    private var cache: [String: CachedResult] = [:]
    private let cacheTtl: TimeInterval = 30 // 30 seconds

    private struct CachedResult {
        let result: String
        let timestamp: Date
    }

    public init() {}

    // MARK: - Public API

    /// Check if an RPC method is a ZK compression method
    public func isZkMethod(_ method: String) -> Bool {
        return Self.zkMethods.contains(method)
    }

    /// Record a ZK compressed call
    public func recordCompressedCall(method: String, cacheKey: String? = nil) {
        // Check cache
        if let key = cacheKey, let cached = cache[key] {
            if Date().timeIntervalSince(cached.timestamp) < cacheTtl {
                cacheHits += 1
                estimatedSavings += Self.estimatedSavingsPerCall
                return
            }
        }

        compressedCalls += 1
        estimatedSavings += Self.estimatedSavingsPerCall
    }

    /// Record a regular (non-compressed) call
    public func recordRegularCall() {
        regularCalls += 1
    }

    /// Cache a ZK compression result
    public func cacheResult(key: String, result: String) {
        cache[key] = CachedResult(result: result, timestamp: Date())

        // Evict old entries
        let now = Date()
        cache = cache.filter { now.timeIntervalSince($0.value.timestamp) < cacheTtl }
    }

    /// Get current ZK stats
    public func getStats() -> ZkStats {
        return ZkStats(
            compressedCalls: compressedCalls,
            regularCalls: regularCalls,
            cacheHits: cacheHits,
            estimatedSavings: estimatedSavings
        )
    }

    /// Format savings for display
    public func formatSavings(_ lamports: Int) -> String {
        if lamports < 1000 {
            return "\(lamports) lam"
        } else if lamports < 1_000_000 {
            return String(format: "%.1fK", Double(lamports) / 1000.0)
        } else {
            return String(format: "%.4f SOL", Double(lamports) / 1_000_000_000.0)
        }
    }

    /// Reset stats
    public func reset() {
        compressedCalls = 0
        regularCalls = 0
        cacheHits = 0
        estimatedSavings = 0
        cache.removeAll()
    }
}
