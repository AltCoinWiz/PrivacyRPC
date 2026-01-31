/**
 * Embedded Tor Manager
 *
 * Manages an embedded Tor process for anonymous RPC routing.
 * No external Tor installation required.
 *
 * Uses:
 * - Pre-bundled Tor binary (tor-expert-bundle)
 * - Automatic bootstrap and circuit management
 * - SOCKS5 proxy for routing
 * - Control port for NEWNYM signals
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

export interface TorManagerConfig {
  /** Data directory for Tor state */
  dataDir?: string;
  /** SOCKS port (0 = auto) */
  socksPort?: number;
  /** Control port (0 = auto) */
  controlPort?: number;
  /** Path to Tor binary (auto-detected if not specified) */
  torBinaryPath?: string;
  /** Bootstrap timeout in ms */
  bootstrapTimeout?: number;
  /** Callback for bootstrap progress */
  onBootstrapProgress?: (progress: number, summary: string) => void;
  /** Callback for circuit events */
  onCircuitEvent?: (event: CircuitEvent) => void;
  /** Hidden service configuration */
  hiddenService?: {
    /** Local port to expose */
    localPort: number;
    /** Remote port on .onion (default: 80) */
    remotePort?: number;
  };
}

export interface CircuitEvent {
  type: 'NEW' | 'EXTENDED' | 'BUILT' | 'CLOSED' | 'FAILED';
  circuitId: string;
  path?: string[];
}

export interface TorStatus {
  isRunning: boolean;
  isBootstrapped: boolean;
  bootstrapProgress: number;
  socksPort: number;
  controlPort: number;
  exitIp?: string;
  circuitCount: number;
}

/**
 * Embedded Tor Manager
 *
 * Spawns and manages a Tor process for anonymous routing.
 */
export class TorManager {
  private config: Required<TorManagerConfig>;
  private process: ChildProcess | null = null;
  private controlSocket: net.Socket | null = null;
  private _isRunning = false;
  private _isBootstrapped = false;
  private _bootstrapProgress = 0;
  private _socksPort = 0;
  private _controlPort = 0;
  private _exitIp?: string;
  private cookieAuthFile: string = '';

  private _onionAddress?: string;
  private hiddenServiceDir?: string;

  constructor(config: TorManagerConfig = {}) {
    this.config = {
      dataDir: config.dataDir ?? path.join(os.tmpdir(), 'privacyrpc-tor'),
      socksPort: config.socksPort ?? 0,
      controlPort: config.controlPort ?? 0,
      torBinaryPath: config.torBinaryPath ?? this.findTorBinary(),
      bootstrapTimeout: config.bootstrapTimeout ?? 120000,
      onBootstrapProgress: config.onBootstrapProgress ?? (() => {}),
      onCircuitEvent: config.onCircuitEvent ?? (() => {}),
      hiddenService: config.hiddenService as Required<TorManagerConfig>['hiddenService'],
    };
  }

  /** Get the .onion address if hidden service is enabled */
  get onionAddress(): string | undefined {
    return this._onionAddress;
  }

  /** Current SOCKS port */
  get socksPort(): number {
    return this._socksPort;
  }

  /** Current control port */
  get controlPort(): number {
    return this._controlPort;
  }

  /** Whether Tor is running */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Whether Tor is bootstrapped and ready */
  get isBootstrapped(): boolean {
    return this._isBootstrapped;
  }

  /** SOCKS5 proxy URL */
  get socksUrl(): string {
    return `socks5h://127.0.0.1:${this._socksPort}`;
  }

  /**
   * Start the embedded Tor process
   */
  async start(): Promise<void> {
    if (this._isRunning) return;

    // Ensure data directory exists
    await fs.promises.mkdir(this.config.dataDir, { recursive: true });

    // Find available ports
    if (this.config.socksPort === 0) {
      this._socksPort = await this.findAvailablePort();
    } else {
      this._socksPort = this.config.socksPort;
    }

    if (this.config.controlPort === 0) {
      this._controlPort = await this.findAvailablePort();
    } else {
      this._controlPort = this.config.controlPort;
    }

    // Write torrc config
    const torrcPath = path.join(this.config.dataDir, 'torrc');
    const torrc = this.generateTorrc();
    await fs.promises.writeFile(torrcPath, torrc);

    // Spawn Tor process
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(new Error('Tor bootstrap timeout'));
      }, this.config.bootstrapTimeout);

      this.process = spawn(this.config.torBinaryPath, ['-f', torrcPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this._isRunning = true;

      let stderr = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        const line = data.toString();
        this.parseBootstrapLine(line);

        if (this._isBootstrapped) {
          clearTimeout(timeout);
          this.connectControl().then(resolve).catch(reject);
        }
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      this.process.on('error', (err) => {
        clearTimeout(timeout);
        this._isRunning = false;
        reject(new Error(`Failed to start Tor: ${err.message}`));
      });

      this.process.on('exit', (code) => {
        this._isRunning = false;
        this._isBootstrapped = false;
        if (code !== 0 && code !== null) {
          clearTimeout(timeout);
          reject(new Error(`Tor exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Stop the Tor process
   */
  async stop(): Promise<void> {
    if (this.controlSocket) {
      try {
        await this.sendControl('SIGNAL SHUTDOWN');
      } catch {
        // Ignore errors during shutdown
      }
      this.controlSocket.destroy();
      this.controlSocket = null;
    }

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }

    this._isRunning = false;
    this._isBootstrapped = false;
  }

  /**
   * Request a new circuit (new exit IP)
   */
  async newCircuit(): Promise<void> {
    if (!this._isBootstrapped) {
      throw new Error('Tor is not bootstrapped');
    }

    await this.sendControl('SIGNAL NEWNYM');

    // Wait for new circuit
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Update exit IP
    this._exitIp = undefined;
    await this.getExitIp();
  }

  /**
   * Get current exit IP address
   */
  async getExitIp(): Promise<string | undefined> {
    if (this._exitIp) return this._exitIp;

    try {
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      const https = await import('https');
      const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${this._socksPort}`);

      const data = await new Promise<{ IP: string }>((resolve, reject) => {
        const req = https.request(
          'https://check.torproject.org/api/ip',
          { agent },
          (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              try {
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          }
        );
        req.on('error', reject);
        req.end();
      });

      this._exitIp = data.IP;
      return this._exitIp;
    } catch {
      return undefined;
    }
  }

  /**
   * Get Tor status
   */
  async getStatus(): Promise<TorStatus> {
    let circuitCount = 0;

    if (this._isBootstrapped) {
      try {
        const response = await this.sendControl('GETINFO circuit-status');
        circuitCount = (response.match(/BUILT/g) || []).length;
      } catch {
        // Ignore
      }
    }

    return {
      isRunning: this._isRunning,
      isBootstrapped: this._isBootstrapped,
      bootstrapProgress: this._bootstrapProgress,
      socksPort: this._socksPort,
      controlPort: this._controlPort,
      exitIp: this._exitIp,
      circuitCount,
    };
  }

  /**
   * Generate torrc configuration
   */
  private generateTorrc(): string {
    // Use cookie auth file path
    this.cookieAuthFile = path.join(this.config.dataDir, 'control_auth_cookie');

    let config = `
# PrivacyRPC Embedded Tor Configuration
DataDirectory ${this.config.dataDir}
SocksPort ${this._socksPort}
ControlPort ${this._controlPort}
CookieAuthentication 1
CookieAuthFile ${this.cookieAuthFile}

# Disable unnecessary features
AvoidDiskWrites 1
DisableDebuggerAttachment 1

# Optimize for RPC traffic
CircuitBuildTimeout 30
LearnCircuitBuildTimeout 0
NumEntryGuards 4
KeepalivePeriod 60

# Security settings
SafeSocks 1
TestSocks 0

# Logging
Log notice stdout
`;

    // Add hidden service configuration if enabled
    if (this.config.hiddenService) {
      this.hiddenServiceDir = path.join(this.config.dataDir, 'hidden_service');
      const remotePort = this.config.hiddenService.remotePort ?? 80;
      const localPort = this.config.hiddenService.localPort;

      config += `
# Hidden Service (Onion Tunnel)
HiddenServiceDir ${this.hiddenServiceDir}
HiddenServicePort ${remotePort} 127.0.0.1:${localPort}
`;
    } else {
      // Client-only mode (no relay) - only when not running hidden service
      config += `
# Client-only mode (no relay)
ClientOnly 1
`;
    }

    return config.trim();
  }

  /** Read the .onion address from the hidden service directory */
  async readOnionAddress(): Promise<string | undefined> {
    if (!this.hiddenServiceDir) return undefined;

    const hostnamePath = path.join(this.hiddenServiceDir, 'hostname');
    try {
      // Wait a bit for Tor to create the hostname file
      for (let i = 0; i < 30; i++) {
        if (fs.existsSync(hostnamePath)) {
          const hostname = await fs.promises.readFile(hostnamePath, 'utf-8');
          this._onionAddress = hostname.trim();
          return this._onionAddress;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      console.error('Failed to read onion address:', e);
    }
    return undefined;
  }

  /**
   * Hash control password using Tor's algorithm
   */
  private parseBootstrapLine(line: string): void {
    const match = line.match(/Bootstrapped (\d+)%[^:]*: (.+)/);
    if (match) {
      this._bootstrapProgress = parseInt(match[1], 10);
      this.config.onBootstrapProgress(this._bootstrapProgress, match[2]);

      if (this._bootstrapProgress === 100) {
        this._isBootstrapped = true;
      }
    }
  }

  /**
   * Connect to Tor control port using cookie authentication
   */
  private async connectControl(): Promise<void> {
    // Wait a moment for cookie file to be written
    await new Promise(resolve => setTimeout(resolve, 500));

    // Read the cookie file
    let cookie: Buffer;
    try {
      cookie = await fs.promises.readFile(this.cookieAuthFile);
    } catch (err) {
      throw new Error(`Failed to read cookie auth file: ${this.cookieAuthFile}`);
    }

    return new Promise((resolve, reject) => {
      this.controlSocket = net.createConnection(this._controlPort, '127.0.0.1');

      this.controlSocket.on('connect', async () => {
        try {
          // Authenticate with cookie
          const cookieHex = cookie.toString('hex');
          await this.sendControl(`AUTHENTICATE ${cookieHex}`);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.controlSocket.on('error', reject);
    });
  }

  /**
   * Send command to control port
   */
  private sendControl(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.controlSocket) {
        reject(new Error('Control socket not connected'));
        return;
      }

      let response = '';

      const onData = (data: Buffer) => {
        response += data.toString();
        if (response.includes('\r\n')) {
          this.controlSocket?.off('data', onData);

          if (response.startsWith('250')) {
            resolve(response);
          } else {
            reject(new Error(`Tor control error: ${response}`));
          }
        }
      };

      this.controlSocket.on('data', onData);
      this.controlSocket.write(`${command}\r\n`);
    });
  }

  /**
   * Find Tor binary - prioritizes bundled binary
   */
  private findTorBinary(): string {
    const platform = `${process.platform}-${process.arch}`;
    const isWindows = process.platform === 'win32';
    const torExe = isWindows ? 'tor.exe' : 'tor';

    const locations = [
      // Bundled with SDK (primary - embedded Tor)
      // The expert bundle extracts to: bin/<platform>/tor/tor.exe
      path.join(__dirname, '..', 'bin', platform, 'tor', torExe),
      path.join(__dirname, '..', '..', 'bin', platform, 'tor', torExe),
      path.join(__dirname, 'bin', platform, 'tor', torExe),
      // Alternative: direct in platform folder
      path.join(__dirname, '..', 'bin', platform, torExe),
      path.join(__dirname, '..', '..', 'bin', platform, torExe),
      // Development paths
      path.join(process.cwd(), 'bin', platform, 'tor', torExe),
      path.join(process.cwd(), 'node_modules', '@privacyrpc', 'sdk', 'bin', platform, 'tor', torExe),
      // System paths (fallback only)
      '/usr/bin/tor',
      '/usr/local/bin/tor',
      '/opt/homebrew/bin/tor',
      'C:\\Program Files\\Tor Browser\\Browser\\TorBrowser\\Tor\\tor.exe',
      'C:\\Program Files\\Tor\\tor.exe',
    ];

    for (const loc of locations) {
      try {
        if (fs.existsSync(loc)) {
          console.log(`[PrivacyRPC] Using embedded Tor: ${loc}`);
          return loc;
        }
      } catch {
        continue;
      }
    }

    // Check if tor is in PATH
    try {
      const which = isWindows ? 'where' : 'which';
      const { execSync } = require('child_process');
      const torPath = execSync(`${which} tor`, { encoding: 'utf8' }).trim().split('\n')[0];
      if (torPath) {
        console.log(`[PrivacyRPC] Using system Tor: ${torPath}`);
        return torPath;
      }
    } catch {
      // Not in PATH
    }

    throw new Error(
      'Tor binary not found. Run "npm run download-tor" to download the embedded Tor binary, ' +
      'or install Tor on your system.'
    );
  }

  /**
   * Find an available port
   */
  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        const port = addr.port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }
}

/**
 * Create a Tor-routed HTTP agent for fetch/axios
 */
export async function createTorAgent(torManager: TorManager): Promise<any> {
  if (!torManager.isBootstrapped) {
    throw new Error('Tor is not bootstrapped');
  }

  const { SocksProxyAgent } = await import('socks-proxy-agent');
  return new SocksProxyAgent(`socks5h://127.0.0.1:${torManager.socksPort}`);
}

export default TorManager;
