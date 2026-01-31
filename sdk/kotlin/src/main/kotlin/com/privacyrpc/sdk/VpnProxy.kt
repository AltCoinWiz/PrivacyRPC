package com.privacyrpc.sdk

import java.net.Authenticator
import java.net.InetSocketAddress
import java.net.PasswordAuthentication
import java.net.Proxy
import java.net.Socket
import java.io.IOException
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory

/**
 * VPN/Proxy Integration for PrivacyRPC
 *
 * Routes RPC traffic through VPN or proxy servers to hide IP address.
 * Faster than Tor but requires trusting the VPN provider.
 *
 * Supports:
 * - SOCKS5 proxies (most VPNs)
 * - HTTP/HTTPS proxies
 * - WireGuard (via system tunnel)
 * - Custom proxy providers (Mullvad, ProtonVPN, etc.)
 *
 * Privacy trade-offs vs Tor:
 * - Faster (50-100ms vs 300-500ms)
 * - VPN provider can see traffic (vs Tor's 3-relay anonymity)
 * - Better for streaming/trading (lower latency)
 * - Easier to set up
 */
class VpnProxy(
    private val config: VpnConfig
) {
    private var isConnected = false

    /**
     * VPN/Proxy configuration
     */
    data class VpnConfig(
        /** Proxy type */
        val type: ProxyType = ProxyType.SOCKS5,
        /** Proxy host */
        val host: String = "127.0.0.1",
        /** Proxy port */
        val port: Int = 1080,
        /** Username for authentication (optional) */
        val username: String? = null,
        /** Password for authentication (optional) */
        val password: String? = null,
        /** Connection timeout in ms */
        val connectTimeout: Int = 10000,
        /** Fallback to direct if proxy fails */
        val fallbackToDirect: Boolean = false,
        /** Provider preset (optional) */
        val provider: VpnProvider? = null
    )

    /**
     * Supported proxy types
     */
    enum class ProxyType {
        /** SOCKS5 proxy (most common for VPNs) */
        SOCKS5,
        /** HTTP proxy */
        HTTP,
        /** HTTPS proxy (HTTP CONNECT) */
        HTTPS,
        /** System proxy (uses system settings) */
        SYSTEM
    }

    /**
     * Pre-configured VPN providers
     */
    enum class VpnProvider(
        val displayName: String,
        val defaultType: ProxyType,
        val defaultPort: Int,
        val supportsAuth: Boolean
    ) {
        MULLVAD("Mullvad VPN", ProxyType.SOCKS5, 1080, false),
        PROTONVPN("ProtonVPN", ProxyType.SOCKS5, 1080, true),
        NORDVPN("NordVPN", ProxyType.SOCKS5, 1080, true),
        EXPRESSVPN("ExpressVPN", ProxyType.SOCKS5, 1080, true),
        SURFSHARK("Surfshark", ProxyType.SOCKS5, 1080, true),
        PRIVATE_INTERNET_ACCESS("PIA", ProxyType.SOCKS5, 1080, true),
        WINDSCRIBE("Windscribe", ProxyType.SOCKS5, 1080, true),
        CUSTOM("Custom", ProxyType.SOCKS5, 1080, true)
    }

    companion object {
        /**
         * Create config for Mullvad VPN
         * Mullvad SOCKS5: 10.64.0.1:1080 (when connected)
         */
        fun mullvad(): VpnConfig = VpnConfig(
            type = ProxyType.SOCKS5,
            host = "10.64.0.1",
            port = 1080,
            provider = VpnProvider.MULLVAD
        )

        /**
         * Create config for ProtonVPN
         */
        fun protonVpn(username: String, password: String): VpnConfig = VpnConfig(
            type = ProxyType.SOCKS5,
            host = "127.0.0.1",
            port = 1080,
            username = username,
            password = password,
            provider = VpnProvider.PROTONVPN
        )

        /**
         * Create config for NordVPN
         */
        fun nordVpn(username: String, password: String, server: String = "us5839.nordvpn.com"): VpnConfig = VpnConfig(
            type = ProxyType.SOCKS5,
            host = server,
            port = 1080,
            username = username,
            password = password,
            provider = VpnProvider.NORDVPN
        )

        /**
         * Create config for generic SOCKS5 proxy
         */
        fun socks5(host: String, port: Int, username: String? = null, password: String? = null): VpnConfig = VpnConfig(
            type = ProxyType.SOCKS5,
            host = host,
            port = port,
            username = username,
            password = password
        )

        /**
         * Create config for HTTP proxy
         */
        fun http(host: String, port: Int, username: String? = null, password: String? = null): VpnConfig = VpnConfig(
            type = ProxyType.HTTP,
            host = host,
            port = port,
            username = username,
            password = password
        )

        /**
         * Use system proxy settings
         */
        fun system(): VpnConfig = VpnConfig(type = ProxyType.SYSTEM)
    }

    /**
     * Check if proxy is available
     */
    fun isAvailable(): Boolean {
        if (config.type == ProxyType.SYSTEM) {
            return true // Assume system proxy is configured
        }

        return try {
            val socket = Socket()
            socket.connect(InetSocketAddress(config.host, config.port), 5000)
            socket.close()
            true
        } catch (e: IOException) {
            false
        }
    }

    /**
     * Connect to the proxy
     */
    fun connect(): Boolean {
        // Set up authentication if needed
        if (config.username != null && config.password != null) {
            Authenticator.setDefault(object : Authenticator() {
                override fun getPasswordAuthentication(): PasswordAuthentication {
                    return PasswordAuthentication(config.username, config.password.toCharArray())
                }
            })
        }

        isConnected = isAvailable()
        return isConnected
    }

    /**
     * Disconnect from proxy
     */
    fun disconnect() {
        Authenticator.setDefault(null)
        isConnected = false
    }

    /**
     * Get a Proxy object for use with HttpURLConnection
     */
    fun getProxy(): Proxy {
        return when (config.type) {
            ProxyType.SOCKS5 -> Proxy(Proxy.Type.SOCKS, InetSocketAddress(config.host, config.port))
            ProxyType.HTTP, ProxyType.HTTPS -> Proxy(Proxy.Type.HTTP, InetSocketAddress(config.host, config.port))
            ProxyType.SYSTEM -> Proxy.NO_PROXY // Will use system settings via java.net.useSystemProxies
        }
    }

    /**
     * Get current external IP (for verification)
     */
    suspend fun getExternalIp(): String? {
        return try {
            val proxy = getProxy()
            val url = java.net.URL("https://api.ipify.org?format=json")
            val connection = if (config.type == ProxyType.SYSTEM) {
                url.openConnection() as HttpsURLConnection
            } else {
                url.openConnection(proxy) as HttpsURLConnection
            }
            connection.connectTimeout = config.connectTimeout
            connection.readTimeout = 10000

            val response = connection.inputStream.bufferedReader().readText()
            // Parse: {"ip":"1.2.3.4"}
            val ipMatch = """"ip"\s*:\s*"([^"]+)"""".toRegex().find(response)
            ipMatch?.groupValues?.get(1)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Create socket factory for this proxy
     */
    fun createSocketFactory(): ProxySocketFactory {
        return ProxySocketFactory(config)
    }
}

/**
 * Socket factory that routes through proxy
 */
class ProxySocketFactory(
    private val config: VpnProxy.VpnConfig
) : SSLSocketFactory() {

    private val defaultFactory = SSLSocketFactory.getDefault() as SSLSocketFactory
    private val proxy: Proxy = when (config.type) {
        VpnProxy.ProxyType.SOCKS5 -> Proxy(Proxy.Type.SOCKS, InetSocketAddress(config.host, config.port))
        VpnProxy.ProxyType.HTTP, VpnProxy.ProxyType.HTTPS -> Proxy(Proxy.Type.HTTP, InetSocketAddress(config.host, config.port))
        VpnProxy.ProxyType.SYSTEM -> Proxy.NO_PROXY
    }

    override fun getDefaultCipherSuites(): Array<String> = defaultFactory.defaultCipherSuites
    override fun getSupportedCipherSuites(): Array<String> = defaultFactory.supportedCipherSuites

    override fun createSocket(socket: Socket?, host: String?, port: Int, autoClose: Boolean): Socket {
        return defaultFactory.createSocket(socket, host, port, autoClose)
    }

    override fun createSocket(host: String?, port: Int): Socket {
        val socket = Socket(proxy)
        socket.connect(InetSocketAddress(host, port), config.connectTimeout)
        return defaultFactory.createSocket(socket, host, port, true)
    }

    override fun createSocket(host: String?, port: Int, localHost: java.net.InetAddress?, localPort: Int): Socket {
        val socket = Socket(proxy)
        socket.bind(InetSocketAddress(localHost, localPort))
        socket.connect(InetSocketAddress(host, port), config.connectTimeout)
        return defaultFactory.createSocket(socket, host, port, true)
    }

    override fun createSocket(host: java.net.InetAddress?, port: Int): Socket {
        val socket = Socket(proxy)
        socket.connect(InetSocketAddress(host, port), config.connectTimeout)
        return defaultFactory.createSocket(socket, host?.hostAddress, port, true)
    }

    override fun createSocket(address: java.net.InetAddress?, port: Int, localAddress: java.net.InetAddress?, localPort: Int): Socket {
        val socket = Socket(proxy)
        socket.bind(InetSocketAddress(localAddress, localPort))
        socket.connect(InetSocketAddress(address, port), config.connectTimeout)
        return defaultFactory.createSocket(socket, address?.hostAddress, port, true)
    }
}

/**
 * Combined privacy routing options
 */
sealed class PrivacyRoute {
    /** Direct connection - no privacy routing */
    object Direct : PrivacyRoute()

    /** Route through Tor */
    data class Tor(val config: TorProxy.TorConfig = TorProxy.TorConfig()) : PrivacyRoute()

    /** Route through VPN/proxy */
    data class Vpn(val config: VpnProxy.VpnConfig) : PrivacyRoute()

    /** Chain: Tor over VPN (VPN -> Tor -> RPC) */
    data class TorOverVpn(
        val vpnConfig: VpnProxy.VpnConfig,
        val torConfig: TorProxy.TorConfig = TorProxy.TorConfig()
    ) : PrivacyRoute()
}
