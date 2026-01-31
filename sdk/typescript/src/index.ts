/**
 * PrivacyRPC SDK for TypeScript/JavaScript
 *
 * Privacy-first RPC protection for blockchain applications.
 * Works with Node.js, React Native, and browsers.
 *
 * @example
 * ```typescript
 * import { PrivacyRPC } from '@privacyrpc/sdk';
 *
 * // Standard mode - RPC sees your IP
 * const privacyRpc = PrivacyRPC.withHelius('your-api-key');
 * await privacyRpc.start();
 *
 * // Tor mode - IP hidden from RPC
 * const privateSR = PrivacyRPC.withHelius('key', { privacy: 'tor' });
 * await privateSR.start();
 *
 * console.log('Proxy URL:', privacyRpc.proxyUrl);
 * ```
 */

import { TorManager } from './tor';
import type { TorManagerConfig } from './tor';
import { MitmDetector } from './mitm';
import { PhishingDetector } from './phishing';
import type { PhishingResult } from './phishing';

export { TorManager } from './tor';
export type { TorManagerConfig, TorStatus, CircuitEvent } from './tor';
export { MitmDetector } from './mitm';
export type { MitmResult, MitmThreat, MitmThreatType } from './mitm';
export { PhishingDetector } from './phishing';
export type { PhishingResult, Confidence, DomainCategory } from './phishing';
export { ForwardProxy } from './forward-proxy';
export type { ForwardProxyConfig } from './forward-proxy';
export { ZKCompression } from './zk-compression';
export type { CompressedAccount, ValidityProof, ZKCompressionConfig } from './zk-compression';

export interface PrivacyRPCConfig {
  /** Primary RPC endpoint */
  primaryRpc: string;
  /** Fallback RPC endpoints */
  fallbackRpcs?: string[];
  /** Local proxy port (default: 8899) */
  proxyPort?: number;
  /** Endpoints to pin certificates for */
  pinnedEndpoints?: string[];
  /** Alert handler callback */
  onAlert?: AlertHandler;
  /** Request interceptor */
  onRequest?: RequestInterceptor;
  /** Response interceptor */
  onResponse?: ResponseInterceptor;
  /** Privacy mode: 'none' | 'tor' | 'vpn' */
  privacy?: PrivacyMode;
  /** Tor configuration (used when privacy='tor') */
  torConfig?: TorManagerConfig;
  /** VPN/proxy configuration (used when privacy='vpn') */
  vpnConfig?: VpnConfig;
  /** Enable MITM detection (default: true) */
  mitmDetection?: boolean;
  /** Enable phishing detection (default: true) */
  phishingDetection?: boolean;
}

export type PrivacyMode = 'none' | 'tor' | 'vpn';

// Keep enum for backwards compatibility
export enum PrivacyLevel {
  NONE = 'NONE',
  TOR = 'TOR',
  TOR_ISOLATED = 'TOR_ISOLATED',
}

export interface VpnConfig {
  /** Proxy type */
  type: ProxyType;
  /** Proxy host */
  host: string;
  /** Proxy port */
  port: number;
  /** Username for authentication */
  username?: string;
  /** Password for authentication */
  password?: string;
  /** Fallback to direct if proxy unavailable */
  fallbackToDirect?: boolean;
  /** VPN provider preset */
  provider?: VpnProvider;
}

export enum ProxyType {
  SOCKS5 = 'SOCKS5',
  HTTP = 'HTTP',
  HTTPS = 'HTTPS',
  SYSTEM = 'SYSTEM',
}

export enum VpnProvider {
  MULLVAD = 'MULLVAD',
  PROTONVPN = 'PROTONVPN',
  NORDVPN = 'NORDVPN',
  EXPRESSVPN = 'EXPRESSVPN',
  SURFSHARK = 'SURFSHARK',
  PIA = 'PIA',
  WINDSCRIBE = 'WINDSCRIBE',
  CUSTOM = 'CUSTOM',
}

/** VPN preset configurations */
export const VpnPresets = {
  mullvad: (): VpnConfig => ({
    type: ProxyType.SOCKS5,
    host: '10.64.0.1',
    port: 1080,
    provider: VpnProvider.MULLVAD,
  }),

  protonVpn: (username: string, password: string): VpnConfig => ({
    type: ProxyType.SOCKS5,
    host: '127.0.0.1',
    port: 1080,
    username,
    password,
    provider: VpnProvider.PROTONVPN,
  }),

  nordVpn: (username: string, password: string, server = 'us5839.nordvpn.com'): VpnConfig => ({
    type: ProxyType.SOCKS5,
    host: server,
    port: 1080,
    username,
    password,
    provider: VpnProvider.NORDVPN,
  }),

  socks5: (host: string, port: number, username?: string, password?: string): VpnConfig => ({
    type: ProxyType.SOCKS5,
    host,
    port,
    username,
    password,
    provider: VpnProvider.CUSTOM,
  }),

  http: (host: string, port: number, username?: string, password?: string): VpnConfig => ({
    type: ProxyType.HTTP,
    host,
    port,
    username,
    password,
    provider: VpnProvider.CUSTOM,
  }),
};

export type AlertHandler = (alert: PrivacyRPCAlert) => void;
export type RequestInterceptor = (request: RpcRequest) => RpcRequest;
export type ResponseInterceptor = (response: RpcResponse) => RpcResponse;

export interface PrivacyRPCAlert {
  type: AlertType;
  severity: Severity;
  message: string;
  hostname?: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export enum AlertType {
  MITM_DETECTED = 'MITM_DETECTED',
  CERTIFICATE_MISMATCH = 'CERTIFICATE_MISMATCH',
  DNS_HIJACKING = 'DNS_HIJACKING',
  SSL_STRIPPING = 'SSL_STRIPPING',
  SUSPICIOUS_CERTIFICATE = 'SUSPICIOUS_CERTIFICATE',
  PUBLIC_RPC_DETECTED = 'PUBLIC_RPC_DETECTED',
  RPC_FAILOVER = 'RPC_FAILOVER',
  RPC_ALL_FAILED = 'RPC_ALL_FAILED',
  PROXY_ERROR = 'PROXY_ERROR',
  PROXY_STARTED = 'PROXY_STARTED',
  PROXY_STOPPED = 'PROXY_STOPPED',
  TOR_STARTING = 'TOR_STARTING',
  TOR_CONNECTED = 'TOR_CONNECTED',
  TOR_DISCONNECTED = 'TOR_DISCONNECTED',
  TOR_NEW_CIRCUIT = 'TOR_NEW_CIRCUIT',
  TOR_ERROR = 'TOR_ERROR',
  PHISHING_DETECTED = 'PHISHING_DETECTED',
}

export enum Severity {
  INFO = 'INFO',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface RpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: RpcError;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ProxyStats {
  isRunning: boolean;
  port: number;
  primaryRpc: string;
  totalRequests: number;
  totalErrors: number;
  methodStats: Record<string, number>;
  lastRequestTime: number;
  uptimeMs: number;
}

export enum Chain {
  SOLANA = 'SOLANA',
  ETHEREUM = 'ETHEREUM',
  POLYGON = 'POLYGON',
  ARBITRUM = 'ARBITRUM',
  OPTIMISM = 'OPTIMISM',
  BASE = 'BASE',
}

/**
 * PrivacyRPC SDK main class
 *
 * Privacy-first RPC proxy with embedded Tor support
 */
export class PrivacyRPC {
  private config: PrivacyRPCConfig & { proxyPort: number; fallbackRpcs: string[] };
  private server: RpcProxyServer | null = null;
  private torManager: TorManager | null = null;
  private mitmDetector: MitmDetector | null = null;
  private phishingDetector: PhishingDetector | null = null;
  private _isRunning = false;
  private _privacyMode: PrivacyMode = 'none';
  private stats: ProxyStats;

  constructor(config: PrivacyRPCConfig) {
    this.config = {
      ...config,
      proxyPort: config.proxyPort ?? 8899,
      fallbackRpcs: config.fallbackRpcs ?? [],
    };
    this._privacyMode = config.privacy ?? 'none';

    this.stats = {
      isRunning: false,
      port: this.config.proxyPort,
      primaryRpc: this.config.primaryRpc,
      totalRequests: 0,
      totalErrors: 0,
      methodStats: {},
      lastRequestTime: 0,
      uptimeMs: 0,
    };

    // Initialize detectors
    if (config.mitmDetection !== false) {
      this.mitmDetector = new MitmDetector({
        onThreat: (threat) => {
          this.config.onAlert?.({
            type: AlertType.MITM_DETECTED,
            severity: Severity.CRITICAL,
            message: threat.message,
            details: threat.details as Record<string, unknown>,
            timestamp: Date.now(),
          });
        },
      });
    }

    if (config.phishingDetection !== false) {
      this.phishingDetector = new PhishingDetector({
        onAlert: (result, domain) => {
          this.config.onAlert?.({
            type: AlertType.PHISHING_DETECTED,
            severity: Severity.CRITICAL,
            message: `Phishing detected: ${domain}`,
            hostname: domain,
            details: { reason: result.reason, legitimate: result.legitimateDomain },
            timestamp: Date.now(),
          });
        },
      });
    }
  }

  /** Local proxy URL to use in wallets */
  get proxyUrl(): string {
    return `http://127.0.0.1:${this.config.proxyPort}`;
  }

  /** Whether the proxy is running */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Current privacy mode */
  get privacyMode(): PrivacyMode {
    return this._privacyMode;
  }

  /** Tor manager instance (if using Tor) */
  get tor(): TorManager | null {
    return this.torManager;
  }

  /**
   * Start the PrivacyRPC proxy
   */
  async start(): Promise<void> {
    if (this._isRunning) return;

    // Start Tor if privacy mode is 'tor'
    if (this._privacyMode === 'tor') {
      this.torManager = new TorManager(this.config.torConfig);

      this.config.onAlert?.({
        type: AlertType.TOR_STARTING,
        severity: Severity.INFO,
        message: 'Starting embedded Tor...',
        timestamp: Date.now(),
      });

      await this.torManager.start();

      this.config.onAlert?.({
        type: AlertType.TOR_CONNECTED,
        severity: Severity.INFO,
        message: `Tor connected on SOCKS port ${this.torManager.socksPort}`,
        timestamp: Date.now(),
      });

      // If hidden service is enabled, read the onion address
      if (this.config.torConfig?.hiddenService) {
        const onionAddress = await this.torManager.readOnionAddress();
        if (onionAddress) {
          this.config.onAlert?.({
            type: AlertType.TOR_CONNECTED,
            severity: Severity.INFO,
            message: `Onion service available at: ${onionAddress}`,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Run MITM check on primary RPC
    if (this.mitmDetector) {
      const url = new URL(this.config.primaryRpc);
      const result = await this.mitmDetector.check(url.hostname);
      if (!result.isSafe) {
        this.config.onAlert?.({
          type: AlertType.MITM_DETECTED,
          severity: Severity.CRITICAL,
          message: `MITM attack detected on ${url.hostname}`,
          hostname: url.hostname,
          timestamp: Date.now(),
        });
      }
    }

    // Start proxy server
    this.server = new RpcProxyServer(this.config, this.torManager, this._privacyMode);
    await this.server.start();
    this._isRunning = true;

    const modeStr = this._privacyMode === 'tor' ? ' (Tor enabled)' :
                    this._privacyMode === 'vpn' ? ' (VPN enabled)' : '';

    this.config.onAlert?.({
      type: AlertType.PROXY_STARTED,
      severity: Severity.INFO,
      message: `PrivacyRPC proxy started on port ${this.config.proxyPort}${modeStr}`,
      timestamp: Date.now(),
    });
  }

  /**
   * Stop the PrivacyRPC proxy
   */
  async stop(): Promise<void> {
    if (!this._isRunning) return;

    await this.server?.stop();
    this.server = null;

    if (this.torManager) {
      await this.torManager.stop();
      this.torManager = null;
    }

    this._isRunning = false;

    this.config.onAlert?.({
      type: AlertType.PROXY_STOPPED,
      severity: Severity.INFO,
      message: 'PrivacyRPC proxy stopped',
      timestamp: Date.now(),
    });
  }

  /**
   * Request a new Tor circuit (new exit IP)
   */
  async newCircuit(): Promise<void> {
    if (!this.torManager) {
      throw new Error('Tor is not enabled');
    }
    await this.torManager.newCircuit();

    this.config.onAlert?.({
      type: AlertType.TOR_NEW_CIRCUIT,
      severity: Severity.INFO,
      message: 'New Tor circuit established',
      timestamp: Date.now(),
    });
  }

  /**
   * Get current exit IP (when using Tor)
   */
  async getExitIp(): Promise<string | undefined> {
    return this.torManager?.getExitIp();
  }

  /**
   * Check a domain for phishing
   */
  checkPhishing(domain: string): PhishingResult | null {
    return this.phishingDetector?.check(domain) ?? null;
  }

  /**
   * Update the primary RPC endpoint
   */
  setPrimaryRpc(url: string): void {
    this.config.primaryRpc = url;
    this.server?.setPrimaryRpc(url);
  }

  /**
   * Get proxy statistics
   */
  getStats(): ProxyStats {
    return this.server?.getStats() ?? this.stats;
  }

  /**
   * Create with Helius
   */
  static withHelius(apiKey: string, options?: Partial<PrivacyRPCConfig>): PrivacyRPC {
    return new PrivacyRPC({
      primaryRpc: `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
      pinnedEndpoints: ['mainnet.helius-rpc.com'],
      ...options,
    });
  }

  /**
   * Create with QuickNode
   */
  static withQuickNode(endpoint: string, options?: Partial<PrivacyRPCConfig>): PrivacyRPC {
    const url = new URL(endpoint);
    return new PrivacyRPC({
      primaryRpc: endpoint,
      pinnedEndpoints: [url.hostname],
      ...options,
    });
  }

  /**
   * Create with Alchemy
   */
  static withAlchemy(
    apiKey: string,
    chain: Chain = Chain.SOLANA,
    options?: Partial<PrivacyRPCConfig>
  ): PrivacyRPC {
    const rpcUrls: Record<Chain, string> = {
      [Chain.SOLANA]: `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`,
      [Chain.ETHEREUM]: `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`,
      [Chain.POLYGON]: `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`,
      [Chain.ARBITRUM]: `https://arb-mainnet.g.alchemy.com/v2/${apiKey}`,
      [Chain.OPTIMISM]: `https://opt-mainnet.g.alchemy.com/v2/${apiKey}`,
      [Chain.BASE]: `https://base-mainnet.g.alchemy.com/v2/${apiKey}`,
    };

    return new PrivacyRPC({
      primaryRpc: rpcUrls[chain],
      ...options,
    });
  }
}

/**
 * RPC Proxy Server with Tor/VPN routing
 */
class RpcProxyServer {
  private config: PrivacyRPCConfig & { proxyPort: number; fallbackRpcs: string[] };
  private torManager: TorManager | null;
  private privacyMode: PrivacyMode;
  private server: any = null;
  private httpAgent: any = null;
  private startTime = 0;
  private stats = {
    totalRequests: 0,
    totalErrors: 0,
    methodStats: {} as Record<string, number>,
    lastRequestTime: 0,
  };

  constructor(
    config: PrivacyRPCConfig & { proxyPort: number; fallbackRpcs: string[] },
    torManager: TorManager | null,
    privacyMode: PrivacyMode
  ) {
    this.config = config;
    this.torManager = torManager;
    this.privacyMode = privacyMode;
  }

  async start(): Promise<void> {
    // Setup HTTP agent for Tor/VPN routing
    if (this.privacyMode === 'tor' && this.torManager) {
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      this.httpAgent = new SocksProxyAgent(
        `socks5h://127.0.0.1:${this.torManager.socksPort}`
      );
    } else if (this.privacyMode === 'vpn' && this.config.vpnConfig) {
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      const { HttpsProxyAgent } = await import('https-proxy-agent');

      if (this.config.vpnConfig.type === ProxyType.SOCKS5) {
        const auth = this.config.vpnConfig.username
          ? `${this.config.vpnConfig.username}:${this.config.vpnConfig.password}@`
          : '';
        this.httpAgent = new SocksProxyAgent(
          `socks5://${auth}${this.config.vpnConfig.host}:${this.config.vpnConfig.port}`
        );
      } else {
        const auth = this.config.vpnConfig.username
          ? `${this.config.vpnConfig.username}:${this.config.vpnConfig.password}@`
          : '';
        this.httpAgent = new HttpsProxyAgent(
          `http://${auth}${this.config.vpnConfig.host}:${this.config.vpnConfig.port}`
        );
      }
    }

    // Check if we're in Node.js environment
    if (typeof require !== 'undefined') {
      const http = require('http');

      this.server = http.createServer(async (req: any, res: any) => {
        // CORS headers - permissive for local proxy
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Max-Age', '86400');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        // Health check for GET requests
        if (req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            proxy: 'PrivacyRPC RPC Proxy',
            version: '1.0.0',
            rpc: this.config.primaryRpc,
          }));
          return;
        }

        try {
          const body = await this.readBody(req);

          // Handle empty body
          if (!body || body.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32700, message: 'Empty request body' },
              id: null,
            }));
            return;
          }

          // Track stats from request
          try {
            const parsed = JSON.parse(body);
            const requests = Array.isArray(parsed) ? parsed : [parsed];
            requests.forEach((r: any) => {
              this.stats.totalRequests++;
              this.stats.lastRequestTime = Date.now();
              if (r.method) {
                this.stats.methodStats[r.method] = (this.stats.methodStats[r.method] || 0) + 1;
              }
              // Call onRequest if defined
              if (this.config.onRequest) this.config.onRequest(r);
            });
          } catch (e) {
            // Ignore parse errors for stats, still forward the request
          }

          // RAW PASSTHROUGH: Forward request body directly without modification
          const rawResponse = await this.forwardToRpcRaw(body);

          // Call onResponse for logging if defined
          try {
            const parsed = JSON.parse(rawResponse);
            const responses = Array.isArray(parsed) ? parsed : [parsed];
            responses.forEach((r: any) => {
              if (this.config.onResponse) this.config.onResponse(r);
            });
          } catch (e) {
            // Ignore
          }

          // Return raw response exactly as received from RPC
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(rawResponse);
        } catch (error) {
          console.error('Proxy error:', error);
          this.stats.totalErrors++;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Proxy error: ' + (error as Error).message },
            id: null,
          }));
        }
      });

      await new Promise<void>((resolve) => {
        this.server.listen(this.config.proxyPort, '127.0.0.1', resolve);
      });

      this.startTime = Date.now();
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server.close(resolve);
      });
      this.server = null;
    }
  }

  setPrimaryRpc(url: string): void {
    this.config.primaryRpc = url;
  }

  getStats(): ProxyStats {
    return {
      isRunning: this.server !== null,
      port: this.config.proxyPort,
      primaryRpc: this.config.primaryRpc,
      totalRequests: this.stats.totalRequests,
      totalErrors: this.stats.totalErrors,
      methodStats: this.stats.methodStats,
      lastRequestTime: this.stats.lastRequestTime,
      uptimeMs: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  private readBody(req: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: any) => (body += chunk));
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  // Raw passthrough - returns response as string without parsing
  private async forwardToRpcRaw(requestBody: string): Promise<string> {
    const rpcs = [this.config.primaryRpc, ...this.config.fallbackRpcs];

    // Log request
    try {
      const parsed = JSON.parse(requestBody);
      if (Array.isArray(parsed)) {
        console.log(`[RPC] Batch request (${parsed.length} calls):`, parsed.map((r: any) => r.method).join(', '));
      } else {
        console.log(`[RPC] ${parsed.method}`, parsed.params ? JSON.stringify(parsed.params).slice(0, 100) : '');
      }
    } catch (e) {
      console.log('[RPC] Request (unparseable)');
    }

    for (const rpc of rpcs) {
      try {
        const url = new URL(rpc);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? require('https') : require('http');

        const response = await new Promise<string>((resolve, reject) => {
          const options: any = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(requestBody),
              'Accept': 'application/json',
            },
          };

          if (this.httpAgent) {
            options.agent = this.httpAgent;
          }

          const req = httpModule.request(options, (res: any) => {
            let body = '';
            res.on('data', (chunk: any) => (body += chunk));
            res.on('end', () => {
              // Log response summary
              try {
                const parsed = JSON.parse(body);
                if (Array.isArray(parsed)) {
                  console.log(`[RPC] Response: batch (${parsed.length} results)`);
                } else if (parsed.error) {
                  console.log(`[RPC] Response ERROR:`, parsed.error.message || parsed.error);
                } else {
                  console.log(`[RPC] Response OK`);
                }
              } catch (e) {
                console.log(`[RPC] Response (non-JSON):`, body.slice(0, 100));
              }
              // Return raw body string
              resolve(body);
            });
          });

          req.on('error', reject);
          req.write(requestBody);
          req.end();
        });

        return response;
      } catch (err) {
        console.error('RPC forward error:', err);
        continue;
      }
    }

    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'All RPC endpoints failed' },
    });
  }
}

// Export everything
export default PrivacyRPC;
