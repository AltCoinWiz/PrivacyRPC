import Foundation

/// Phishing Detector for PrivacyRPC
///
/// Local-only phishing detection with homograph attack detection,
/// typosquatting analysis, and known domain verification.
/// Matches the Chrome extension and TypeScript SDK phishing module.
public class PhishingDetector {

    // MARK: - Models

    public struct PhishingResult {
        public let domain: String
        public let isPhishing: Bool
        public let confidence: Confidence
        public let reason: String?
        public let legitimateDomain: String?
        public let alerts: [String]

        public enum Confidence: String {
            case confirmed = "CONFIRMED"
            case high = "HIGH"
            case medium = "MEDIUM"
            case low = "LOW"
            case unknown = "UNKNOWN"
        }
    }

    // MARK: - Known Legitimate Domains

    private static let legitimateDomains: Set<String> = [
        // Wallets
        "phantom.app", "solflare.com", "backpack.app", "glow.app",
        // DEXs
        "jup.ag", "jupiter.ag", "raydium.io", "orca.so", "lifinity.io",
        "meteora.ag", "phoenix.trade", "drift.trade", "zeta.markets", "pump.fun",
        // DeFi
        "marinade.finance", "solend.fi", "mango.markets", "kamino.finance",
        "marginfi.com", "solblaze.org", "jito.network",
        // NFT
        "magiceden.io", "tensor.trade", "hyperspace.xyz", "exchange.art",
        "formfunction.xyz", "solanart.io", "opensea.io",
        // Explorers
        "solana.com", "solscan.io", "solanabeach.io", "solana.fm",
        // Infrastructure
        "helius.dev", "shyft.to", "quicknode.com", "alchemy.com",
        // Other
        "squads.so", "realms.today", "dialect.to"
    ]

    /// Known phishing domains
    private static let knownPhishing: Set<String> = [
        "phantom-wallet.app", "phantomm.app", "solanaa.com",
        "jupiterr.ag", "magiceden.xyz", "pump.fun-watch.dev"
    ]

    /// Homograph character mappings (Unicode lookalikes)
    private static let homoglyphs: [Character: [Character]] = [
        "a": ["а", "ɑ", "α"],  // Cyrillic a, Latin alpha, Greek alpha
        "e": ["е", "ε", "ё"],  // Cyrillic ie, Greek epsilon
        "o": ["о", "ο", "0"],  // Cyrillic o, Greek omicron, zero
        "p": ["р", "ρ"],       // Cyrillic er, Greek rho
        "c": ["с", "ϲ"],       // Cyrillic es, Greek lunate sigma
        "x": ["х", "χ"],       // Cyrillic ha, Greek chi
        "s": ["ѕ"],            // Cyrillic dze
        "i": ["і", "ι", "1"],  // Cyrillic i, Greek iota, one
        "n": ["п"],            // Cyrillic en
        "t": ["т"],            // Cyrillic te
        "y": ["у"],            // Cyrillic u
    ]

    public init() {}

    // MARK: - Public API

    /// Check a domain for phishing indicators
    public func check(_ domain: String) -> PhishingResult {
        let normalized = domain.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        var alerts: [String] = []

        // 1. Known phishing domain
        if Self.knownPhishing.contains(normalized) {
            return PhishingResult(
                domain: normalized,
                isPhishing: true,
                confidence: .confirmed,
                reason: "Known phishing domain",
                legitimateDomain: nil,
                alerts: ["This domain is on the known phishing list"]
            )
        }

        // 2. Known legitimate domain
        if Self.legitimateDomains.contains(normalized) {
            return PhishingResult(
                domain: normalized,
                isPhishing: false,
                confidence: .confirmed,
                reason: nil,
                legitimateDomain: normalized,
                alerts: []
            )
        }

        // 3. Homograph detection
        if let homographResult = detectHomograph(normalized) {
            return homographResult
        }

        // 4. Typosquatting detection
        if let typoResult = detectTyposquatting(normalized) {
            return typoResult
        }

        // 5. Suspicious pattern detection
        let patternAlerts = detectSuspiciousPatterns(normalized)
        alerts.append(contentsOf: patternAlerts)

        if !alerts.isEmpty {
            return PhishingResult(
                domain: normalized,
                isPhishing: false,
                confidence: .low,
                reason: "Some suspicious patterns detected",
                legitimateDomain: nil,
                alerts: alerts
            )
        }

        // Unknown domain
        return PhishingResult(
            domain: normalized,
            isPhishing: false,
            confidence: .unknown,
            reason: nil,
            legitimateDomain: nil,
            alerts: []
        )
    }

    // MARK: - Detection Methods

    private func detectHomograph(_ domain: String) -> PhishingResult? {
        // Check if domain contains non-ASCII characters
        let hasNonAscii = domain.unicodeScalars.contains { !$0.isASCII }
        guard hasNonAscii else { return nil }

        // Try to normalize to ASCII and check against known domains
        let asciiVersion = normalizeToAscii(domain)

        for legit in Self.legitimateDomains {
            if asciiVersion == legit || levenshteinDistance(asciiVersion, legit) <= 1 {
                return PhishingResult(
                    domain: domain,
                    isPhishing: true,
                    confidence: .high,
                    reason: "Homograph attack detected - uses lookalike characters to impersonate \(legit)",
                    legitimateDomain: legit,
                    alerts: ["Domain contains non-ASCII lookalike characters"]
                )
            }
        }

        return PhishingResult(
            domain: domain,
            isPhishing: false,
            confidence: .medium,
            reason: "Contains non-ASCII characters",
            legitimateDomain: nil,
            alerts: ["Domain contains unusual Unicode characters"]
        )
    }

    private func detectTyposquatting(_ domain: String) -> PhishingResult? {
        let domainBase = domain.components(separatedBy: ".").first ?? domain

        for legit in Self.legitimateDomains {
            let legitBase = legit.components(separatedBy: ".").first ?? legit

            let distance = levenshteinDistance(domainBase, legitBase)

            // Very similar to a legitimate domain (1-2 character difference)
            if distance == 1 {
                return PhishingResult(
                    domain: domain,
                    isPhishing: true,
                    confidence: .high,
                    reason: "Possible typosquatting of \(legit) (edit distance: \(distance))",
                    legitimateDomain: legit,
                    alerts: ["Very similar to known legitimate domain: \(legit)"]
                )
            } else if distance == 2 && domainBase.count > 4 {
                return PhishingResult(
                    domain: domain,
                    isPhishing: false,
                    confidence: .medium,
                    reason: "Somewhat similar to \(legit)",
                    legitimateDomain: legit,
                    alerts: ["Resembles legitimate domain: \(legit)"]
                )
            }
        }

        return nil
    }

    private func detectSuspiciousPatterns(_ domain: String) -> [String] {
        var alerts: [String] = []

        // Check for wallet/crypto keywords combined with suspicious TLDs
        let suspiciousKeywords = ["wallet", "phantom", "solana", "crypto", "airdrop", "claim", "free"]
        let suspiciousTLDs = [".xyz", ".site", ".online", ".top", ".buzz", ".click"]

        let hasKeyword = suspiciousKeywords.contains { domain.contains($0) }
        let hasSuspiciousTLD = suspiciousTLDs.contains { domain.hasSuffix($0) }

        if hasKeyword && hasSuspiciousTLD {
            alerts.append("Crypto keyword with suspicious TLD")
        }

        // Check for hyphenated versions of known domains
        for legit in Self.legitimateDomains {
            let legitBase = legit.components(separatedBy: ".").first ?? legit
            if domain.contains("\(legitBase)-") || domain.contains("-\(legitBase)") {
                alerts.append("Contains hyphenated version of known domain: \(legit)")
            }
        }

        return alerts
    }

    // MARK: - Helpers

    private func normalizeToAscii(_ text: String) -> String {
        var result = ""
        for char in text {
            var replaced = false
            for (ascii, lookalikes) in Self.homoglyphs {
                if lookalikes.contains(char) {
                    result.append(ascii)
                    replaced = true
                    break
                }
            }
            if !replaced {
                result.append(char)
            }
        }
        return result
    }

    private func levenshteinDistance(_ s1: String, _ s2: String) -> Int {
        let a = Array(s1)
        let b = Array(s2)
        let m = a.count
        let n = b.count

        if m == 0 { return n }
        if n == 0 { return m }

        var matrix = Array(repeating: Array(repeating: 0, count: n + 1), count: m + 1)

        for i in 0...m { matrix[i][0] = i }
        for j in 0...n { matrix[0][j] = j }

        for i in 1...m {
            for j in 1...n {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                matrix[i][j] = min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + cost
                )
            }
        }

        return matrix[m][n]
    }
}
