/**
 * PrivacyRPC HTTP Forward Proxy
 *
 * Handles HTTP CONNECT tunneling for HTTPS traffic
 * and HTTP forward proxy requests for HTTP traffic.
 *
 * This is required for chrome.proxy PAC script integration.
 */

import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as url from 'url';
import type { Duplex } from 'stream';

export interface ForwardProxyConfig {
  /** Port to listen on (default: 8899) */
  port: number;
  /** Upstream SOCKS5 proxy (for Tor) */
  socksProxy?: {
    host: string;
    port: number;
  };
  /** Callback for logging */
  onRequest?: (method: string, target: string) => void;
  /** Callback for errors */
  onError?: (error: Error, context: string) => void;
}

export class ForwardProxy {
  private config: ForwardProxyConfig;
  private server: http.Server | null = null;
  private stats = {
    totalRequests: 0,
    totalConnects: 0,
    totalErrors: 0,
  };

  constructor(config: Partial<ForwardProxyConfig> = {}) {
    this.config = {
      port: config.port || 8899,
      socksProxy: config.socksProxy,
      onRequest: config.onRequest,
      onError: config.onError,
    };
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Handle CONNECT method for HTTPS tunneling
      this.server.on('connect', (req: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
        this.handleConnect(req, clientSocket as net.Socket, head);
      });

      this.server.on('error', (err) => {
        this.config.onError?.(err, 'server');
        reject(err);
      });

      this.server.listen(this.config.port, '127.0.0.1', () => {
        console.log(`[PrivacyRPC] Forward proxy listening on 127.0.0.1:${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getStats() {
    return { ...this.stats };
  }

  /**
   * Handle regular HTTP proxy requests
   * Browser sends: GET http://target.com/path HTTP/1.1
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    this.stats.totalRequests++;

    const targetUrl = req.url;
    if (!targetUrl) {
      res.writeHead(400);
      res.end('Bad Request: No URL');
      return;
    }

    // Handle health check (direct request to proxy)
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      // Direct request to proxy itself (health check)
      if (req.method === 'GET' && (targetUrl === '/' || targetUrl === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          proxy: 'PrivacyRPC Forward Proxy',
          version: '2.0.0',
          stats: this.stats,
        }));
        return;
      }
    }

    this.config.onRequest?.(req.method || 'GET', targetUrl);

    try {
      const parsedUrl = new url.URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';

      const headers: http.OutgoingHttpHeaders = { ...req.headers };

      // Remove proxy-specific headers
      delete headers['proxy-connection'];

      // Set correct host header
      headers['host'] = parsedUrl.host;

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: req.method,
        headers,
      };

      const httpModule = isHttps ? https : http;

      const proxyReq = httpModule.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        this.stats.totalErrors++;
        this.config.onError?.(err, `request to ${targetUrl}`);
        res.writeHead(502);
        res.end(`Bad Gateway: ${err.message}`);
      });

      req.pipe(proxyReq);
    } catch (err) {
      this.stats.totalErrors++;
      this.config.onError?.(err as Error, 'parsing URL');
      res.writeHead(400);
      res.end('Bad Request');
    }
  }

  /**
   * Handle CONNECT method for HTTPS tunneling
   * Browser sends: CONNECT target.com:443 HTTP/1.1
   */
  private handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ) {
    this.stats.totalConnects++;

    const targetUrl = req.url;
    if (!targetUrl) {
      clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      clientSocket.end();
      return;
    }

    this.config.onRequest?.('CONNECT', targetUrl);

    const [hostname, portStr] = targetUrl.split(':');
    const port = parseInt(portStr) || 443;

    // Connect to target server
    const serverSocket = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

      // Forward any initial data
      if (head.length > 0) {
        serverSocket.write(head);
      }

      // Pipe data bidirectionally
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      this.stats.totalErrors++;
      this.config.onError?.(err, `connect to ${targetUrl}`);
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      clientSocket.end();
    });

    clientSocket.on('error', (err) => {
      this.config.onError?.(err, 'client socket');
      serverSocket.destroy();
    });

    serverSocket.on('end', () => {
      clientSocket.end();
    });

    clientSocket.on('end', () => {
      serverSocket.end();
    });
  }
}

export default ForwardProxy;
