package com.privacyrpc.sdk

import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.io.IOException
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

/**
 * Tor Proxy Integration for PrivacyRPC
 *
 * Routes RPC traffic through Tor network to hide IP address from
 * RPC providers. Prevents correlation between IP and wallet address.
 *
 * Privacy benefits:
 * - RPC provider cannot see your real IP
 * - Cannot correlate your location with wallet activity
 * - Prevents transaction timing analysis based on IP
 *
 * Trade-offs:
 * - Adds 200-500ms latency per request
 * - Some RPC providers may block Tor exit nodes
 * - Not suitable for high-frequency trading
 */
class TorProxy(
    private val config: TorConfig = TorConfig()
) {
    private var isConnected = false
    private var torProcess: Process? = null

    /**
     * Tor configuration
     */
    data class TorConfig(
        /** SOCKS5 proxy host (default: localhost) */
        val socksHost: String = "127.0.0.1",
        /** SOCKS5 proxy port (default: 9050 for Tor daemon, 9150 for Tor Browser) */
        val socksPort: Int = 9050,
        /** Use embedded Tor (requires tor binary) */
        val useEmbedded: Boolean = false,
        /** Path to tor binary if using embedded */
        val torBinaryPath: String? = null,
        /** Request new circuit for each request (slower but more private) */
        val isolateByRequest: Boolean = false,
        /** Timeout for Tor connections in ms */
        val connectTimeout: Int = 30000,
        /** Fallback to direct connection if Tor fails */
        val fallbackToDirect: Boolean = false
    )

    /**
     * Check if Tor is available
     */
    fun isAvailable(): Boolean {
        return try {
            val socket = Socket()
            socket.connect(InetSocketAddress(config.socksHost, config.socksPort), 5000)
            socket.close()
            true
        } catch (e: IOException) {
            false
        }
    }

    /**
     * Get a Proxy object for use with HttpURLConnection
     */
    fun getProxy(): Proxy {
        return Proxy(Proxy.Type.SOCKS, InetSocketAddress(config.socksHost, config.socksPort))
    }

    /**
     * Create a socket factory that routes through Tor
     */
    fun createSocketFactory(): TorSocketFactory {
        return TorSocketFactory(config)
    }

    /**
     * Connect to Tor (starts embedded if configured)
     */
    fun connect(): Boolean {
        if (config.useEmbedded && config.torBinaryPath != null) {
            return startEmbeddedTor()
        }

        // Check if external Tor is running
        isConnected = isAvailable()
        return isConnected
    }

    /**
     * Disconnect from Tor
     */
    fun disconnect() {
        torProcess?.destroy()
        torProcess = null
        isConnected = false
    }

    /**
     * Get current Tor exit node IP (for verification)
     */
    suspend fun getExitNodeIp(): String? {
        return try {
            val proxy = getProxy()
            val url = java.net.URL("https://check.torproject.org/api/ip")
            val connection = url.openConnection(proxy) as HttpsURLConnection
            connection.connectTimeout = config.connectTimeout
            connection.readTimeout = 10000

            val response = connection.inputStream.bufferedReader().readText()
            // Parse JSON response: {"IsTor":true,"IP":"..."}
            val ipMatch = """"IP"\s*:\s*"([^"]+)"""".toRegex().find(response)
            ipMatch?.groupValues?.get(1)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Request a new Tor circuit (new exit IP)
     * Requires Tor control port access
     */
    fun requestNewCircuit(controlPort: Int = 9051, password: String = ""): Boolean {
        return try {
            val socket = Socket(config.socksHost, controlPort)
            val output = socket.getOutputStream().bufferedWriter()
            val input = socket.getInputStream().bufferedReader()

            // Authenticate
            if (password.isNotEmpty()) {
                output.write("AUTHENTICATE \"$password\"\r\n")
            } else {
                output.write("AUTHENTICATE\r\n")
            }
            output.flush()
            val authResponse = input.readLine()

            if (!authResponse.startsWith("250")) {
                socket.close()
                return false
            }

            // Request new circuit
            output.write("SIGNAL NEWNYM\r\n")
            output.flush()
            val signalResponse = input.readLine()

            socket.close()
            signalResponse.startsWith("250")
        } catch (e: Exception) {
            false
        }
    }

    private fun startEmbeddedTor(): Boolean {
        val torPath = config.torBinaryPath ?: return false

        return try {
            val processBuilder = ProcessBuilder(
                torPath,
                "--SocksPort", config.socksPort.toString(),
                "--DataDirectory", System.getProperty("java.io.tmpdir") + "/privacyrpc_tor"
            )
            torProcess = processBuilder.start()

            // Wait for Tor to bootstrap
            var attempts = 0
            while (attempts < 30 && !isAvailable()) {
                Thread.sleep(1000)
                attempts++
            }

            isConnected = isAvailable()
            isConnected
        } catch (e: Exception) {
            false
        }
    }
}

/**
 * Socket factory that routes through Tor SOCKS5 proxy
 */
class TorSocketFactory(
    private val config: TorProxy.TorConfig
) : SSLSocketFactory() {

    private val defaultFactory = SSLSocketFactory.getDefault() as SSLSocketFactory
    private val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress(config.socksHost, config.socksPort))

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
 * Privacy level presets
 */
enum class PrivacyLevel {
    /** Direct connection - fastest, no privacy */
    NONE,

    /** Route through Tor - slower, hides IP */
    TOR,

    /** Tor with circuit isolation per request - slowest, maximum privacy */
    TOR_ISOLATED
}
