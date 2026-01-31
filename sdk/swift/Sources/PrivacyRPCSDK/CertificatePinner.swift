import Foundation
#if canImport(Security)
import Security
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif

/// Certificate Pinner / MITM Detector for PrivacyRPC
///
/// Trust-On-First-Use (TOFU) certificate pinning with
/// MITM attack detection, matching the Chrome extension
/// and Kotlin SDK CertificatePinner.
public class CertificatePinner {

    // MARK: - Models

    public struct CertificateInfo {
        public let hostname: String
        public let fingerprint: String
        public let issuer: String
        public let subject: String
        public let validFrom: Date
        public let validTo: Date
        public let pinnedAt: Date
    }

    public struct MitmCheckResult {
        public let hostname: String
        public let isSafe: Bool
        public let threats: [Threat]
        public let certificateInfo: CertificateInfo?
        public let timestamp: Date

        public struct Threat {
            public let type: ThreatType
            public let message: String
            public let details: [String: String]
        }

        public enum ThreatType: String {
            case certificateMismatch = "CERTIFICATE_MISMATCH"
            case dnsHijacking = "DNS_HIJACKING"
            case sslStripping = "SSL_STRIPPING"
            case suspiciousCertificate = "SUSPICIOUS_CERTIFICATE"
            case selfSigned = "SELF_SIGNED"
            case expired = "EXPIRED"
        }
    }

    // MARK: - State

    private var pinnedCertificates: [String: CertificateInfo] = [:]
    private var alertHandler: ((Alert) -> Void)?

    public init(alertHandler: ((Alert) -> Void)? = nil) {
        self.alertHandler = alertHandler
    }

    // MARK: - Public API

    /// Pin a certificate for a hostname (TOFU)
    public func pin(hostname: String, fingerprint: String, issuer: String = "", subject: String = "") {
        let info = CertificateInfo(
            hostname: hostname,
            fingerprint: fingerprint,
            issuer: issuer,
            subject: subject,
            validFrom: Date(),
            validTo: Date().addingTimeInterval(365 * 24 * 60 * 60),
            pinnedAt: Date()
        )
        pinnedCertificates[hostname] = info
    }

    /// Check if a hostname's certificate matches the pinned one
    public func verify(hostname: String, fingerprint: String) -> Bool {
        guard let pinned = pinnedCertificates[hostname] else {
            // First use - pin it (TOFU)
            pin(hostname: hostname, fingerprint: fingerprint)
            return true
        }

        if pinned.fingerprint != fingerprint {
            alertHandler?(Alert(
                type: .certificateMismatch,
                severity: .critical,
                message: "Certificate mismatch for \(hostname) - possible MITM attack",
                hostname: hostname,
                details: [
                    "expected": pinned.fingerprint,
                    "received": fingerprint
                ]
            ))
            return false
        }

        return true
    }

    /// Check a hostname for MITM attacks
    public func check(hostname: String) async -> MitmCheckResult {
        var threats: [MitmCheckResult.Threat] = []

        // Perform TLS connection check
        let certInfo = await fetchCertificateInfo(hostname: hostname)

        if let info = certInfo {
            // Check expiry
            if info.validTo < Date() {
                threats.append(.init(
                    type: .expired,
                    message: "Certificate for \(hostname) has expired",
                    details: ["expired": info.validTo.description]
                ))
            }

            // Check against pinned certificate
            if let pinned = pinnedCertificates[hostname] {
                if pinned.fingerprint != info.fingerprint {
                    threats.append(.init(
                        type: .certificateMismatch,
                        message: "Certificate fingerprint changed for \(hostname)",
                        details: [
                            "expected": pinned.fingerprint,
                            "actual": info.fingerprint
                        ]
                    ))
                }
            } else {
                // TOFU - pin it
                pinnedCertificates[hostname] = info
            }

            // Check for suspicious issuers
            let suspiciousIssuers = ["mitmproxy", "charles", "fiddler", "burp"]
            let issuerLower = info.issuer.lowercased()
            if suspiciousIssuers.contains(where: { issuerLower.contains($0) }) {
                threats.append(.init(
                    type: .suspiciousCertificate,
                    message: "Suspicious certificate issuer detected: \(info.issuer)",
                    details: ["issuer": info.issuer]
                ))
            }
        } else {
            threats.append(.init(
                type: .sslStripping,
                message: "Could not establish TLS connection to \(hostname)",
                details: [:]
            ))
        }

        // Send alerts for threats
        for threat in threats {
            alertHandler?(Alert(
                type: .mitmDetected,
                severity: threat.type == .certificateMismatch ? .critical : .high,
                message: threat.message,
                hostname: hostname
            ))
        }

        return MitmCheckResult(
            hostname: hostname,
            isSafe: threats.isEmpty,
            threats: threats,
            certificateInfo: certInfo,
            timestamp: Date()
        )
    }

    /// Get all pinned certificates
    public func getPinnedCertificates() -> [String: CertificateInfo] {
        return pinnedCertificates
    }

    /// Remove a pinned certificate
    public func unpin(hostname: String) {
        pinnedCertificates.removeValue(forKey: hostname)
    }

    // MARK: - Private

    private func fetchCertificateInfo(hostname: String) async -> CertificateInfo? {
        return await withCheckedContinuation { continuation in
            let url = URL(string: "https://\(hostname)")!
            let session = URLSession(configuration: .ephemeral, delegate: CertDelegate { info in
                continuation.resume(returning: info)
            }, delegateQueue: nil)

            let task = session.dataTask(with: url) { _, _, _ in }
            task.resume()

            // Timeout after 10 seconds
            DispatchQueue.global().asyncAfter(deadline: .now() + 10) {
                task.cancel()
            }
        }
    }
}

// MARK: - Certificate Delegate

private class CertDelegate: NSObject, URLSessionDelegate {
    private let completion: (CertificatePinner.CertificateInfo?) -> Void
    private var completed = false

    init(completion: @escaping (CertificatePinner.CertificateInfo?) -> Void) {
        self.completion = completion
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard !completed else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }
        completed = true

        guard let trust = challenge.protectionSpace.serverTrust else {
            completion(nil)
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        #if canImport(Security)
        let hostname = challenge.protectionSpace.host

        if let certChain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
           let cert = certChain.first {
            let data = SecCertificateCopyData(cert) as Data
            let fingerprint = data.sha256Hex

            let summary = SecCertificateCopySubjectSummary(cert) as String? ?? ""

            let info = CertificatePinner.CertificateInfo(
                hostname: hostname,
                fingerprint: fingerprint,
                issuer: summary,
                subject: summary,
                validFrom: Date(),
                validTo: Date().addingTimeInterval(365 * 24 * 60 * 60),
                pinnedAt: Date()
            )

            completion(info)
        } else {
            completion(nil)
        }
        #else
        completion(nil)
        #endif

        completionHandler(.cancelAuthenticationChallenge, nil)
    }
}

// MARK: - Data SHA256 Extension

private extension Data {
    var sha256Hex: String {
        #if canImport(CryptoKit)
        let hash = SHA256.hash(data: self)
        return hash.map { String(format: "%02x", $0) }.joined()
        #else
        // Fallback: simple hash representation
        var hash = 0
        for byte in self {
            hash = hash &* 31 &+ Int(byte)
        }
        return String(format: "%016lx", abs(hash))
        #endif
    }
}
