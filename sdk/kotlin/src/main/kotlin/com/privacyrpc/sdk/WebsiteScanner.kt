package com.privacyrpc.sdk

/**
 * Website Scanner for PrivacyRPC
 *
 * Scans websites for RPC usage, security issues, and privacy risks.
 * Matches the Scanner page in the Chrome extension.
 */
class WebsiteScanner(
    private val dAppDetector: DAppDetector = DAppDetector(),
    private val phishingDetector: PhishingDetector = PhishingDetector()
) {

    // ── Data Models ──────────────────────────────────────────

    data class ScanResult(
        val url: String,
        val hostname: String,
        val timestamp: Long = System.currentTimeMillis(),
        val isDApp: Boolean,
        val dAppName: String?,
        val category: DAppDetector.DAppCategory?,
        val rpcCalls: Int,
        val rpcEndpoints: List<String>,
        val usesPublicRpc: Boolean,
        val isPhishing: Boolean,
        val phishingReason: String?,
        val issues: List<SecurityIssue>,
        val rating: ScanRating
    )

    data class SecurityIssue(
        val severity: IssueSeverity,
        val title: String,
        val description: String
    )

    enum class IssueSeverity { INFO, WARNING, DANGER }

    enum class ScanRating { SAFE, CAUTION, DANGER, UNKNOWN }

    // ── Public RPC patterns ──────────────────────────────────

    companion object {
        private val PUBLIC_RPC_PATTERNS = listOf(
            "api.mainnet-beta.solana.com",
            "api.devnet.solana.com",
            "rpc.ankr.com"
        )
    }

    // ── Recent Scans ─────────────────────────────────────────

    private val recentScans = mutableListOf<ScanResult>()
    private val maxRecentScans = 10

    // ── Scanning ─────────────────────────────────────────────

    /**
     * Scan a website URL for security and privacy issues.
     *
     * @param url The URL to scan
     * @param knownRpcEndpoints Optional list of known RPC endpoints the site uses
     * @param rpcCallCount Optional count of observed RPC calls
     */
    fun scan(
        url: String,
        knownRpcEndpoints: List<String> = emptyList(),
        rpcCallCount: Int = 0
    ): ScanResult {
        val hostname = extractHostname(url)
        val issues = mutableListOf<SecurityIssue>()

        // Check if it's a known dApp
        val siteAnalysis = dAppDetector.analyzeSite(hostname)

        // Check for phishing
        val phishingResult = phishingDetector.checkDomain(hostname)

        // Check for public RPC usage
        val usesPublicRpc = knownRpcEndpoints.any { endpoint ->
            PUBLIC_RPC_PATTERNS.any { pattern -> endpoint.contains(pattern) }
        }

        // Build issues list
        if (phishingResult.isPhishing) {
            issues.add(SecurityIssue(
                IssueSeverity.DANGER,
                "Phishing Detected",
                "${phishingResult.reason ?: "Suspicious domain detected"}"
            ))
        }

        if (usesPublicRpc) {
            issues.add(SecurityIssue(
                IssueSeverity.WARNING,
                "Public RPC Endpoint",
                "Uses public Solana RPC - IP exposed to providers"
            ))
        }

        if (!siteAnalysis.isDApp && rpcCallCount > 0) {
            issues.add(SecurityIssue(
                IssueSeverity.WARNING,
                "Unknown dApp",
                "This site makes RPC calls but is not a recognized dApp - exercise caution"
            ))
        }

        if (rpcCallCount > 10) {
            issues.add(SecurityIssue(
                IssueSeverity.INFO,
                "High RPC Activity",
                "High RPC call frequency detected ($rpcCallCount calls)"
            ))
        }

        // Determine rating
        val rating = when {
            phishingResult.isPhishing -> ScanRating.DANGER
            issues.any { it.severity == IssueSeverity.DANGER } -> ScanRating.DANGER
            issues.any { it.severity == IssueSeverity.WARNING } -> ScanRating.CAUTION
            siteAnalysis.isDApp -> ScanRating.SAFE
            else -> ScanRating.UNKNOWN
        }

        val result = ScanResult(
            url = url,
            hostname = hostname,
            isDApp = siteAnalysis.isDApp,
            dAppName = siteAnalysis.dAppInfo?.name,
            category = siteAnalysis.category,
            rpcCalls = rpcCallCount,
            rpcEndpoints = knownRpcEndpoints,
            usesPublicRpc = usesPublicRpc,
            isPhishing = phishingResult.isPhishing,
            phishingReason = phishingResult.reason,
            issues = issues,
            rating = rating
        )

        // Store in recent scans
        recentScans.add(0, result)
        if (recentScans.size > maxRecentScans) {
            recentScans.removeAt(recentScans.lastIndex)
        }

        return result
    }

    /** Get recent scan results */
    fun getRecentScans(): List<ScanResult> = recentScans.toList()

    /** Clear recent scans */
    fun clearRecentScans() {
        recentScans.clear()
    }

    // ── Helpers ──────────────────────────────────────────────

    private fun extractHostname(url: String): String {
        var cleaned = url
        if (!cleaned.contains("://")) {
            cleaned = "https://$cleaned"
        }
        return try {
            java.net.URI(cleaned).host ?: url
        } catch (e: Exception) {
            url
        }
    }
}
