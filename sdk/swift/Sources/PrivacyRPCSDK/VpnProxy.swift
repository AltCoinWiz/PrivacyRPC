import Foundation

/// VPN/Proxy Integration for PrivacyRPC
///
/// Routes RPC traffic through VPN or proxy connections.
/// Supports SOCKS5, HTTP, HTTPS, and system proxy.
/// Matches the Kotlin SDK VpnProxy implementation.
public class VpnProxy {

    // MARK: - Configuration

    public enum ProxyType: String {
        case socks5 = "SOCKS5"
        case http = "HTTP"
        case https = "HTTPS"
        case system = "SYSTEM"
    }

    public struct ProxyConfig {
        public let type: ProxyType
        public let host: String
        public let port: UInt16
        public let username: String?
        public let password: String?

        public init(
            type: ProxyType = .socks5,
            host: String = "127.0.0.1",
            port: UInt16 = 1080,
            username: String? = nil,
            password: String? = nil
        ) {
            self.type = type
            self.host = host
            self.port = port
            self.username = username
            self.password = password
        }
    }

    /// Pre-configured VPN provider presets
    public enum VpnProvider {
        case mullvad(socksPort: UInt16 = 1080)
        case protonVPN(socksPort: UInt16 = 1080)
        case nordVPN(socksPort: UInt16 = 1080)
        case custom(ProxyConfig)

        public var config: ProxyConfig {
            switch self {
            case .mullvad(let port):
                return ProxyConfig(type: .socks5, host: "127.0.0.1", port: port)
            case .protonVPN(let port):
                return ProxyConfig(type: .socks5, host: "127.0.0.1", port: port)
            case .nordVPN(let port):
                return ProxyConfig(type: .socks5, host: "127.0.0.1", port: port)
            case .custom(let config):
                return config
            }
        }
    }

    // MARK: - State

    public private(set) var isConnected = false
    public private(set) var externalIp: String?

    private let config: ProxyConfig
    private var alertHandler: ((Alert) -> Void)?

    public init(config: ProxyConfig, alertHandler: ((Alert) -> Void)? = nil) {
        self.config = config
        self.alertHandler = alertHandler
    }

    public convenience init(provider: VpnProvider, alertHandler: ((Alert) -> Void)? = nil) {
        self.init(config: provider.config, alertHandler: alertHandler)
    }

    // MARK: - Public API

    /// Start the VPN/proxy connection
    public func start() async throws {
        // Verify proxy is reachable
        let reachable = await checkProxyReachable()
        guard reachable else {
            throw PrivacyRPCError.serverError(
                "Cannot reach proxy at \(config.host):\(config.port)"
            )
        }

        isConnected = true
        externalIp = await fetchExternalIp()

        alertHandler?(Alert(
            type: .proxyStarted,
            severity: .info,
            message: "VPN proxy connected via \(config.type.rawValue) at \(config.host):\(config.port)"
        ))
    }

    /// Stop the VPN/proxy connection
    public func stop() {
        isConnected = false
        externalIp = nil

        alertHandler?(Alert(
            type: .proxyStopped,
            severity: .info,
            message: "VPN proxy disconnected"
        ))
    }

    /// Create a URLSession configured to use this proxy
    public func createProxySession() -> URLSession {
        let sessionConfig = URLSessionConfiguration.ephemeral

        switch config.type {
        case .socks5:
            sessionConfig.connectionProxyDictionary = [
                kCFStreamPropertySOCKSProxyHost as String: config.host,
                kCFStreamPropertySOCKSProxyPort as String: config.port,
                kCFStreamPropertySOCKSVersion as String: kCFStreamSocketSOCKSVersion5
            ]
            if let user = config.username, let pass = config.password {
                sessionConfig.connectionProxyDictionary?[kCFStreamPropertySOCKSUser as String] = user
                sessionConfig.connectionProxyDictionary?[kCFStreamPropertySOCKSPassword as String] = pass
            }

        case .http, .https:
            sessionConfig.connectionProxyDictionary = [
                kCFNetworkProxiesHTTPEnable as String: true,
                kCFNetworkProxiesHTTPProxy as String: config.host,
                kCFNetworkProxiesHTTPPort as String: config.port,
                "HTTPSEnable": true,
                "HTTPSProxy": config.host,
                "HTTPSPort": config.port
            ]

        case .system:
            // Use system proxy settings (default behavior)
            break
        }

        return URLSession(configuration: sessionConfig)
    }

    /// Get the proxy URL string
    public var proxyUrl: String {
        let scheme: String
        switch config.type {
        case .socks5: scheme = "socks5"
        case .http: scheme = "http"
        case .https: scheme = "https"
        case .system: return "system"
        }

        if let user = config.username, let pass = config.password {
            return "\(scheme)://\(user):\(pass)@\(config.host):\(config.port)"
        }
        return "\(scheme)://\(config.host):\(config.port)"
    }

    // MARK: - Private

    private func checkProxyReachable() async -> Bool {
        // Simple TCP connection check
        do {
            let url = URL(string: "http://\(config.host):\(config.port)")!
            let session = URLSession(configuration: .ephemeral)
            session.configuration.timeoutIntervalForRequest = 5

            let (_, response) = try await session.data(from: url)
            return (response as? HTTPURLResponse) != nil
        } catch {
            // For SOCKS proxies, connection refusal is normal (not HTTP)
            // We consider it reachable if it at least responded
            return false
        }
    }

    private func fetchExternalIp() async -> String? {
        do {
            let session = createProxySession()
            let (data, _) = try await session.data(from: URL(string: "https://api.ipify.org?format=json")!)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let ip = json["ip"] as? String {
                return ip
            }
        } catch {
            // Ignore
        }
        return nil
    }
}
