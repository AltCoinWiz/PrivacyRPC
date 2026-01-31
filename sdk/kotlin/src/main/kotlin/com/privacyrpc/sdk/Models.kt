package com.privacyrpc.sdk

import org.json.JSONArray
import org.json.JSONObject

/**
 * JSON-RPC Request
 */
data class RpcRequest(
    val jsonrpc: String = "2.0",
    val id: Any?,
    val method: String,
    val params: Any? = null
) {
    fun toJson(): String {
        val json = JSONObject()
        json.put("jsonrpc", jsonrpc)
        json.put("id", id)
        json.put("method", method)
        if (params != null) {
            json.put("params", params)
        }
        return json.toString()
    }

    companion object {
        fun fromJson(jsonString: String): RpcRequest {
            val json = JSONObject(jsonString)
            return RpcRequest(
                jsonrpc = json.optString("jsonrpc", "2.0"),
                id = json.opt("id"),
                method = json.optString("method", ""),
                params = json.opt("params")
            )
        }
    }
}

/**
 * JSON-RPC Response
 */
data class RpcResponse(
    val jsonrpc: String = "2.0",
    val id: Any?,
    val result: Any? = null,
    val error: RpcError? = null
) {
    val isError: Boolean get() = error != null

    fun toJson(): String {
        val json = JSONObject()
        json.put("jsonrpc", jsonrpc)
        json.put("id", id)
        if (error != null) {
            val errorJson = JSONObject()
            errorJson.put("code", error.code)
            errorJson.put("message", error.message)
            if (error.data != null) {
                errorJson.put("data", error.data)
            }
            json.put("error", errorJson)
        } else {
            json.put("result", result)
        }
        return json.toString()
    }

    companion object {
        fun fromJson(jsonString: String, requestId: Any?): RpcResponse {
            val json = JSONObject(jsonString)
            val errorJson = json.optJSONObject("error")
            return RpcResponse(
                jsonrpc = json.optString("jsonrpc", "2.0"),
                id = json.opt("id") ?: requestId,
                result = json.opt("result"),
                error = if (errorJson != null) {
                    RpcError(
                        code = errorJson.optInt("code"),
                        message = errorJson.optString("message"),
                        data = errorJson.opt("data")
                    )
                } else null
            )
        }
    }
}

/**
 * JSON-RPC Error
 */
data class RpcError(
    val code: Int,
    val message: String,
    val data: Any? = null
)

/**
 * PrivacyRPC Alert
 */
data class PrivacyRPCAlert(
    val type: AlertType,
    val severity: Severity,
    val message: String,
    val hostname: String? = null,
    val details: Map<String, Any>? = null,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Alert types
 */
enum class AlertType {
    // Security alerts
    MITM_DETECTED,
    CERTIFICATE_MISMATCH,
    DNS_HIJACKING,
    SSL_STRIPPING,
    SUSPICIOUS_CERTIFICATE,

    // Phishing alerts
    PHISHING_DETECTED,
    HOMOGRAPH_ATTACK,
    TYPOSQUATTING,

    // RPC alerts
    PUBLIC_RPC_DETECTED,
    RPC_FAILOVER,
    RPC_ALL_FAILED,

    // Proxy alerts
    PROXY_ERROR,
    PROXY_STARTED,
    PROXY_STOPPED
}

/**
 * Alert severity levels
 */
enum class Severity {
    INFO,
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

/**
 * Certificate information
 */
data class CertificateInfo(
    val hostname: String,
    val fingerprint: String,
    val issuer: String,
    val subject: String,
    val validFrom: Long,
    val validTo: Long,
    val isSelfSigned: Boolean
)

/**
 * Known RPC provider information
 */
data class RpcProviderInfo(
    val name: String,
    val chain: Chain,
    val tier: RpcTier,
    val hostPattern: String
)

/**
 * RPC provider tiers
 */
enum class RpcTier {
    PUBLIC,     // Free, shared, may be rate-limited
    PREMIUM,    // Paid, dedicated, reliable
    PRIVATE     // Self-hosted
}
