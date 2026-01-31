import Foundation

/// Website Scanner for PrivacyRPC
///
/// Scans websites for RPC usage, security issues, and privacy risks.
/// Matches the Scanner page in the Chrome extension.
public class WebsiteScanner {

    // MARK: - Models

    public struct ScanResult {
        public let url: String
        public let hostname: String
        public let timestamp: Date
        public let isDApp: Bool
        public let dAppName: String?
        public let category: DAppDetector.DAppCategory?
        public let rpcCalls: Int
        public let rpcEndpoints: [String]
        public let usesPublicRpc: Bool
        public let isPhishing: Bool
        public let phishingReason: String?
        public let issues: [SecurityIssue]
        public let rating: ScanRating
    }

    public struct SecurityIssue {
        public let severity: IssueSeverity
        public let title: String
        public let description: String
    }

    public enum IssueSeverity: String {
        case info = "INFO"
        case warning = "WARNING"
        case danger = "DANGER"
    }

    public enum ScanRating: String {
        case safe = "SAFE"
        case caution = "CAUTION"
        case danger = "DANGER"
        case unknown = "UNKNOWN"
    }

    // MARK: - Dependencies

    private let dAppDetector: DAppDetector
    private let phishingDetector: PhishingDetector

    // MARK: - State

    private var recentScans: [ScanResult] = []
    private let maxRecentScans = 10

    // MARK: - Constants

    private static let publicRpcPatterns = [
        "api.mainnet-beta.solana.com",
        "api.devnet.solana.com",
        "rpc.ankr.com"
    ]

    public init(
        dAppDetector: DAppDetector = DAppDetector(),
        phishingDetector: PhishingDetector = PhishingDetector()
    ) {
        self.dAppDetector = dAppDetector
        self.phishingDetector = phishingDetector
    }

    // MARK: - Public API

    /// Scan a website URL for security and privacy issues
    public func scan(
        url: String,
        knownRpcEndpoints: [String] = [],
        rpcCallCount: Int = 0
    ) -> ScanResult {
        let hostname = extractHostname(url)
        var issues: [SecurityIssue] = []

        // Check if it's a known dApp
        let siteAnalysis = dAppDetector.analyzeSite(hostname)

        // Check for phishing
        let phishingResult = phishingDetector.check(hostname)

        // Check for public RPC usage
        let usesPublicRpc = knownRpcEndpoints.contains { endpoint in
            Self.publicRpcPatterns.contains { endpoint.contains($0) }
        }

        // Build issues list
        if phishingResult.isPhishing {
            issues.append(SecurityIssue(
                severity: .danger,
                title: "Phishing Detected",
                description: phishingResult.reason ?? "Suspicious domain detected"
            ))
        }

        if usesPublicRpc {
            issues.append(SecurityIssue(
                severity: .warning,
                title: "Public RPC Endpoint",
                description: "Uses public Solana RPC - IP exposed to providers"
            ))
        }

        if !siteAnalysis.isDApp && rpcCallCount > 0 {
            issues.append(SecurityIssue(
                severity: .warning,
                title: "Unknown dApp",
                description: "This site makes RPC calls but is not a recognized dApp - exercise caution"
            ))
        }

        if rpcCallCount > 10 {
            issues.append(SecurityIssue(
                severity: .info,
                title: "High RPC Activity",
                description: "High RPC call frequency detected (\(rpcCallCount) calls)"
            ))
        }

        // Determine rating
        let rating: ScanRating
        if phishingResult.isPhishing {
            rating = .danger
        } else if issues.contains(where: { $0.severity == .danger }) {
            rating = .danger
        } else if issues.contains(where: { $0.severity == .warning }) {
            rating = .caution
        } else if siteAnalysis.isDApp {
            rating = .safe
        } else {
            rating = .unknown
        }

        let result = ScanResult(
            url: url,
            hostname: hostname,
            timestamp: Date(),
            isDApp: siteAnalysis.isDApp,
            dAppName: siteAnalysis.dAppInfo?.name,
            category: siteAnalysis.category,
            rpcCalls: rpcCallCount,
            rpcEndpoints: knownRpcEndpoints,
            usesPublicRpc: usesPublicRpc,
            isPhishing: phishingResult.isPhishing,
            phishingReason: phishingResult.reason,
            issues: issues,
            rating: rating
        )

        // Store in recent scans
        recentScans.insert(result, at: 0)
        if recentScans.count > maxRecentScans {
            recentScans.removeLast()
        }

        return result
    }

    /// Get recent scan results
    public func getRecentScans() -> [ScanResult] {
        return recentScans
    }

    /// Clear recent scans
    public func clearRecentScans() {
        recentScans.removeAll()
    }

    // MARK: - Private

    private func extractHostname(_ url: String) -> String {
        var cleaned = url
        if !cleaned.contains("://") {
            cleaned = "https://\(cleaned)"
        }
        return URL(string: cleaned)?.host ?? url
    }
}
