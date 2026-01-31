package com.privacyrpc.sdk

/**
 * PrivacyRPC SDK (PrivacyRPC)
 *
 * Privacy-First Solana RPC Protection.
 * Secure RPC proxy with Tor routing, phishing detection,
 * MITM protection, ZK compression tracking, and more.
 *
 * Usage:
 * ```kotlin
 * val privacyRpc = PrivacyRPC.Builder()
 *     .primaryRpc("https://mainnet.helius-rpc.com/?api-key=YOUR_KEY")
 *     .addFallback("https://api.mainnet-beta.solana.com")
 *     .enableZkCompression()
 *     .enableNotifications()
 *     .enableDAppDetection()
 *     .onAlert { alert -> handleAlert(alert) }
 *     .build()
 *
 * privacyRpc.start()
 *
 * // Use privacyRpc.proxyUrl as your RPC endpoint
 * val rpcUrl = privacyRpc.proxyUrl // "http://127.0.0.1:8899"
 * ```
 */
class PrivacyRPC private constructor(
    private val config: PrivacyRPCConfig
) {
    private var proxyServer: RpcProxyServer? = null
    private var certificatePinner: CertificatePinner? = null
    private var trafficMonitor: TrafficMonitor? = null

    /** ZK Compression tracker (Light Protocol) */
    val zkCompression: ZkCompression = ZkCompression()

    /** Notification hub for multi-channel alerts */
    val notificationHub: NotificationHub = NotificationHub()

    /** dApp and wallet detector */
    val dAppDetector: DAppDetector = DAppDetector()

    /** Phishing detector */
    val phishingDetector: PhishingDetector = PhishingDetector()

    /** Website scanner */
    val websiteScanner: WebsiteScanner by lazy {
        WebsiteScanner(dAppDetector, phishingDetector)
    }

    /** Brand info */
    val brandName: String get() = PrivacyRPCBranding.NAME
    val brandVersion: String get() = PrivacyRPCBranding.VERSION

    val proxyUrl: String get() = "http://127.0.0.1:${config.proxyPort}"
    val isRunning: Boolean get() = proxyServer?.isRunning == true

    /**
     * Start the PrivacyRPC protection
     */
    fun start(): Result<Unit> {
        return try {
            // Initialize certificate pinner
            certificatePinner = CertificatePinner(config.pinnedEndpoints)
            certificatePinner?.pinAll()

            // Start proxy server
            proxyServer = RpcProxyServer(
                port = config.proxyPort,
                primaryRpc = config.primaryRpc,
                fallbackRpcs = config.fallbackRpcs,
                requestInterceptor = config.requestInterceptor,
                responseInterceptor = config.responseInterceptor,
                alertHandler = config.alertHandler,
                privacyLevel = config.privacyLevel,
                torConfig = config.torConfig,
                vpnConfig = config.vpnConfig,
                privacyRoute = config.privacyRoute
            )
            proxyServer?.start()

            // Start traffic monitoring if enabled
            if (config.monitorTraffic) {
                trafficMonitor = TrafficMonitor(config.alertHandler)
                trafficMonitor?.start()
            }

            // Send protection-on notification
            if (config.enableNotifications) {
                notificationHub.notify(
                    NotificationHub.Notification(
                        type = NotificationHub.NotificationType.PROTECTION_ON,
                        title = "Protection Enabled",
                        message = "Your RPC traffic is now being routed through the secure proxy"
                    )
                )
            }

            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Stop PrivacyRPC protection
     */
    fun stop() {
        proxyServer?.stop()
        trafficMonitor?.stop()
        proxyServer = null
        trafficMonitor = null

        if (config.enableNotifications) {
            notificationHub.notify(
                NotificationHub.Notification(
                    type = NotificationHub.NotificationType.PROTECTION_OFF,
                    title = "Protection Disabled",
                    message = "Your RPC traffic is no longer protected"
                )
            )
        }
    }

    /**
     * Update the primary RPC endpoint
     */
    fun setPrimaryRpc(url: String) {
        proxyServer?.setPrimaryRpc(url)
    }

    /**
     * Get proxy statistics
     */
    fun getStats(): ProxyStats? = proxyServer?.getStats()

    /**
     * Get ZK Compression stats
     */
    fun getZkStats(): ZkCompression.ZkStats = zkCompression.getStats()

    /**
     * Scan a website for security issues
     */
    fun scanWebsite(
        url: String,
        rpcEndpoints: List<String> = emptyList(),
        rpcCallCount: Int = 0
    ): WebsiteScanner.ScanResult {
        return websiteScanner.scan(url, rpcEndpoints, rpcCallCount)
    }

    /**
     * Check a domain for phishing
     */
    fun checkPhishing(domain: String) = phishingDetector.checkDomain(domain)

    /**
     * Check if a hostname is a known dApp
     */
    fun isDApp(hostname: String) = dAppDetector.isDApp(hostname)

    /**
     * Forward a single RPC request (for direct integration)
     */
    suspend fun forwardRequest(request: RpcRequest): RpcResponse {
        return proxyServer?.forwardRequest(request)
            ?: throw IllegalStateException("PrivacyRPC not started")
    }

    /**
     * Builder for PrivacyRPC
     */
    class Builder {
        private var primaryRpc: String = "https://api.mainnet-beta.solana.com"
        private var fallbackRpcs: MutableList<String> = mutableListOf()
        private var proxyPort: Int = 8899
        private var pinnedEndpoints: MutableList<String> = mutableListOf()
        private var alertHandler: AlertHandler? = null
        private var requestInterceptor: RequestInterceptor? = null
        private var responseInterceptor: ResponseInterceptor? = null
        private var monitorTraffic: Boolean = false
        private var privacyLevel: PrivacyLevel = PrivacyLevel.NONE
        private var torConfig: TorProxy.TorConfig = TorProxy.TorConfig()
        private var vpnConfig: VpnProxy.VpnConfig? = null
        private var privacyRoute: PrivacyRoute = PrivacyRoute.Direct
        private var enableZkCompression: Boolean = false
        private var enableNotifications: Boolean = false
        private var enableDAppDetection: Boolean = false

        /**
         * Set the primary RPC endpoint
         */
        fun primaryRpc(url: String) = apply { this.primaryRpc = url }

        /**
         * Add a fallback RPC endpoint
         */
        fun addFallback(url: String) = apply { this.fallbackRpcs.add(url) }

        /**
         * Set the local proxy port (default: 8899)
         */
        fun proxyPort(port: Int) = apply { this.proxyPort = port }

        /**
         * Add an endpoint for certificate pinning
         */
        fun pinEndpoint(hostname: String) = apply { this.pinnedEndpoints.add(hostname) }

        /**
         * Set alert handler for security events
         */
        fun onAlert(handler: AlertHandler) = apply { this.alertHandler = handler }

        /**
         * Set request interceptor (for logging, modification, etc.)
         */
        fun interceptRequests(interceptor: RequestInterceptor) = apply {
            this.requestInterceptor = interceptor
        }

        /**
         * Set response interceptor
         */
        fun interceptResponses(interceptor: ResponseInterceptor) = apply {
            this.responseInterceptor = interceptor
        }

        /**
         * Enable traffic monitoring for public RPC detection
         */
        fun monitorTraffic(enabled: Boolean = true) = apply {
            this.monitorTraffic = enabled
        }

        /**
         * Use Helius as primary RPC
         */
        fun useHelius(apiKey: String) = apply {
            this.primaryRpc = "https://mainnet.helius-rpc.com/?api-key=$apiKey"
            this.pinnedEndpoints.add("mainnet.helius-rpc.com")
        }

        /**
         * Use Alchemy as primary RPC
         */
        fun useAlchemy(apiKey: String, chain: Chain = Chain.SOLANA) = apply {
            this.primaryRpc = when (chain) {
                Chain.SOLANA -> "https://solana-mainnet.g.alchemy.com/v2/$apiKey"
                Chain.ETHEREUM -> "https://eth-mainnet.g.alchemy.com/v2/$apiKey"
                Chain.POLYGON -> "https://polygon-mainnet.g.alchemy.com/v2/$apiKey"
                Chain.ARBITRUM -> "https://arb-mainnet.g.alchemy.com/v2/$apiKey"
                Chain.OPTIMISM -> "https://opt-mainnet.g.alchemy.com/v2/$apiKey"
                Chain.BASE -> "https://base-mainnet.g.alchemy.com/v2/$apiKey"
            }
        }

        /**
         * Use QuickNode as primary RPC
         */
        fun useQuickNode(endpoint: String) = apply {
            this.primaryRpc = endpoint
        }

        /**
         * Set privacy level (controls Tor routing)
         *
         * - NONE: Direct connection (fastest, RPC sees your IP)
         * - TOR: Route through Tor (hides IP, adds ~300ms latency)
         * - TOR_ISOLATED: New Tor circuit per request (slowest, max privacy)
         */
        fun privacyLevel(level: PrivacyLevel) = apply {
            this.privacyLevel = level
        }

        /**
         * Enable Tor routing to hide IP from RPC providers
         */
        fun useTor(config: TorProxy.TorConfig = TorProxy.TorConfig()) = apply {
            this.privacyLevel = PrivacyLevel.TOR
            this.torConfig = config
        }

        /**
         * Maximum privacy mode - new Tor circuit for each request
         */
        fun useMaxPrivacy() = apply {
            this.privacyLevel = PrivacyLevel.TOR_ISOLATED
        }

        /**
         * Route through VPN/proxy (faster than Tor)
         */
        fun useVpn(config: VpnProxy.VpnConfig) = apply {
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Use Mullvad VPN (privacy-focused, no logs)
         */
        fun useMullvad() = apply {
            val config = VpnProxy.mullvad()
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Use ProtonVPN
         */
        fun useProtonVpn(username: String, password: String) = apply {
            val config = VpnProxy.protonVpn(username, password)
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Use NordVPN
         */
        fun useNordVpn(username: String, password: String, server: String = "us5839.nordvpn.com") = apply {
            val config = VpnProxy.nordVpn(username, password, server)
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Use generic SOCKS5 proxy
         */
        fun useSocks5(host: String, port: Int, username: String? = null, password: String? = null) = apply {
            val config = VpnProxy.socks5(host, port, username, password)
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Use HTTP proxy
         */
        fun useHttpProxy(host: String, port: Int, username: String? = null, password: String? = null) = apply {
            val config = VpnProxy.http(host, port, username, password)
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Use system proxy settings
         */
        fun useSystemProxy() = apply {
            val config = VpnProxy.system()
            this.vpnConfig = config
            this.privacyRoute = PrivacyRoute.Vpn(config)
        }

        /**
         * Maximum privacy: Tor over VPN
         * Traffic goes: You -> VPN -> Tor -> RPC
         * VPN hides that you're using Tor
         * Tor hides your activity from VPN
         */
        fun useTorOverVpn(vpnConfig: VpnProxy.VpnConfig) = apply {
            this.vpnConfig = vpnConfig
            this.privacyLevel = PrivacyLevel.TOR
            this.privacyRoute = PrivacyRoute.TorOverVpn(vpnConfig, torConfig)
        }

        /**
         * Enable ZK Compression tracking (Light Protocol)
         */
        fun enableZkCompression(enabled: Boolean = true) = apply {
            this.enableZkCompression = enabled
        }

        /**
         * Enable notification hub for multi-channel alerts
         */
        fun enableNotifications(enabled: Boolean = true) = apply {
            this.enableNotifications = enabled
        }

        /**
         * Enable dApp and wallet detection
         */
        fun enableDAppDetection(enabled: Boolean = true) = apply {
            this.enableDAppDetection = enabled
        }

        fun build(): PrivacyRPC {
            return PrivacyRPC(
                PrivacyRPCConfig(
                    primaryRpc = primaryRpc,
                    fallbackRpcs = fallbackRpcs,
                    proxyPort = proxyPort,
                    pinnedEndpoints = pinnedEndpoints,
                    alertHandler = alertHandler,
                    requestInterceptor = requestInterceptor,
                    responseInterceptor = responseInterceptor,
                    monitorTraffic = monitorTraffic,
                    privacyLevel = privacyLevel,
                    torConfig = torConfig,
                    vpnConfig = vpnConfig,
                    privacyRoute = privacyRoute,
                    enableZkCompression = enableZkCompression,
                    enableNotifications = enableNotifications,
                    enableDAppDetection = enableDAppDetection
                )
            )
        }
    }
}

/**
 * SDK Configuration
 */
data class PrivacyRPCConfig(
    val primaryRpc: String,
    val fallbackRpcs: List<String>,
    val proxyPort: Int,
    val pinnedEndpoints: List<String>,
    val alertHandler: AlertHandler?,
    val requestInterceptor: RequestInterceptor?,
    val responseInterceptor: ResponseInterceptor?,
    val monitorTraffic: Boolean,
    val privacyLevel: PrivacyLevel = PrivacyLevel.NONE,
    val torConfig: TorProxy.TorConfig? = null,
    val vpnConfig: VpnProxy.VpnConfig? = null,
    val privacyRoute: PrivacyRoute = PrivacyRoute.Direct,
    val enableZkCompression: Boolean = false,
    val enableNotifications: Boolean = false,
    val enableDAppDetection: Boolean = false
)

/**
 * Supported blockchain networks
 */
enum class Chain {
    SOLANA,
    ETHEREUM,
    POLYGON,
    ARBITRUM,
    OPTIMISM,
    BASE
}

/**
 * Alert handler interface
 */
fun interface AlertHandler {
    fun onAlert(alert: PrivacyRPCAlert)
}

/**
 * Request interceptor interface
 */
fun interface RequestInterceptor {
    fun intercept(request: RpcRequest): RpcRequest
}

/**
 * Response interceptor interface
 */
fun interface ResponseInterceptor {
    fun intercept(response: RpcResponse): RpcResponse
}
