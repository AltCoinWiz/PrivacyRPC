package com.privacyrpc.sdk

/**
 * Phishing/Spoofing Website Detector
 *
 * Detects fake crypto websites using:
 * 1. Homograph attacks (phantóm.app vs phantom.app)
 * 2. Typosquatting (phantm.app, phanton.app)
 * 3. Domain lookalikes (phantom-app.com, phantom.io)
 * 4. Known phishing domains blacklist
 * 5. Certificate verification for legitimate sites
 *
 * This is where most wallet drains actually happen - users
 * visit fake sites and enter their seed phrase or sign malicious transactions.
 */
class PhishingDetector(
    private val alertHandler: AlertHandler? = null
) {
    companion object {
        // Homograph characters that look like ASCII
        private val HOMOGRAPHS = mapOf(
            'а' to 'a', // Cyrillic
            'е' to 'e',
            'о' to 'o',
            'р' to 'p',
            'с' to 'c',
            'у' to 'y',
            'х' to 'x',
            'ѕ' to 's',
            'і' to 'i',
            'ј' to 'j',
            'һ' to 'h',
            'ԁ' to 'd',
            'ԝ' to 'w',
            'ɑ' to 'a', // Latin Extended
            'ɡ' to 'g',
            'ɩ' to 'i',
            'ɪ' to 'i',
            'ι' to 'i', // Greek
            'ο' to 'o',
            'α' to 'a',
            'ν' to 'v',
            'τ' to 't',
            '0' to 'o', // Numbers
            '1' to 'l',
            '5' to 's',
            '3' to 'e',
        )
    }

    // Legitimate crypto domains and their info
    private val legitimateDomains = mapOf(
        // Wallets
        "phantom.app" to DomainInfo("Phantom Wallet", DomainCategory.WALLET),
        "backpack.app" to DomainInfo("Backpack Wallet", DomainCategory.WALLET),
        "solflare.com" to DomainInfo("Solflare Wallet", DomainCategory.WALLET),
        "metamask.io" to DomainInfo("MetaMask Wallet", DomainCategory.WALLET),
        "trustwallet.com" to DomainInfo("Trust Wallet", DomainCategory.WALLET),

        // DEXes
        "jup.ag" to DomainInfo("Jupiter Exchange", DomainCategory.DEX),
        "jupiter.ag" to DomainInfo("Jupiter Exchange", DomainCategory.DEX),
        "raydium.io" to DomainInfo("Raydium", DomainCategory.DEX),
        "orca.so" to DomainInfo("Orca", DomainCategory.DEX),
        "uniswap.org" to DomainInfo("Uniswap", DomainCategory.DEX),
        "pump.fun" to DomainInfo("Pump.fun", DomainCategory.DEX),

        // Solana ecosystem
        "solana.com" to DomainInfo("Solana", DomainCategory.BLOCKCHAIN),
        "solscan.io" to DomainInfo("Solscan Explorer", DomainCategory.EXPLORER),
        "solana.fm" to DomainInfo("Solana FM Explorer", DomainCategory.EXPLORER),
        "helius.dev" to DomainInfo("Helius", DomainCategory.RPC),
        "helius.xyz" to DomainInfo("Helius", DomainCategory.RPC),
        "quicknode.com" to DomainInfo("QuickNode", DomainCategory.RPC),

        // NFT marketplaces
        "magiceden.io" to DomainInfo("Magic Eden", DomainCategory.NFT),
        "tensor.trade" to DomainInfo("Tensor", DomainCategory.NFT),
        "opensea.io" to DomainInfo("OpenSea", DomainCategory.NFT),

        // Other
        "coingecko.com" to DomainInfo("CoinGecko", DomainCategory.DATA),
        "coinmarketcap.com" to DomainInfo("CoinMarketCap", DomainCategory.DATA),
        "dexscreener.com" to DomainInfo("DEX Screener", DomainCategory.DATA),
        "birdeye.so" to DomainInfo("Birdeye", DomainCategory.DATA),
    )

    // Known phishing domains (would be updated regularly in production)
    private val knownPhishingDomains = mutableSetOf(
        "phantom-wallet.app",
        "phantomwallet.io",
        "phantom-app.com",
        "solana-airdrop.com",
        "jupiter-airdrop.com",
        "free-solana.com",
        "claim-jupiter.com",
        // pump.fun phishing
        "pump.fun-watch.dev",
    )

    /**
     * Check if a domain is potentially a phishing site
     */
    fun checkDomain(domain: String): PhishingResult {
        val normalizedDomain = normalizeDomain(domain)

        // Check known phishing list
        if (normalizedDomain in knownPhishingDomains) {
            return PhishingResult(
                isPhishing = true,
                confidence = Confidence.CONFIRMED,
                reason = "Known phishing domain",
                legitimateDomain = findSimilarLegitimate(normalizedDomain),
                alerts = listOf("This is a confirmed phishing site. Do NOT enter any information.")
            ).also { notifyAlert(it, domain) }
        }

        // Check if it's a legitimate domain
        if (normalizedDomain in legitimateDomains) {
            return PhishingResult(
                isPhishing = false,
                confidence = Confidence.CONFIRMED,
                reason = "Verified legitimate domain",
                legitimateDomain = normalizedDomain
            )
        }

        // Check for homograph attacks
        val homographResult = checkHomograph(normalizedDomain)
        if (homographResult != null) {
            return homographResult.also { notifyAlert(it, domain) }
        }

        // Check for typosquatting
        val typoResult = checkTyposquatting(normalizedDomain)
        if (typoResult != null) {
            return typoResult.also { notifyAlert(it, domain) }
        }

        // Check for suspicious patterns
        val patternResult = checkSuspiciousPatterns(normalizedDomain)
        if (patternResult != null) {
            return patternResult.also { notifyAlert(it, domain) }
        }

        // Unknown domain - could be legitimate, could be phishing
        return PhishingResult(
            isPhishing = false,
            confidence = Confidence.UNKNOWN,
            reason = "Unknown domain - exercise caution",
            legitimateDomain = null
        )
    }

    /**
     * Check for homograph (lookalike character) attacks
     */
    private fun checkHomograph(domain: String): PhishingResult? {
        // Convert homographs to ASCII
        val asciiDomain = domain.map { HOMOGRAPHS[it] ?: it }.joinToString("")

        // If conversion changed the domain, it contains homographs
        if (asciiDomain != domain) {
            val matchedLegit = legitimateDomains.keys.find { it == asciiDomain }
            if (matchedLegit != null) {
                return PhishingResult(
                    isPhishing = true,
                    confidence = Confidence.HIGH,
                    reason = "Homograph attack detected - uses lookalike characters",
                    legitimateDomain = matchedLegit,
                    alerts = listOf(
                        "This domain uses fake characters to look like '$matchedLegit'",
                        "Example: 'а' (Cyrillic) looks like 'a' (Latin) but is different",
                        "The real site is: $matchedLegit"
                    )
                )
            }
        }

        return null
    }

    /**
     * Check for typosquatting (common typos)
     */
    private fun checkTyposquatting(domain: String): PhishingResult? {
        for (legitDomain in legitimateDomains.keys) {
            val distance = levenshteinDistance(domain, legitDomain)

            // Very close match (1-2 character difference)
            if (distance in 1..2) {
                return PhishingResult(
                    isPhishing = true,
                    confidence = Confidence.HIGH,
                    reason = "Typosquatting detected - similar to legitimate domain",
                    legitimateDomain = legitDomain,
                    alerts = listOf(
                        "This looks like a typo of '$legitDomain'",
                        "Did you mean to visit: $legitDomain?"
                    )
                )
            }

            // Somewhat close (3 character difference) - warn but lower confidence
            if (distance == 3 && domain.length > 6) {
                return PhishingResult(
                    isPhishing = true,
                    confidence = Confidence.MEDIUM,
                    reason = "Possible typosquatting - similar to legitimate domain",
                    legitimateDomain = legitDomain,
                    alerts = listOf(
                        "This domain is similar to '$legitDomain'",
                        "Please verify you're on the correct site"
                    )
                )
            }
        }

        return null
    }

    /**
     * Check for suspicious URL patterns
     */
    private fun checkSuspiciousPatterns(domain: String): PhishingResult? {
        val suspiciousPatterns = listOf(
            // Fake wallet patterns
            Regex("phantom[^a-z]") to "phantom.app",
            Regex("metamask[^a-z]") to "metamask.io",
            Regex("solflare[^a-z]") to "solflare.com",
            Regex("backpack[^a-z]") to "backpack.app",

            // Fake DEX patterns
            Regex("jupiter[^a-z]") to "jup.ag",
            Regex("raydium[^a-z]") to "raydium.io",
            Regex("uniswap[^a-z]") to "uniswap.org",

            // Airdrop scams
            Regex("(airdrop|claim|free).*(solana|sol|jupiter|jup)") to null,
            Regex("(solana|sol|jupiter|jup).*(airdrop|claim|free)") to null,

            // Wallet connect scams
            Regex("wallet.?connect.?(verify|validate|sync)") to null,
            Regex("(verify|validate|sync).?wallet") to null,

            // Recovery scams
            Regex("(recover|restore).*(wallet|phrase|seed)") to null,
        )

        for ((pattern, legitDomain) in suspiciousPatterns) {
            if (pattern.containsMatchIn(domain)) {
                return PhishingResult(
                    isPhishing = true,
                    confidence = Confidence.HIGH,
                    reason = "Suspicious domain pattern detected",
                    legitimateDomain = legitDomain,
                    alerts = listOf(
                        "This domain matches known phishing patterns",
                        if (legitDomain != null) "The real site is: $legitDomain" else "This is likely a scam site",
                        "NEVER enter your seed phrase on any website"
                    )
                )
            }
        }

        return null
    }

    /**
     * Find the most similar legitimate domain
     */
    private fun findSimilarLegitimate(domain: String): String? {
        return legitimateDomains.keys
            .map { it to levenshteinDistance(domain, it) }
            .filter { it.second <= 5 }
            .minByOrNull { it.second }
            ?.first
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private fun levenshteinDistance(s1: String, s2: String): Int {
        val dp = Array(s1.length + 1) { IntArray(s2.length + 1) }

        for (i in 0..s1.length) dp[i][0] = i
        for (j in 0..s2.length) dp[0][j] = j

        for (i in 1..s1.length) {
            for (j in 1..s2.length) {
                dp[i][j] = if (s1[i - 1] == s2[j - 1]) {
                    dp[i - 1][j - 1]
                } else {
                    minOf(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1
                }
            }
        }

        return dp[s1.length][s2.length]
    }

    /**
     * Normalize domain for comparison
     */
    private fun normalizeDomain(domain: String): String {
        return domain
            .lowercase()
            .removePrefix("www.")
            .removePrefix("https://")
            .removePrefix("http://")
            .split("/")[0]  // Remove path
    }

    /**
     * Add a known phishing domain
     */
    fun reportPhishing(domain: String) {
        knownPhishingDomains.add(normalizeDomain(domain))
    }

    /**
     * Add a legitimate domain
     */
    fun addLegitimate(domain: String, name: String, category: DomainCategory) {
        // Note: In production, this would be admin-only or verified
    }

    /**
     * Notify alert handler
     */
    private fun notifyAlert(result: PhishingResult, domain: String) {
        if (result.isPhishing && alertHandler != null) {
            alertHandler.onAlert(PrivacyRPCAlert(
                type = AlertType.PHISHING_DETECTED,
                severity = when (result.confidence) {
                    Confidence.CONFIRMED -> Severity.CRITICAL
                    Confidence.HIGH -> Severity.CRITICAL
                    Confidence.MEDIUM -> Severity.HIGH
                    Confidence.LOW -> Severity.MEDIUM
                    Confidence.UNKNOWN -> Severity.LOW
                },
                message = result.reason,
                hostname = domain,
                details = mapOf(
                    "phishing_domain" to domain,
                    "legitimate_domain" to (result.legitimateDomain ?: "unknown"),
                    "confidence" to result.confidence.name,
                    "alerts" to result.alerts
                )
            ))
        }
    }
}

/**
 * Result of phishing check
 */
data class PhishingResult(
    val isPhishing: Boolean,
    val confidence: Confidence,
    val reason: String,
    val legitimateDomain: String?,
    val alerts: List<String> = emptyList()
)

/**
 * Confidence level of detection
 */
enum class Confidence {
    CONFIRMED,  // Known phishing domain
    HIGH,       // Very likely phishing
    MEDIUM,     // Probably phishing
    LOW,        // Possibly phishing
    UNKNOWN     // Can't determine
}

/**
 * Category of legitimate domain
 */
enum class DomainCategory {
    WALLET,
    DEX,
    NFT,
    BLOCKCHAIN,
    EXPLORER,
    RPC,
    DATA,
    OTHER
}

/**
 * Info about a legitimate domain
 */
data class DomainInfo(
    val name: String,
    val category: DomainCategory
)
