/**
 * Phishing/Spoofing Website Detector
 *
 * PRIVACY-FIRST DESIGN:
 * - 100% LOCAL detection - no external API calls
 * - No logging of visited domains
 * - No telemetry or tracking
 * - All pattern matching happens on-device
 * - Phishing database stored locally (encrypted option available)
 *
 * Detection methods:
 * 1. Homograph attacks (phantóm.app vs phantom.app)
 * 2. Typosquatting (phantm.app, phanton.app)
 * 3. Domain lookalikes (phantom-app.com, phantom.io)
 * 4. Known phishing domains (local blacklist)
 * 5. Suspicious URL patterns (airdrop scams, etc.)
 */

export interface PhishingResult {
  isPhishing: boolean;
  confidence: Confidence;
  reason: string;
  legitimateDomain: string | null;
  alerts: string[];
}

export enum Confidence {
  CONFIRMED = 'CONFIRMED',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  UNKNOWN = 'UNKNOWN',
}

export enum DomainCategory {
  WALLET = 'WALLET',
  DEX = 'DEX',
  NFT = 'NFT',
  BLOCKCHAIN = 'BLOCKCHAIN',
  EXPLORER = 'EXPLORER',
  RPC = 'RPC',
  DATA = 'DATA',
  OTHER = 'OTHER',
}

interface DomainInfo {
  name: string;
  category: DomainCategory;
}

// Homograph characters that look like ASCII
const HOMOGRAPHS: Record<string, string> = {
  'а': 'a', // Cyrillic
  'е': 'e',
  'о': 'o',
  'р': 'p',
  'с': 'c',
  'у': 'y',
  'х': 'x',
  'ѕ': 's',
  'і': 'i',
  'ј': 'j',
  'һ': 'h',
  'ԁ': 'd',
  'ԝ': 'w',
  'ɑ': 'a', // Latin Extended
  'ɡ': 'g',
  'ɩ': 'i',
  'ɪ': 'i',
  'ι': 'i', // Greek
  'ο': 'o',
  'α': 'a',
  'ν': 'v',
  'τ': 't',
  '0': 'o', // Numbers
  '1': 'l',
  '5': 's',
  '3': 'e',
};

// Legitimate crypto domains
const LEGITIMATE_DOMAINS: Record<string, DomainInfo> = {
  // Wallets
  'phantom.app': { name: 'Phantom Wallet', category: DomainCategory.WALLET },
  'backpack.app': { name: 'Backpack Wallet', category: DomainCategory.WALLET },
  'solflare.com': { name: 'Solflare Wallet', category: DomainCategory.WALLET },
  'metamask.io': { name: 'MetaMask Wallet', category: DomainCategory.WALLET },
  'trustwallet.com': { name: 'Trust Wallet', category: DomainCategory.WALLET },

  // DEXes
  'jup.ag': { name: 'Jupiter Exchange', category: DomainCategory.DEX },
  'jupiter.ag': { name: 'Jupiter Exchange', category: DomainCategory.DEX },
  'raydium.io': { name: 'Raydium', category: DomainCategory.DEX },
  'orca.so': { name: 'Orca', category: DomainCategory.DEX },
  'uniswap.org': { name: 'Uniswap', category: DomainCategory.DEX },

  // Solana ecosystem
  'solana.com': { name: 'Solana', category: DomainCategory.BLOCKCHAIN },
  'solscan.io': { name: 'Solscan Explorer', category: DomainCategory.EXPLORER },
  'solana.fm': { name: 'Solana FM Explorer', category: DomainCategory.EXPLORER },
  'helius.dev': { name: 'Helius', category: DomainCategory.RPC },
  'helius.xyz': { name: 'Helius', category: DomainCategory.RPC },
  'quicknode.com': { name: 'QuickNode', category: DomainCategory.RPC },

  // NFT marketplaces
  'magiceden.io': { name: 'Magic Eden', category: DomainCategory.NFT },
  'tensor.trade': { name: 'Tensor', category: DomainCategory.NFT },
  'opensea.io': { name: 'OpenSea', category: DomainCategory.NFT },

  // Data
  'coingecko.com': { name: 'CoinGecko', category: DomainCategory.DATA },
  'coinmarketcap.com': { name: 'CoinMarketCap', category: DomainCategory.DATA },
  'dexscreener.com': { name: 'DEX Screener', category: DomainCategory.DATA },
  'birdeye.so': { name: 'Birdeye', category: DomainCategory.DATA },

  // Memecoin platforms
  'pump.fun': { name: 'Pump.fun', category: DomainCategory.DEX },
};

// Known phishing domains
const KNOWN_PHISHING = new Set([
  'phantom-wallet.app',
  'phantomwallet.io',
  'phantom-app.com',
  'solana-airdrop.com',
  'jupiter-airdrop.com',
  'free-solana.com',
  'claim-jupiter.com',
  // pump.fun phishing
  'pump.fun-watch.dev',
]);

export class PhishingDetector {
  private knownPhishing: Set<string>;
  private onAlert?: (result: PhishingResult, domain: string) => void;

  constructor(options?: { onAlert?: (result: PhishingResult, domain: string) => void }) {
    this.knownPhishing = new Set(KNOWN_PHISHING);
    this.onAlert = options?.onAlert;
  }

  /**
   * Check if a domain is potentially a phishing site
   */
  check(domain: string): PhishingResult {
    const normalized = this.normalize(domain);

    // Check known phishing list
    if (this.knownPhishing.has(normalized)) {
      const result: PhishingResult = {
        isPhishing: true,
        confidence: Confidence.CONFIRMED,
        reason: 'Known phishing domain',
        legitimateDomain: this.findSimilar(normalized),
        alerts: ['This is a confirmed phishing site. Do NOT enter any information.'],
      };
      this.onAlert?.(result, domain);
      return result;
    }

    // Check if legitimate
    if (normalized in LEGITIMATE_DOMAINS) {
      return {
        isPhishing: false,
        confidence: Confidence.CONFIRMED,
        reason: 'Verified legitimate domain',
        legitimateDomain: normalized,
        alerts: [],
      };
    }

    // Check homograph attacks
    const homographResult = this.checkHomograph(normalized);
    if (homographResult) {
      this.onAlert?.(homographResult, domain);
      return homographResult;
    }

    // Check typosquatting
    const typoResult = this.checkTyposquatting(normalized);
    if (typoResult) {
      this.onAlert?.(typoResult, domain);
      return typoResult;
    }

    // Check suspicious patterns
    const patternResult = this.checkPatterns(normalized);
    if (patternResult) {
      this.onAlert?.(patternResult, domain);
      return patternResult;
    }

    return {
      isPhishing: false,
      confidence: Confidence.UNKNOWN,
      reason: 'Unknown domain - exercise caution',
      legitimateDomain: null,
      alerts: [],
    };
  }

  /**
   * Check for homograph attacks
   */
  private checkHomograph(domain: string): PhishingResult | null {
    const ascii = [...domain].map((c) => HOMOGRAPHS[c] || c).join('');

    if (ascii !== domain && ascii in LEGITIMATE_DOMAINS) {
      return {
        isPhishing: true,
        confidence: Confidence.HIGH,
        reason: 'Homograph attack - uses lookalike characters',
        legitimateDomain: ascii,
        alerts: [
          `This domain uses fake characters to look like '${ascii}'`,
          "Example: 'а' (Cyrillic) looks like 'a' (Latin)",
          `The real site is: ${ascii}`,
        ],
      };
    }

    return null;
  }

  /**
   * Check for typosquatting
   */
  private checkTyposquatting(domain: string): PhishingResult | null {
    for (const legit of Object.keys(LEGITIMATE_DOMAINS)) {
      const distance = this.levenshtein(domain, legit);

      if (distance >= 1 && distance <= 2) {
        return {
          isPhishing: true,
          confidence: Confidence.HIGH,
          reason: 'Typosquatting - similar to legitimate domain',
          legitimateDomain: legit,
          alerts: [
            `This looks like a typo of '${legit}'`,
            `Did you mean to visit: ${legit}?`,
          ],
        };
      }

      if (distance === 3 && domain.length > 6) {
        return {
          isPhishing: true,
          confidence: Confidence.MEDIUM,
          reason: 'Possible typosquatting',
          legitimateDomain: legit,
          alerts: [`This domain is similar to '${legit}'`],
        };
      }
    }

    return null;
  }

  /**
   * Check for suspicious patterns
   */
  private checkPatterns(domain: string): PhishingResult | null {
    const patterns: Array<{ regex: RegExp; legit: string | null; reason: string }> = [
      { regex: /phantom[^a-z]/, legit: 'phantom.app', reason: 'Fake Phantom site' },
      { regex: /metamask[^a-z]/, legit: 'metamask.io', reason: 'Fake MetaMask site' },
      { regex: /jupiter[^a-z]/, legit: 'jup.ag', reason: 'Fake Jupiter site' },
      { regex: /raydium[^a-z]/, legit: 'raydium.io', reason: 'Fake Raydium site' },
      { regex: /pump\.?fun[^a-z]/i, legit: 'pump.fun', reason: 'Fake pump.fun site' },
      { regex: /(airdrop|claim|free).*(solana|sol|jupiter|jup)/i, legit: null, reason: 'Airdrop scam' },
      { regex: /(solana|sol|jupiter|jup).*(airdrop|claim|free)/i, legit: null, reason: 'Airdrop scam' },
      { regex: /wallet.?connect.?(verify|validate|sync)/i, legit: null, reason: 'Wallet connect scam' },
      { regex: /(recover|restore).*(wallet|phrase|seed)/i, legit: null, reason: 'Recovery scam' },
    ];

    for (const { regex, legit, reason } of patterns) {
      if (regex.test(domain)) {
        return {
          isPhishing: true,
          confidence: Confidence.HIGH,
          reason,
          legitimateDomain: legit,
          alerts: [
            'This domain matches known phishing patterns',
            legit ? `The real site is: ${legit}` : 'This is likely a scam',
            'NEVER enter your seed phrase on any website',
          ],
        };
      }
    }

    return null;
  }

  /**
   * Levenshtein distance
   */
  private levenshtein(a: string, b: string): number {
    const dp: number[][] = Array(a.length + 1)
      .fill(null)
      .map(() => Array(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }

    return dp[a.length][b.length];
  }

  /**
   * Find similar legitimate domain
   */
  private findSimilar(domain: string): string | null {
    let best: string | null = null;
    let bestDist = Infinity;

    for (const legit of Object.keys(LEGITIMATE_DOMAINS)) {
      const dist = this.levenshtein(domain, legit);
      if (dist < bestDist && dist <= 5) {
        best = legit;
        bestDist = dist;
      }
    }

    return best;
  }

  /**
   * Normalize domain
   */
  private normalize(domain: string): string {
    return domain
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .split('/')[0];
  }

  /**
   * Report a phishing domain
   */
  report(domain: string): void {
    this.knownPhishing.add(this.normalize(domain));
  }
}

export default PhishingDetector;
