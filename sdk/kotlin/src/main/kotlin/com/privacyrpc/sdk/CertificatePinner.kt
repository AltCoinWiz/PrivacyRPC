package com.privacyrpc.sdk

import java.net.URL
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/**
 * Certificate Pinner
 *
 * Pins TLS certificates for RPC endpoints on first use (TOFU)
 * and alerts if certificates change unexpectedly.
 */
class CertificatePinner(
    private val endpointsToPin: List<String>
) {
    private val pinnedCertificates = ConcurrentHashMap<String, CertificateInfo>()
    private var alertHandler: ((PrivacyRPCAlert) -> Unit)? = null

    fun setAlertHandler(handler: (PrivacyRPCAlert) -> Unit) {
        alertHandler = handler
    }

    /**
     * Pin all configured endpoints
     */
    fun pinAll() {
        for (endpoint in endpointsToPin) {
            try {
                pinEndpoint(endpoint)
            } catch (e: Exception) {
                // Log but don't fail - endpoint might be temporarily unavailable
            }
        }
    }

    /**
     * Pin a single endpoint
     */
    fun pinEndpoint(hostname: String): CertificateInfo? {
        val certInfo = fetchCertificate(hostname)
        if (certInfo != null) {
            pinnedCertificates[hostname] = certInfo
        }
        return certInfo
    }

    /**
     * Verify a certificate against pinned value
     */
    fun verify(hostname: String): VerificationResult {
        val pinned = pinnedCertificates[hostname]
            ?: return VerificationResult.NOT_PINNED

        val current = try {
            fetchCertificate(hostname)
        } catch (e: Exception) {
            return VerificationResult.FETCH_FAILED
        }

        if (current == null) {
            return VerificationResult.FETCH_FAILED
        }

        if (current.fingerprint != pinned.fingerprint) {
            alertHandler?.invoke(PrivacyRPCAlert(
                type = AlertType.CERTIFICATE_MISMATCH,
                severity = Severity.CRITICAL,
                message = "Certificate for $hostname has changed! Possible MITM attack.",
                hostname = hostname,
                details = mapOf(
                    "expected_fingerprint" to pinned.fingerprint,
                    "actual_fingerprint" to current.fingerprint,
                    "expected_issuer" to pinned.issuer,
                    "actual_issuer" to current.issuer
                )
            ))
            return VerificationResult.MISMATCH
        }

        return VerificationResult.VALID
    }

    /**
     * Get pinned certificate info
     */
    fun getPinned(hostname: String): CertificateInfo? = pinnedCertificates[hostname]

    /**
     * Get all pinned hostnames
     */
    fun getAllPinned(): Set<String> = pinnedCertificates.keys.toSet()

    /**
     * Remove a pin
     */
    fun unpin(hostname: String) {
        pinnedCertificates.remove(hostname)
    }

    /**
     * Fetch certificate from an endpoint
     */
    private fun fetchCertificate(hostname: String): CertificateInfo? {
        val trustManager = CapturingTrustManager()

        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, arrayOf(trustManager), null)

        val url = URL("https://$hostname")
        val connection = url.openConnection() as HttpsURLConnection
        connection.sslSocketFactory = sslContext.socketFactory
        connection.connectTimeout = 10000
        connection.readTimeout = 5000

        try {
            connection.connect()
            connection.disconnect()
        } catch (e: Exception) {
            // Connection might fail but we still got the cert
        }

        val cert = trustManager.serverCert ?: return null

        return CertificateInfo(
            hostname = hostname,
            fingerprint = cert.encoded.sha256Hex(),
            issuer = cert.issuerDN.name,
            subject = cert.subjectDN.name,
            validFrom = cert.notBefore.time,
            validTo = cert.notAfter.time,
            isSelfSigned = cert.issuerDN == cert.subjectDN
        )
    }

    private fun ByteArray.sha256Hex(): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(this).joinToString("") { "%02x".format(it) }
    }

    private class CapturingTrustManager : X509TrustManager {
        var serverCert: X509Certificate? = null

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}

        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            serverCert = chain?.firstOrNull()
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
}

/**
 * Certificate verification result
 */
enum class VerificationResult {
    VALID,          // Certificate matches pinned value
    MISMATCH,       // Certificate doesn't match - possible MITM!
    NOT_PINNED,     // No pin exists for this host
    FETCH_FAILED    // Couldn't fetch certificate to compare
}
