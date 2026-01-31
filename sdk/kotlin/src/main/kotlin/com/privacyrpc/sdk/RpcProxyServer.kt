package com.privacyrpc.sdk

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * RPC Proxy Server
 *
 * A lightweight HTTP server that proxies JSON-RPC requests to a configured
 * RPC endpoint. Supports failover, request/response interception, Tor routing, and stats.
 */
class RpcProxyServer(
    private val port: Int,
    private var primaryRpc: String,
    private val fallbackRpcs: List<String>,
    private val requestInterceptor: RequestInterceptor?,
    private val responseInterceptor: ResponseInterceptor?,
    private val alertHandler: AlertHandler?,
    private val privacyLevel: PrivacyLevel = PrivacyLevel.NONE,
    private val torConfig: TorProxy.TorConfig? = null,
    private val vpnConfig: VpnProxy.VpnConfig? = null,
    private val privacyRoute: PrivacyRoute = PrivacyRoute.Direct
) {
    private var torProxy: TorProxy? = null
    private var vpnProxy: VpnProxy? = null
    private var serverSocket: ServerSocket? = null
    private var serverThread: Thread? = null
    private val shouldRun = AtomicBoolean(false)
    private val executor: ExecutorService = Executors.newCachedThreadPool()

    // Statistics
    private val requestCount = AtomicLong(0)
    private val errorCount = AtomicLong(0)
    private val methodStats = ConcurrentHashMap<String, AtomicLong>()
    private var lastRequestTime = AtomicLong(0)
    private var startTime = 0L

    val isRunning: Boolean get() = shouldRun.get()

    fun start() {
        if (isRunning) return

        // Initialize privacy routing based on configuration
        when (privacyRoute) {
            is PrivacyRoute.Direct -> {
                // No privacy routing
            }
            is PrivacyRoute.Tor -> {
                initializeTor()
            }
            is PrivacyRoute.Vpn -> {
                initializeVpn((privacyRoute as PrivacyRoute.Vpn).config)
            }
            is PrivacyRoute.TorOverVpn -> {
                val route = privacyRoute as PrivacyRoute.TorOverVpn
                initializeVpn(route.vpnConfig)
                initializeTor()
            }
        }

        // Legacy support for privacyLevel without privacyRoute
        if (privacyRoute == PrivacyRoute.Direct && privacyLevel != PrivacyLevel.NONE) {
            initializeTor()
        }

        // Initialize VPN if configured but not via privacyRoute
        if (vpnConfig != null && vpnProxy == null) {
            initializeVpn(vpnConfig)
        }

        serverSocket = ServerSocket(port)
        shouldRun.set(true)
        startTime = System.currentTimeMillis()

        serverThread = Thread({
            while (shouldRun.get()) {
                try {
                    val client = serverSocket?.accept() ?: break
                    executor.submit { handleClient(client) }
                } catch (e: Exception) {
                    if (shouldRun.get()) {
                        alertHandler?.onAlert(PrivacyRPCAlert(
                            type = AlertType.PROXY_ERROR,
                            severity = Severity.LOW,
                            message = "Proxy server error: ${e.message}"
                        ))
                    }
                }
            }
        }, "PrivacyRPC-Proxy")

        serverThread?.start()
    }

    private fun initializeTor() {
        torProxy = TorProxy(torConfig ?: TorProxy.TorConfig())
        if (!torProxy!!.connect()) {
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.PROXY_ERROR,
                severity = Severity.HIGH,
                message = "Failed to connect to Tor. Is Tor running on port ${torConfig?.socksPort ?: 9050}?"
            ))
            if (torConfig?.fallbackToDirect != true) {
                throw RuntimeException("Tor connection required but unavailable")
            }
        } else {
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.PROXY_STARTED,
                severity = Severity.INFO,
                message = "Connected to Tor network. Your IP is hidden from RPC providers."
            ))
        }
    }

    private fun initializeVpn(config: VpnProxy.VpnConfig) {
        vpnProxy = VpnProxy(config)
        if (!vpnProxy!!.connect()) {
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.PROXY_ERROR,
                severity = Severity.HIGH,
                message = "Failed to connect to VPN proxy at ${config.host}:${config.port}"
            ))
            if (!config.fallbackToDirect) {
                throw RuntimeException("VPN proxy connection required but unavailable")
            }
        } else {
            val providerName = config.provider?.displayName ?: "VPN Proxy"
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.PROXY_STARTED,
                severity = Severity.INFO,
                message = "Connected to $providerName. Your IP is hidden from RPC providers."
            ))
        }
    }

    fun stop() {
        shouldRun.set(false)
        try {
            serverSocket?.close()
        } catch (e: Exception) {}

        torProxy?.disconnect()
        vpnProxy?.disconnect()

        executor.shutdown()
        serverSocket = null
        serverThread = null
        torProxy = null
        vpnProxy = null
    }

    fun setPrimaryRpc(url: String) {
        primaryRpc = url
    }

    fun getStats(): ProxyStats {
        return ProxyStats(
            isRunning = isRunning,
            port = port,
            primaryRpc = primaryRpc,
            totalRequests = requestCount.get(),
            totalErrors = errorCount.get(),
            methodStats = methodStats.mapValues { it.value.get() },
            lastRequestTime = lastRequestTime.get(),
            uptimeMs = if (startTime > 0) System.currentTimeMillis() - startTime else 0
        )
    }

    suspend fun forwardRequest(request: RpcRequest): RpcResponse {
        return withContext(Dispatchers.IO) {
            val interceptedRequest = requestInterceptor?.intercept(request) ?: request
            val responseBody = sendToRpc(interceptedRequest.toJson())
            val response = RpcResponse.fromJson(responseBody, interceptedRequest.id)
            responseInterceptor?.intercept(response) ?: response
        }
    }

    private fun handleClient(client: Socket) {
        try {
            client.soTimeout = 30000

            val reader = BufferedReader(InputStreamReader(client.getInputStream()))
            val writer = OutputStreamWriter(client.getOutputStream())

            // Read HTTP request
            val requestLine = reader.readLine() ?: return

            // Handle CORS preflight
            if (requestLine.startsWith("OPTIONS")) {
                sendCorsResponse(writer)
                return
            }

            // Read headers
            val headers = mutableMapOf<String, String>()
            var contentLength = 0
            var line = reader.readLine()
            while (line != null && line.isNotEmpty()) {
                val colonIndex = line.indexOf(':')
                if (colonIndex > 0) {
                    val key = line.substring(0, colonIndex).trim().lowercase()
                    val value = line.substring(colonIndex + 1).trim()
                    headers[key] = value
                    if (key == "content-length") {
                        contentLength = value.toIntOrNull() ?: 0
                    }
                }
                line = reader.readLine()
            }

            // Read body
            val body = if (contentLength > 0) {
                val buffer = CharArray(contentLength)
                var totalRead = 0
                while (totalRead < contentLength) {
                    val read = reader.read(buffer, totalRead, contentLength - totalRead)
                    if (read == -1) break
                    totalRead += read
                }
                String(buffer, 0, totalRead)
            } else ""

            // Parse and optionally intercept request
            var request = RpcRequest.fromJson(body)
            if (requestInterceptor != null) {
                request = requestInterceptor.intercept(request)
            }

            // Track stats
            trackRequest(request)

            // Forward to RPC
            var responseBody = sendToRpc(request.toJson())

            // Optionally intercept response
            if (responseInterceptor != null) {
                val response = RpcResponse.fromJson(responseBody, request.id)
                val intercepted = responseInterceptor.intercept(response)
                responseBody = intercepted.toJson()
            }

            // Send response
            sendHttpResponse(writer, responseBody)

        } catch (e: Exception) {
            errorCount.incrementAndGet()
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.PROXY_ERROR,
                severity = Severity.LOW,
                message = "Request handling error: ${e.message}"
            ))
        } finally {
            try { client.close() } catch (e: Exception) {}
        }
    }

    private fun trackRequest(request: RpcRequest) {
        requestCount.incrementAndGet()
        lastRequestTime.set(System.currentTimeMillis())
        methodStats.computeIfAbsent(request.method) { AtomicLong(0) }.incrementAndGet()
    }

    private fun sendToRpc(requestBody: String): String {
        // Try primary
        try {
            return httpPost(primaryRpc, requestBody)
        } catch (e: Exception) {
            alertHandler?.onAlert(PrivacyRPCAlert(
                type = AlertType.RPC_FAILOVER,
                severity = Severity.MEDIUM,
                message = "Primary RPC failed, trying fallbacks: ${e.message}"
            ))
        }

        // Try fallbacks
        for (fallback in fallbackRpcs) {
            try {
                return httpPost(fallback, requestBody)
            } catch (e: Exception) {
                continue
            }
        }

        // All failed
        errorCount.incrementAndGet()
        alertHandler?.onAlert(PrivacyRPCAlert(
            type = AlertType.RPC_ALL_FAILED,
            severity = Severity.HIGH,
            message = "All RPC endpoints failed"
        ))

        return """{"jsonrpc":"2.0","error":{"code":-32000,"message":"All RPC endpoints failed"},"id":null}"""
    }

    private fun httpPost(url: String, body: String): String {
        // Request new circuit if using isolated Tor mode
        if (privacyLevel == PrivacyLevel.TOR_ISOLATED) {
            torProxy?.requestNewCircuit()
        }

        // Determine which proxy to use
        val proxy: java.net.Proxy? = when {
            // Tor over VPN: use Tor (which goes through VPN at system level)
            privacyRoute is PrivacyRoute.TorOverVpn && torProxy != null -> torProxy!!.getProxy()
            // Tor only
            torProxy != null && (privacyLevel != PrivacyLevel.NONE || privacyRoute is PrivacyRoute.Tor) -> torProxy!!.getProxy()
            // VPN/proxy only
            vpnProxy != null -> vpnProxy!!.getProxy()
            // Direct connection
            else -> null
        }

        val connection = if (proxy != null) {
            URL(url).openConnection(proxy) as HttpsURLConnection
        } else {
            URL(url).openConnection() as HttpsURLConnection
        }

        // Longer timeouts for privacy routing
        val usingPrivacyRouting = proxy != null
        connection.requestMethod = "POST"
        connection.setRequestProperty("Content-Type", "application/json")
        connection.connectTimeout = if (usingPrivacyRouting) 30000 else 10000
        connection.readTimeout = if (usingPrivacyRouting) 60000 else 30000
        connection.doOutput = true

        connection.outputStream.use { it.write(body.toByteArray()) }

        val responseCode = connection.responseCode
        val inputStream = if (responseCode in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream ?: throw Exception("HTTP $responseCode")
        }

        return inputStream.bufferedReader().readText()
    }

    private fun sendHttpResponse(writer: OutputStreamWriter, body: String) {
        writer.write("HTTP/1.1 200 OK\r\n")
        writer.write("Content-Type: application/json\r\n")
        writer.write("Content-Length: ${body.length}\r\n")
        writer.write("Access-Control-Allow-Origin: *\r\n")
        writer.write("Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n")
        writer.write("Access-Control-Allow-Headers: Content-Type\r\n")
        writer.write("\r\n")
        writer.write(body)
        writer.flush()
    }

    private fun sendCorsResponse(writer: OutputStreamWriter) {
        writer.write("HTTP/1.1 204 No Content\r\n")
        writer.write("Access-Control-Allow-Origin: *\r\n")
        writer.write("Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n")
        writer.write("Access-Control-Allow-Headers: Content-Type\r\n")
        writer.write("Access-Control-Max-Age: 86400\r\n")
        writer.write("\r\n")
        writer.flush()
    }
}

/**
 * Proxy statistics
 */
data class ProxyStats(
    val isRunning: Boolean,
    val port: Int,
    val primaryRpc: String,
    val totalRequests: Long,
    val totalErrors: Long,
    val methodStats: Map<String, Long>,
    val lastRequestTime: Long,
    val uptimeMs: Long
)
