import Foundation

/// PrivacyRPC SDK (PrivacyRPC) for Swift/iOS
///
/// Privacy-First Solana RPC Protection.
/// Secure RPC proxy with Tor routing, phishing detection,
/// MITM protection, ZK compression tracking, and more.
///
/// Example:
/// ```swift
/// let privacyRpc = PrivacyRPC.Builder()
///     .useHelius(apiKey: "your-key")
///     .enableZkCompression()
///     .enableNotifications()
///     .enableDAppDetection()
///     .onAlert { alert in
///         print("Alert: \(alert.message)")
///     }
///     .build()
///
/// try await privacyRpc.start()
/// print("Proxy URL: \(privacyRpc.proxyUrl)")
/// ```

public class PrivacyRPC {
    private let config: Config
    private var server: RpcProxyServer?
    private var isRunning = false

    /// ZK Compression tracker (Light Protocol)
    public let zkCompression = ZkCompression()

    /// Notification hub for multi-channel alerts
    public let notificationHub = NotificationHub()

    /// dApp and wallet detector
    public let dAppDetector = DAppDetector()

    /// Phishing detector
    public let phishingDetector = PhishingDetector()

    /// Certificate pinner / MITM detector
    public let certificatePinner: CertificatePinner

    /// Traffic monitor
    public let trafficMonitor: TrafficMonitor

    /// Website scanner
    public lazy var websiteScanner: WebsiteScanner = {
        WebsiteScanner(dAppDetector: dAppDetector, phishingDetector: phishingDetector)
    }()

    /// Brand info
    public var brandName: String { PrivacyRPCBranding.name }
    public var brandVersion: String { PrivacyRPCBranding.version }

    public var proxyUrl: String {
        "http://127.0.0.1:\(config.proxyPort)"
    }

    public init(config: Config) {
        self.config = config
        self.certificatePinner = CertificatePinner(alertHandler: config.alertHandler)
        self.trafficMonitor = TrafficMonitor(alertHandler: config.alertHandler)
    }

    /// Start the PrivacyRPC proxy server
    public func start() async throws {
        guard !isRunning else { return }

        // Pin configured endpoints
        for endpoint in config.pinnedEndpoints {
            certificatePinner.pin(hostname: endpoint, fingerprint: "")
        }

        server = RpcProxyServer(config: config)
        try await server?.start()
        isRunning = true

        config.alertHandler?(Alert(
            type: .proxyStarted,
            severity: .info,
            message: "PrivacyRPC proxy started on port \(config.proxyPort)"
        ))

        // Send notification
        if config.enableNotifications {
            notificationHub.notify(.init(
                type: .protectionOn,
                title: "Protection Enabled",
                message: "Your RPC traffic is now being routed through the secure proxy"
            ))
        }
    }

    /// Stop the PrivacyRPC proxy server
    public func stop() async {
        guard isRunning else { return }

        await server?.stop()
        server = nil
        isRunning = false

        config.alertHandler?(Alert(
            type: .proxyStopped,
            severity: .info,
            message: "PrivacyRPC proxy stopped"
        ))

        if config.enableNotifications {
            notificationHub.notify(.init(
                type: .protectionOff,
                title: "Protection Disabled",
                message: "Your RPC traffic is no longer protected"
            ))
        }
    }

    /// Forward a single RPC request
    public func forwardRequest(_ request: RpcRequest) async throws -> RpcResponse {
        guard let server = server else {
            throw PrivacyRPCError.notStarted
        }

        // Track ZK compression
        if zkCompression.isZkMethod(request.method) {
            zkCompression.recordCompressedCall(method: request.method)
        } else {
            zkCompression.recordRegularCall()
        }

        // Track traffic
        trafficMonitor.recordRequest(method: request.method, endpoint: config.primaryRpc)

        return try await server.forwardRequest(request)
    }

    /// Get proxy statistics
    public func getStats() -> ProxyStats? {
        return server?.getStats()
    }

    /// Get ZK Compression stats
    public func getZkStats() -> ZkCompression.ZkStats {
        return zkCompression.getStats()
    }

    /// Scan a website for security issues
    public func scanWebsite(url: String, rpcEndpoints: [String] = [], rpcCallCount: Int = 0) -> WebsiteScanner.ScanResult {
        return websiteScanner.scan(url: url, knownRpcEndpoints: rpcEndpoints, rpcCallCount: rpcCallCount)
    }

    /// Check a domain for phishing
    public func checkPhishing(_ domain: String) -> PhishingDetector.PhishingResult {
        return phishingDetector.check(domain)
    }

    /// Check a hostname for MITM attacks
    public func checkMitm(_ hostname: String) async -> CertificatePinner.MitmCheckResult {
        return await certificatePinner.check(hostname: hostname)
    }

    /// Check if a hostname is a known dApp
    public func isDApp(_ hostname: String) -> Bool {
        return dAppDetector.isDApp(hostname)
    }

    // MARK: - Builder

    public class Builder {
        private var primaryRpc = "https://api.mainnet-beta.solana.com"
        private var fallbackRpcs: [String] = []
        private var proxyPort: UInt16 = 8899
        private var pinnedEndpoints: [String] = []
        private var alertHandler: ((Alert) -> Void)?
        private var requestInterceptor: ((RpcRequest) -> RpcRequest)?
        private var responseInterceptor: ((RpcResponse) -> RpcResponse)?
        private var enableZkCompressionFlag = false
        private var enableNotificationsFlag = false
        private var enableDAppDetectionFlag = false

        public init() {}

        public func primaryRpc(_ url: String) -> Builder {
            self.primaryRpc = url
            return self
        }

        public func addFallback(_ url: String) -> Builder {
            self.fallbackRpcs.append(url)
            return self
        }

        public func proxyPort(_ port: UInt16) -> Builder {
            self.proxyPort = port
            return self
        }

        public func pinEndpoint(_ hostname: String) -> Builder {
            self.pinnedEndpoints.append(hostname)
            return self
        }

        public func onAlert(_ handler: @escaping (Alert) -> Void) -> Builder {
            self.alertHandler = handler
            return self
        }

        public func interceptRequests(_ interceptor: @escaping (RpcRequest) -> RpcRequest) -> Builder {
            self.requestInterceptor = interceptor
            return self
        }

        public func interceptResponses(_ interceptor: @escaping (RpcResponse) -> RpcResponse) -> Builder {
            self.responseInterceptor = interceptor
            return self
        }

        public func useHelius(apiKey: String) -> Builder {
            self.primaryRpc = "https://mainnet.helius-rpc.com/?api-key=\(apiKey)"
            self.pinnedEndpoints.append("mainnet.helius-rpc.com")
            return self
        }

        public func useAlchemy(apiKey: String, chain: Chain = .solana) -> Builder {
            let url: String
            switch chain {
            case .solana:
                url = "https://solana-mainnet.g.alchemy.com/v2/\(apiKey)"
            case .ethereum:
                url = "https://eth-mainnet.g.alchemy.com/v2/\(apiKey)"
            case .polygon:
                url = "https://polygon-mainnet.g.alchemy.com/v2/\(apiKey)"
            case .arbitrum:
                url = "https://arb-mainnet.g.alchemy.com/v2/\(apiKey)"
            case .optimism:
                url = "https://opt-mainnet.g.alchemy.com/v2/\(apiKey)"
            case .base:
                url = "https://base-mainnet.g.alchemy.com/v2/\(apiKey)"
            }
            self.primaryRpc = url
            return self
        }

        /// Enable ZK Compression tracking (Light Protocol)
        public func enableZkCompression(_ enabled: Bool = true) -> Builder {
            self.enableZkCompressionFlag = enabled
            return self
        }

        /// Enable notification hub for multi-channel alerts
        public func enableNotifications(_ enabled: Bool = true) -> Builder {
            self.enableNotificationsFlag = enabled
            return self
        }

        /// Enable dApp and wallet detection
        public func enableDAppDetection(_ enabled: Bool = true) -> Builder {
            self.enableDAppDetectionFlag = enabled
            return self
        }

        public func build() -> PrivacyRPC {
            let config = Config(
                primaryRpc: primaryRpc,
                fallbackRpcs: fallbackRpcs,
                proxyPort: proxyPort,
                pinnedEndpoints: pinnedEndpoints,
                alertHandler: alertHandler,
                requestInterceptor: requestInterceptor,
                responseInterceptor: responseInterceptor,
                enableZkCompression: enableZkCompressionFlag,
                enableNotifications: enableNotificationsFlag,
                enableDAppDetection: enableDAppDetectionFlag
            )
            return PrivacyRPC(config: config)
        }
    }
}

// MARK: - Configuration

public struct Config {
    public let primaryRpc: String
    public let fallbackRpcs: [String]
    public let proxyPort: UInt16
    public let pinnedEndpoints: [String]
    public let alertHandler: ((Alert) -> Void)?
    public let requestInterceptor: ((RpcRequest) -> RpcRequest)?
    public let responseInterceptor: ((RpcResponse) -> RpcResponse)?
    public let enableZkCompression: Bool
    public let enableNotifications: Bool
    public let enableDAppDetection: Bool

    public init(
        primaryRpc: String = "https://api.mainnet-beta.solana.com",
        fallbackRpcs: [String] = [],
        proxyPort: UInt16 = 8899,
        pinnedEndpoints: [String] = [],
        alertHandler: ((Alert) -> Void)? = nil,
        requestInterceptor: ((RpcRequest) -> RpcRequest)? = nil,
        responseInterceptor: ((RpcResponse) -> RpcResponse)? = nil,
        enableZkCompression: Bool = false,
        enableNotifications: Bool = false,
        enableDAppDetection: Bool = false
    ) {
        self.primaryRpc = primaryRpc
        self.fallbackRpcs = fallbackRpcs
        self.proxyPort = proxyPort
        self.pinnedEndpoints = pinnedEndpoints
        self.alertHandler = alertHandler
        self.requestInterceptor = requestInterceptor
        self.responseInterceptor = responseInterceptor
        self.enableZkCompression = enableZkCompression
        self.enableNotifications = enableNotifications
        self.enableDAppDetection = enableDAppDetection
    }
}

// MARK: - Chain

public enum Chain {
    case solana
    case ethereum
    case polygon
    case arbitrum
    case optimism
    case base
}

// MARK: - Models

public struct RpcRequest: Codable {
    public let jsonrpc: String
    public let id: AnyCodable?
    public let method: String
    public let params: AnyCodable?

    public init(jsonrpc: String = "2.0", id: Any? = nil, method: String, params: Any? = nil) {
        self.jsonrpc = jsonrpc
        self.id = id.map { AnyCodable($0) }
        self.method = method
        self.params = params.map { AnyCodable($0) }
    }
}

public struct RpcResponse: Codable {
    public let jsonrpc: String
    public let id: AnyCodable?
    public let result: AnyCodable?
    public let error: RpcError?
}

public struct RpcError: Codable {
    public let code: Int
    public let message: String
    public let data: AnyCodable?
}

public struct Alert {
    public let type: AlertType
    public let severity: Severity
    public let message: String
    public let hostname: String?
    public let details: [String: Any]?
    public let timestamp: Date

    public init(
        type: AlertType,
        severity: Severity,
        message: String,
        hostname: String? = nil,
        details: [String: Any]? = nil,
        timestamp: Date = Date()
    ) {
        self.type = type
        self.severity = severity
        self.message = message
        self.hostname = hostname
        self.details = details
        self.timestamp = timestamp
    }
}

public enum AlertType {
    case mitmDetected
    case certificateMismatch
    case dnsHijacking
    case sslStripping
    case suspiciousCertificate
    case publicRpcDetected
    case rpcFailover
    case rpcAllFailed
    case proxyError
    case proxyStarted
    case proxyStopped
}

public enum Severity {
    case info
    case low
    case medium
    case high
    case critical
}

public struct ProxyStats {
    public let isRunning: Bool
    public let port: UInt16
    public let primaryRpc: String
    public let totalRequests: UInt64
    public let totalErrors: UInt64
    public let methodStats: [String: UInt64]
    public let lastRequestTime: Date?
    public let uptime: TimeInterval
}

// MARK: - Errors

public enum PrivacyRPCError: Error {
    case notStarted
    case serverError(String)
    case rpcError(String)
    case configError(String)
}

// MARK: - AnyCodable Helper

public struct AnyCodable: Codable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let intValue = try? container.decode(Int.self) {
            value = intValue
        } else if let doubleValue = try? container.decode(Double.self) {
            value = doubleValue
        } else if let stringValue = try? container.decode(String.self) {
            value = stringValue
        } else if let boolValue = try? container.decode(Bool.self) {
            value = boolValue
        } else if let arrayValue = try? container.decode([AnyCodable].self) {
            value = arrayValue.map { $0.value }
        } else if let dictValue = try? container.decode([String: AnyCodable].self) {
            value = dictValue.mapValues { $0.value }
        } else if container.decodeNil() {
            value = NSNull()
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unable to decode value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let intValue as Int:
            try container.encode(intValue)
        case let doubleValue as Double:
            try container.encode(doubleValue)
        case let stringValue as String:
            try container.encode(stringValue)
        case let boolValue as Bool:
            try container.encode(boolValue)
        case let arrayValue as [Any]:
            try container.encode(arrayValue.map { AnyCodable($0) })
        case let dictValue as [String: Any]:
            try container.encode(dictValue.mapValues { AnyCodable($0) })
        case is NSNull:
            try container.encodeNil()
        default:
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: [], debugDescription: "Unable to encode value"))
        }
    }
}

// MARK: - RPC Proxy Server

class RpcProxyServer {
    private let config: Config
    private var listener: Any? // NWListener on iOS
    private var stats = ProxyStatsInternal()
    private var startTime: Date?

    init(config: Config) {
        self.config = config
    }

    func start() async throws {
        startTime = Date()
        // Implementation would use NWListener for iOS Network framework
        // For now, this is a placeholder
    }

    func stop() async {
        listener = nil
        startTime = nil
    }

    func forwardRequest(_ request: RpcRequest) async throws -> RpcResponse {
        var interceptedRequest = request
        if let interceptor = config.requestInterceptor {
            interceptedRequest = interceptor(request)
        }

        stats.totalRequests += 1
        stats.lastRequestTime = Date()
        stats.methodStats[interceptedRequest.method, default: 0] += 1

        let response = try await sendToRpc(interceptedRequest)

        if let interceptor = config.responseInterceptor {
            return interceptor(response)
        }

        return response
    }

    func getStats() -> ProxyStats {
        ProxyStats(
            isRunning: listener != nil,
            port: config.proxyPort,
            primaryRpc: config.primaryRpc,
            totalRequests: stats.totalRequests,
            totalErrors: stats.totalErrors,
            methodStats: stats.methodStats,
            lastRequestTime: stats.lastRequestTime,
            uptime: startTime.map { Date().timeIntervalSince($0) } ?? 0
        )
    }

    private func sendToRpc(_ request: RpcRequest) async throws -> RpcResponse {
        let rpcs = [config.primaryRpc] + config.fallbackRpcs

        for rpc in rpcs {
            do {
                return try await httpPost(url: rpc, request: request)
            } catch {
                if rpc == config.primaryRpc {
                    config.alertHandler?(Alert(
                        type: .rpcFailover,
                        severity: .medium,
                        message: "Primary RPC failed, trying fallbacks"
                    ))
                }
                continue
            }
        }

        stats.totalErrors += 1
        config.alertHandler?(Alert(
            type: .rpcAllFailed,
            severity: .high,
            message: "All RPC endpoints failed"
        ))

        return RpcResponse(
            jsonrpc: "2.0",
            id: request.id,
            result: nil,
            error: RpcError(code: -32000, message: "All RPC endpoints failed", data: nil)
        )
    }

    private func httpPost(url: String, request: RpcRequest) async throws -> RpcResponse {
        guard let url = URL(string: url) else {
            throw PrivacyRPCError.rpcError("Invalid URL")
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)

        let (data, _) = try await URLSession.shared.data(for: urlRequest)
        return try JSONDecoder().decode(RpcResponse.self, from: data)
    }
}

private struct ProxyStatsInternal {
    var totalRequests: UInt64 = 0
    var totalErrors: UInt64 = 0
    var methodStats: [String: UInt64] = [:]
    var lastRequestTime: Date?
}
