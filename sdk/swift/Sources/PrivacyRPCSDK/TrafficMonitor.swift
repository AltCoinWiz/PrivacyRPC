import Foundation

/// Traffic Monitor for PrivacyRPC
///
/// Monitors RPC traffic patterns, detects suspicious activity,
/// and alerts on public/insecure RPC usage.
/// Matches the Chrome extension's traffic monitoring behavior.
public class TrafficMonitor {

    // MARK: - Models

    public struct RpcProviderInfo {
        public let hostname: String
        public let name: String
        public let tier: RpcTier
    }

    public enum RpcTier: String {
        case premium = "PREMIUM"
        case free = "FREE"
        case publicRpc = "PUBLIC"
        case unknown = "UNKNOWN"
    }

    public struct TrafficStats {
        public let totalRequests: Int
        public let requestsByMethod: [String: Int]
        public let requestsByEndpoint: [String: Int]
        public let publicRpcCalls: Int
        public let lastActivity: Date?
        public let alertCount: Int
    }

    // MARK: - Known RPC Providers

    private static let knownProviders: [String: RpcProviderInfo] = [
        "api.mainnet-beta.solana.com": .init(hostname: "api.mainnet-beta.solana.com", name: "Solana Public", tier: .publicRpc),
        "api.devnet.solana.com": .init(hostname: "api.devnet.solana.com", name: "Solana Devnet", tier: .publicRpc),
        "api.testnet.solana.com": .init(hostname: "api.testnet.solana.com", name: "Solana Testnet", tier: .publicRpc),
        "rpc.ankr.com": .init(hostname: "rpc.ankr.com", name: "Ankr", tier: .free),
        "mainnet.helius-rpc.com": .init(hostname: "mainnet.helius-rpc.com", name: "Helius", tier: .premium),
        "rpc.helius.xyz": .init(hostname: "rpc.helius.xyz", name: "Helius", tier: .premium),
        "solana-mainnet.g.alchemy.com": .init(hostname: "solana-mainnet.g.alchemy.com", name: "Alchemy", tier: .premium),
        "solana-mainnet.quiknode.pro": .init(hostname: "solana-mainnet.quiknode.pro", name: "QuickNode", tier: .premium),
        "ssc-dao.genesysgo.net": .init(hostname: "ssc-dao.genesysgo.net", name: "GenesysGo", tier: .premium),
    ]

    // MARK: - State

    private var totalRequests = 0
    private var requestsByMethod: [String: Int] = [:]
    private var requestsByEndpoint: [String: Int] = [:]
    private var publicRpcCalls = 0
    private var lastActivity: Date?
    private var alertCount = 0
    private var lastAlertTime: [String: Date] = [:]
    private let alertCooldown: TimeInterval = 60 // 1 minute

    private var alertHandler: ((Alert) -> Void)?

    public init(alertHandler: ((Alert) -> Void)? = nil) {
        self.alertHandler = alertHandler
    }

    // MARK: - Public API

    /// Record an RPC request
    public func recordRequest(method: String, endpoint: String) {
        totalRequests += 1
        requestsByMethod[method, default: 0] += 1
        requestsByEndpoint[endpoint, default: 0] += 1
        lastActivity = Date()

        // Check if using public RPC
        let hostname = extractHostname(endpoint)
        let provider = Self.knownProviders[hostname]

        if provider?.tier == .publicRpc {
            publicRpcCalls += 1
            sendThrottledAlert(
                key: "public_rpc_\(hostname)",
                alert: Alert(
                    type: .publicRpcDetected,
                    severity: .medium,
                    message: "Detected call to public RPC endpoint: \(provider?.name ?? hostname). Consider using a private RPC for better privacy.",
                    hostname: hostname
                )
            )
        }

        // Check for high frequency
        if totalRequests > 0 && totalRequests % 50 == 0 {
            sendThrottledAlert(
                key: "high_frequency",
                alert: Alert(
                    type: .publicRpcDetected,
                    severity: .low,
                    message: "High RPC activity: \(totalRequests) total requests",
                    hostname: hostname
                )
            )
        }
    }

    /// Identify an RPC provider by endpoint URL
    public func identifyProvider(_ endpoint: String) -> RpcProviderInfo? {
        let hostname = extractHostname(endpoint)
        return Self.knownProviders[hostname]
    }

    /// Check if an endpoint is a public RPC
    public func isPublicRpc(_ endpoint: String) -> Bool {
        let hostname = extractHostname(endpoint)
        return Self.knownProviders[hostname]?.tier == .publicRpc
    }

    /// Get current traffic stats
    public func getStats() -> TrafficStats {
        return TrafficStats(
            totalRequests: totalRequests,
            requestsByMethod: requestsByMethod,
            requestsByEndpoint: requestsByEndpoint,
            publicRpcCalls: publicRpcCalls,
            lastActivity: lastActivity,
            alertCount: alertCount
        )
    }

    /// Reset all statistics
    public func reset() {
        totalRequests = 0
        requestsByMethod.removeAll()
        requestsByEndpoint.removeAll()
        publicRpcCalls = 0
        lastActivity = nil
        alertCount = 0
    }

    // MARK: - Private

    private func sendThrottledAlert(key: String, alert: Alert) {
        let now = Date()
        if let lastTime = lastAlertTime[key], now.timeIntervalSince(lastTime) < alertCooldown {
            return
        }

        lastAlertTime[key] = now
        alertCount += 1
        alertHandler?(alert)
    }

    private func extractHostname(_ url: String) -> String {
        if let urlObj = URL(string: url) {
            return urlObj.host ?? url
        }
        return url
    }
}
