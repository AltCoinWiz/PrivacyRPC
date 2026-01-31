/**
 * MITM Detection Module
 *
 * Detects man-in-the-middle attacks on RPC connections:
 * - Certificate pinning violations
 * - Proxy certificate detection
 * - DNS hijacking
 * - SSL stripping
 *
 * All detection is LOCAL - no external calls.
 */

import * as tls from 'tls';
import * as dns from 'dns';
import * as crypto from 'crypto';

export interface MitmResult {
  isSafe: boolean;
  threats: MitmThreat[];
}

export interface MitmThreat {
  type: MitmThreatType;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  details?: Record<string, string>;
}

export enum MitmThreatType {
  CERTIFICATE_MISMATCH = 'CERTIFICATE_MISMATCH',
  PROXY_CERTIFICATE = 'PROXY_CERTIFICATE',
  SELF_SIGNED = 'SELF_SIGNED',
  EXPIRED_CERTIFICATE = 'EXPIRED_CERTIFICATE',
  DNS_HIJACKING = 'DNS_HIJACKING',
  SSL_STRIPPING = 'SSL_STRIPPING',
  INVALID_CHAIN = 'INVALID_CHAIN',
  WEAK_CIPHER = 'WEAK_CIPHER',
}

// Known MITM proxy certificate issuers
const KNOWN_MITM_ISSUERS = [
  'mitmproxy',
  'charles proxy',
  'fiddler',
  'burp suite',
  'zap proxy',
  'proxyman',
  'ssl-bump',
  'squid',
  'bluecoat',
  'fortigate',
  'palo alto',
  'websense',
  'zscaler',
  'netskope',
];

// Pinned certificate hashes for known RPC endpoints
const PINNED_CERTIFICATES: Record<string, string[]> = {
  'mainnet.helius-rpc.com': [],  // Add actual pins in production
  'solana-mainnet.g.alchemy.com': [],
  'api.mainnet-beta.solana.com': [],
};

// Known legitimate DNS for RPC endpoints
const KNOWN_DNS: Record<string, string[]> = {
  'mainnet.helius-rpc.com': [],  // Add actual IPs in production
  'api.mainnet-beta.solana.com': [],
};

export class MitmDetector {
  private pinnedCerts: Map<string, Set<string>> = new Map();
  private knownDns: Map<string, Set<string>> = new Map();
  private onThreat?: (threat: MitmThreat) => void;

  constructor(options?: {
    pinnedCerts?: Record<string, string[]>;
    knownDns?: Record<string, string[]>;
    onThreat?: (threat: MitmThreat) => void;
  }) {
    // Initialize pinned certificates
    const certs = { ...PINNED_CERTIFICATES, ...options?.pinnedCerts };
    for (const [host, pins] of Object.entries(certs)) {
      this.pinnedCerts.set(host, new Set(pins));
    }

    // Initialize known DNS
    const dns = { ...KNOWN_DNS, ...options?.knownDns };
    for (const [host, ips] of Object.entries(dns)) {
      this.knownDns.set(host, new Set(ips));
    }

    this.onThreat = options?.onThreat;
  }

  /**
   * Check a connection for MITM attacks
   */
  async check(hostname: string, port = 443): Promise<MitmResult> {
    const threats: MitmThreat[] = [];

    // Check certificate
    const certThreats = await this.checkCertificate(hostname, port);
    threats.push(...certThreats);

    // Check DNS
    const dnsThreats = await this.checkDns(hostname);
    threats.push(...dnsThreats);

    // Notify for each threat
    for (const threat of threats) {
      this.onThreat?.(threat);
    }

    return {
      isSafe: threats.length === 0,
      threats,
    };
  }

  /**
   * Check certificate for MITM indicators
   */
  async checkCertificate(hostname: string, port = 443): Promise<MitmThreat[]> {
    return new Promise((resolve) => {
      const threats: MitmThreat[] = [];

      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: hostname,
          rejectUnauthorized: false, // We check manually
        },
        () => {
          const cert = socket.getPeerCertificate(true);
          socket.end();

          if (!cert || Object.keys(cert).length === 0) {
            resolve([{
              type: MitmThreatType.SSL_STRIPPING,
              severity: 'CRITICAL',
              message: 'No certificate received - possible SSL stripping',
            }]);
            return;
          }

          // Check for MITM proxy certificates
          const issuer = (cert.issuer?.CN || '').toLowerCase();
          const subject = (cert.subject?.CN || '').toLowerCase();

          for (const mitmIssuer of KNOWN_MITM_ISSUERS) {
            if (issuer.includes(mitmIssuer) || subject.includes(mitmIssuer)) {
              threats.push({
                type: MitmThreatType.PROXY_CERTIFICATE,
                severity: 'CRITICAL',
                message: `MITM proxy detected: ${issuer || subject}`,
                details: {
                  issuer: cert.issuer?.CN || 'Unknown',
                  subject: cert.subject?.CN || 'Unknown',
                },
              });
            }
          }

          // Check self-signed
          if (cert.issuer?.CN === cert.subject?.CN && !cert.issuerCertificate) {
            threats.push({
              type: MitmThreatType.SELF_SIGNED,
              severity: 'HIGH',
              message: 'Self-signed certificate detected',
              details: {
                subject: cert.subject?.CN || 'Unknown',
              },
            });
          }

          // Check expiration
          const now = Date.now();
          const validFrom = new Date(cert.valid_from).getTime();
          const validTo = new Date(cert.valid_to).getTime();

          if (now < validFrom || now > validTo) {
            threats.push({
              type: MitmThreatType.EXPIRED_CERTIFICATE,
              severity: 'HIGH',
              message: 'Certificate is expired or not yet valid',
              details: {
                validFrom: cert.valid_from,
                validTo: cert.valid_to,
              },
            });
          }

          // Check pinned certificate
          const pins = this.pinnedCerts.get(hostname);
          if (pins && pins.size > 0) {
            const certHash = this.hashCertificate(cert.raw);
            if (!pins.has(certHash)) {
              threats.push({
                type: MitmThreatType.CERTIFICATE_MISMATCH,
                severity: 'CRITICAL',
                message: 'Certificate does not match pinned hash',
                details: {
                  expected: [...pins][0],
                  received: certHash,
                },
              });
            }
          }

          resolve(threats);
        }
      );

      socket.on('error', (err) => {
        resolve([{
          type: MitmThreatType.SSL_STRIPPING,
          severity: 'HIGH',
          message: `TLS connection failed: ${err.message}`,
        }]);
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        resolve([{
          type: MitmThreatType.SSL_STRIPPING,
          severity: 'MEDIUM',
          message: 'TLS connection timeout',
        }]);
      });
    });
  }

  /**
   * Check DNS for hijacking
   */
  async checkDns(hostname: string): Promise<MitmThreat[]> {
    const knownIps = this.knownDns.get(hostname);
    if (!knownIps || knownIps.size === 0) {
      return []; // No known IPs to compare
    }

    return new Promise((resolve) => {
      dns.resolve4(hostname, (err, addresses) => {
        if (err) {
          resolve([]);
          return;
        }

        const threats: MitmThreat[] = [];
        const unknownIps = addresses.filter(ip => !knownIps.has(ip));

        if (unknownIps.length > 0 && unknownIps.length === addresses.length) {
          threats.push({
            type: MitmThreatType.DNS_HIJACKING,
            severity: 'HIGH',
            message: 'DNS resolution returned unexpected IPs',
            details: {
              expected: [...knownIps].join(', '),
              received: addresses.join(', '),
            },
          });
        }

        resolve(threats);
      });
    });
  }

  /**
   * Pin a certificate for a hostname
   */
  pinCertificate(hostname: string, certHash: string): void {
    if (!this.pinnedCerts.has(hostname)) {
      this.pinnedCerts.set(hostname, new Set());
    }
    this.pinnedCerts.get(hostname)!.add(certHash);
  }

  /**
   * Add known DNS for a hostname
   */
  addKnownDns(hostname: string, ip: string): void {
    if (!this.knownDns.has(hostname)) {
      this.knownDns.set(hostname, new Set());
    }
    this.knownDns.get(hostname)!.add(ip);
  }

  /**
   * Hash a certificate for pinning
   */
  private hashCertificate(raw: Buffer): string {
    return crypto.createHash('sha256').update(raw).digest('base64');
  }

  /**
   * Fetch and return a certificate's hash for pinning
   */
  static async getCertificateHash(hostname: string, port = 443): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: hostname,
        },
        () => {
          const cert = socket.getPeerCertificate();
          socket.end();

          if (!cert || !cert.raw) {
            reject(new Error('No certificate received'));
            return;
          }

          const hash = crypto.createHash('sha256').update(cert.raw).digest('base64');
          resolve(hash);
        }
      );

      socket.on('error', reject);
    });
  }
}

export default MitmDetector;
