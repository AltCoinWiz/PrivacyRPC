/**
 * PrivacyRPC Background Service Worker
 *
 * Uses chrome.proxy API with PAC script for smart routing.
 * Only Solana RPC traffic goes through the proxy, everything else is direct.
 */

const NATIVE_HOST = 'com.privacyrpc.host';
let nativePort = null;
let pendingStatusResolve = null;

// ============================================================================
// NOTIFICATION HUB - Central notification management system
// ============================================================================

// Notification types and priorities
const NotificationTypes = {
  TOR_CONNECTED: { priority: 80, native: true, overlay: false },
  TOR_DISCONNECTED: { priority: 80, native: true, overlay: false },
  PROXY_ERROR: { priority: 100, native: true, overlay: true },
  PROTECTION_ON: { priority: 50, native: true, overlay: false },
  PROTECTION_OFF: { priority: 80, native: true, overlay: true },
  SUSPICIOUS_RPC: { priority: 100, native: true, overlay: true },
  EXT_WARNING: { priority: 80, native: true, overlay: true },
  UNPROTECTED_DAPP: { priority: 50, native: false, overlay: true },
  RPC_BLOCKED: { priority: 80, native: false, overlay: true }
};

// Default notification settings
const DEFAULT_NOTIFICATION_SETTINGS = {
  nativeNotificationsEnabled: true,
  overlayNotificationsEnabled: true,
  native: {
    torConnected: true,
    torDisconnected: true,
    proxyError: true,
    protectionStatusChange: true,
    suspiciousActivity: true,
    extensionWarning: true
  },
  overlay: {
    securityWarnings: true,
    rpcBlocked: true,
    suspiciousExtension: true,
    unprotectedWarning: true
  },
  throttling: {
    rpcActivityCooldown: 30000,
    proxyErrorCooldown: 60000,
    maxNotificationsPerMinute: 5
  }
};

// Notification Hub class
class NotificationHub {
  constructor() {
    this.settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
    this.lastNotifications = new Map(); // type -> timestamp
    this.notificationsThisMinute = [];
    this.loadSettings();
  }

  // Load settings from storage
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['notificationSettings']);
      if (result.notificationSettings) {
        this.settings = { ...DEFAULT_NOTIFICATION_SETTINGS, ...result.notificationSettings };
      }
    } catch (e) {
      console.error('[PrivacyRPC] Failed to load notification settings:', e);
    }
  }

  // Save settings to storage
  async saveSettings() {
    try {
      await chrome.storage.local.set({ notificationSettings: this.settings });
    } catch (e) {
      console.error('[PrivacyRPC] Failed to save notification settings:', e);
    }
  }

  // Update settings
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
  }

  // Check if notification should be throttled
  shouldThrottle(type) {
    const now = Date.now();

    // Clean old entries
    this.notificationsThisMinute = this.notificationsThisMinute.filter(
      t => now - t < 60000
    );

    // Check global rate limit
    if (this.notificationsThisMinute.length >= this.settings.throttling.maxNotificationsPerMinute) {
      console.log('[PrivacyRPC] Notification throttled: global rate limit');
      return true;
    }

    // Check type-specific cooldown
    const lastTime = this.lastNotifications.get(type) || 0;
    let cooldown = 0;

    if (type === 'SUSPICIOUS_RPC' || type === 'RPC_BLOCKED') {
      cooldown = this.settings.throttling.rpcActivityCooldown;
    } else if (type === 'PROXY_ERROR') {
      cooldown = this.settings.throttling.proxyErrorCooldown;
    }

    if (cooldown > 0 && now - lastTime < cooldown) {
      console.log(`[PrivacyRPC] Notification throttled: ${type} cooldown`);
      return true;
    }

    return false;
  }

  // Record notification sent
  recordNotification(type) {
    const now = Date.now();
    this.lastNotifications.set(type, now);
    this.notificationsThisMinute.push(now);
  }

  // Check if notification type is enabled
  isEnabled(type, channel) {
    const typeConfig = NotificationTypes[type];
    if (!typeConfig) return false;

    if (channel === 'native') {
      if (!this.settings.nativeNotificationsEnabled) return false;
      if (!typeConfig.native) return false;

      // Check specific settings
      switch (type) {
        case 'TOR_CONNECTED': return this.settings.native.torConnected;
        case 'TOR_DISCONNECTED': return this.settings.native.torDisconnected;
        case 'PROXY_ERROR': return this.settings.native.proxyError;
        case 'PROTECTION_ON':
        case 'PROTECTION_OFF': return this.settings.native.protectionStatusChange;
        case 'SUSPICIOUS_RPC': return this.settings.native.suspiciousActivity;
        case 'EXT_WARNING': return this.settings.native.extensionWarning;
        default: return true;
      }
    }

    if (channel === 'overlay') {
      if (!this.settings.overlayNotificationsEnabled) return false;
      if (!typeConfig.overlay) return false;

      // Check specific settings
      switch (type) {
        case 'PROXY_ERROR':
        case 'PROTECTION_OFF':
        case 'SUSPICIOUS_RPC': return this.settings.overlay.securityWarnings;
        case 'RPC_BLOCKED': return this.settings.overlay.rpcBlocked;
        case 'EXT_WARNING': return this.settings.overlay.suspiciousExtension;
        case 'UNPROTECTED_DAPP': return this.settings.overlay.unprotectedWarning;
        default: return true;
      }
    }

    return false;
  }

  // Main notification method
  async notify(notification) {
    const {
      type,
      title,
      message,
      priority = NotificationTypes[type]?.priority || 50,
      actions = [],
      tabId = null
    } = notification;

    // Check throttling
    if (this.shouldThrottle(type)) {
      return { throttled: true };
    }

    const results = { native: null, overlay: null };

    // Send native notification
    if (this.isEnabled(type, 'native')) {
      results.native = await this.sendNativeNotification({ type, title, message, priority });
    }

    // Send overlay notification
    if (this.isEnabled(type, 'overlay')) {
      results.overlay = await this.sendOverlayNotification({
        type, title, message, priority, actions, tabId
      });
    }

    // Record notification
    if (results.native || results.overlay) {
      this.recordNotification(type);
    }

    return results;
  }

  // Send Chrome native OS notification
  async sendNativeNotification({ type, title, message, priority }) {
    try {
      const notifId = `privacyrpc-${type}-${Date.now()}`;

      // Determine icon based on priority
      let iconUrl = 'icons/icon128.png';

      await chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl,
        title: title || 'PrivacyRPC',
        message: message || '',
        priority: priority >= 100 ? 2 : (priority >= 80 ? 1 : 0),
        requireInteraction: priority >= 100
      });

      console.log(`[PrivacyRPC] Native notification sent: ${type}`);
      return { success: true, id: notifId };
    } catch (e) {
      console.error('[PrivacyRPC] Failed to send native notification:', e);
      return { success: false, error: e.message };
    }
  }

  // Send overlay notification to content script
  async sendOverlayNotification({ type, title, message, priority, actions, tabId }) {
    try {
      // Get target tab(s)
      let tabs = [];
      if (tabId) {
        tabs = [{ id: tabId }];
      } else {
        // Get active tab in current window
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      }

      if (tabs.length === 0) {
        console.log('[PrivacyRPC] No active tab for overlay notification');
        return { success: false, error: 'No active tab' };
      }

      const targetTab = tabs[0];

      // Don't send to extension or chrome pages
      if (targetTab.url?.startsWith('chrome') || targetTab.url?.startsWith('moz')) {
        console.log('[PrivacyRPC] Cannot send overlay to browser page');
        return { success: false, error: 'Cannot send to browser page' };
      }

      // Send message to content script
      const response = await chrome.tabs.sendMessage(targetTab.id, {
        type: 'SHOW_OVERLAY_NOTIFICATION',
        notification: {
          id: `privacyrpc-${type}-${Date.now()}`,
          type,
          title,
          message,
          priority,
          actions,
          duration: priority >= 100 ? 0 : (priority >= 80 ? 8000 : 5000)
        }
      });

      console.log(`[PrivacyRPC] Overlay notification sent: ${type}`);
      return { success: true, ...response };
    } catch (e) {
      // Content script might not be loaded on this page
      console.log('[PrivacyRPC] Could not send overlay notification:', e.message);
      return { success: false, error: e.message };
    }
  }
}

// Create notification hub instance
const notificationHub = new NotificationHub();

// Connect to native messaging host
function connectNativeHost() {
  if (nativePort) return nativePort;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);

    nativePort.onMessage.addListener((msg) => {
      console.log('[PrivacyRPC] Native host:', msg);
      if (msg.status === 'started') {
        console.log('[PrivacyRPC] Proxy started on port', msg.port);
      } else if (msg.status === 'error') {
        console.error('[PrivacyRPC] Proxy error:', msg.error);
      }

      // Forward Tor/RPC status fields to popup
      if (msg.tor_enabled !== undefined || msg.tor_ip || msg.bootstrap_progress !== undefined || msg.rpc_provider !== undefined) {
        chrome.runtime.sendMessage({
          type: 'TOR_STATUS',
          connected: msg.tor_connected || (msg.tor_enabled && msg.tor_ip),
          ip: msg.tor_ip || null,
          torEnabled: msg.tor_enabled || false,
          bootstrapProgress: msg.bootstrap_progress || 0,
          rpcProvider: msg.rpc_provider || null
        }).catch(() => {}); // Ignore if popup not open
      }

      // Resolve pending status check if waiting
      if (pendingStatusResolve) {
        const resolve = pendingStatusResolve;
        pendingStatusResolve = null;
        resolve({ running: msg.running === true, status: msg.status });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      console.log('[PrivacyRPC] Native host disconnected');
      nativePort = null;
    });

    return nativePort;
  } catch (e) {
    console.error('[PrivacyRPC] Failed to connect native host:', e);
    return null;
  }
}

// Start proxy via native messaging
async function startProxyServer() {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'start' });
    return true;
  }
  return false;
}

// Stop proxy via native messaging
async function stopProxyServer() {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'stop' });
    return true;
  }
  return false;
}

// ============================================================================
// TOR / RPC CONTROL — Native messaging commands
// ============================================================================

// Enable Tor routing via native host -> desktop app
async function enableTor() {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'enable_tor' });
    return true;
  }
  return false;
}

// Disable Tor routing
async function disableTor() {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'disable_tor' });
    return true;
  }
  return false;
}

// Request a new Tor circuit (new exit IP)
async function newCircuit() {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'new_circuit' });
    return true;
  }
  return false;
}

// Set custom RPC provider URL
async function setRpcProvider(url) {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'set_rpc', rpc_url: url });
    return true;
  }
  return false;
}

// Clear custom RPC provider (revert to default)
async function clearRpcProvider() {
  const port = connectNativeHost();
  if (port) {
    port.postMessage({ action: 'clear_rpc' });
    return true;
  }
  return false;
}

// ZK Compression methods to track
const ZK_METHODS = [
  'getCompressedAccount', 'getCompressedAccountsByOwner', 'getCompressedBalance',
  'getCompressedBalanceByOwner', 'getCompressedTokenAccountBalance',
  'getCompressedTokenAccountsByOwner', 'getCompressedTokenAccountsByDelegate',
  'getCompressedTokenBalancesByOwner', 'getCompressedMintTokenHolders',
  'getValidityProof', 'getMultipleCompressedAccounts'
];

// Default configuration
const DEFAULT_CONFIG = {
  enabled: false,
  proxyHost: '127.0.0.1',
  proxyPort: 8899,
  proxyType: 'HTTP', // HTTP or SOCKS5
  proxyMode: 'proxy_only', // 'proxy_only' or 'private_rpc'
  rpcEndpoint: null, // User's private RPC endpoint (Helius, etc.)
  stats: {
    proxiedRequests: 0,
    lastActivity: null
  },
  zkStats: {
    compressedCalls: 0,
    regularCalls: 0,
    cacheHits: 0,
    estimatedSavings: 0
  }
};

// Domains to route through proxy (Solana RPC endpoints)
const PROXY_DOMAINS = [
  // Solana official
  'api.mainnet-beta.solana.com',
  'api.devnet.solana.com',
  'api.testnet.solana.com',

  // Helius
  '*.helius-rpc.com',
  '*.helius.xyz',
  'rpc.helius.xyz',
  'mainnet.helius-rpc.com',
  'devnet.helius-rpc.com',

  // Alchemy
  '*.alchemy.com',
  'solana-mainnet.g.alchemy.com',
  'solana-devnet.g.alchemy.com',

  // QuickNode
  '*.quiknode.pro',
  'solana-mainnet.quiknode.pro',
  'solana-devnet.quiknode.pro',

  // GenesysGo
  '*.genesysgo.net',

  // RPCPool
  '*.rpcpool.com',

  // Triton
  '*.triton.one',

  // Ankr
  'rpc.ankr.com',

  // GetBlock
  '*.getblock.io',

  // Syndica
  '*.syndica.io',

  // Extrnode
  '*.extrnode.com',

  // Blockdaemon
  '*.blockdaemon.com',

  // Chainstack
  '*.chainstack.com',

  // Jito (MEV)
  '*.jito.wtf',
  '*.block-engine.jito.wtf',
  'mainnet.block-engine.jito.wtf',

  // Astralane (Axiom uses this)
  '*.astralane.io',
  '*.gateway.astralane.io',

  // Shyft
  '*.shyft.to',

  // Solana FM
  '*.solana.fm',

  // Jupiter
  '*.jup.ag',

  // Generic RPC patterns
  '*.solana-rpc.com',
  '*.solana.com',
];

// Current state
let config = { ...DEFAULT_CONFIG };

// Generate PAC script for smart routing
function generatePacScript() {
  const proxyString = config.proxyType === 'SOCKS5'
    ? `SOCKS5 ${config.proxyHost}:${config.proxyPort}; SOCKS ${config.proxyHost}:${config.proxyPort}`
    : `PROXY ${config.proxyHost}:${config.proxyPort}`;

  // Build domain matching conditions
  const domainConditions = PROXY_DOMAINS.map(domain => {
    if (domain.startsWith('*.')) {
      // Wildcard domain
      const baseDomain = domain.slice(2);
      return `dnsDomainIs(host, "${baseDomain}") || shExpMatch(host, "${domain}")`;
    } else {
      return `host === "${domain}"`;
    }
  }).join(' ||\n      ');

  return `
function FindProxyForURL(url, host) {
  // Only proxy HTTP and HTTPS
  if (url.substring(0, 5) !== "http:" && url.substring(0, 6) !== "https:") {
    return "DIRECT";
  }

  // Never proxy localhost
  if (host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      shExpMatch(host, "192.168.*.*") ||
      shExpMatch(host, "10.*.*.*")) {
    return "DIRECT";
  }

  // HYBRID DETECTION: Pattern-based RPC detection
  // Catch ANY domain that looks like an RPC endpoint
  var hostLower = host.toLowerCase();

  // Pattern 1: Contains "rpc" anywhere in domain
  if (hostLower.indexOf("rpc") !== -1) {
    return "${proxyString}";
  }

  // Pattern 2: Contains "solana" anywhere in domain
  if (hostLower.indexOf("solana") !== -1) {
    return "${proxyString}";
  }

  // Pattern 3: Known RPC provider patterns
  if (hostLower.indexOf("helius") !== -1 ||
      hostLower.indexOf("alchemy") !== -1 ||
      hostLower.indexOf("quicknode") !== -1 ||
      hostLower.indexOf("quiknode") !== -1 ||
      hostLower.indexOf("triton") !== -1 ||
      hostLower.indexOf("syndica") !== -1 ||
      hostLower.indexOf("ankr") !== -1 ||
      hostLower.indexOf("getblock") !== -1 ||
      hostLower.indexOf("chainstack") !== -1 ||
      hostLower.indexOf("blockdaemon") !== -1 ||
      hostLower.indexOf("genesysgo") !== -1 ||
      hostLower.indexOf("jito") !== -1 ||
      hostLower.indexOf("astralane") !== -1 ||
      hostLower.indexOf("shyft") !== -1 ||
      hostLower.indexOf("extrnode") !== -1 ||
      hostLower.indexOf("axiom") !== -1) {
    return "${proxyString}";
  }

  // Pattern 4: Common RPC URL patterns
  if (hostLower.indexOf("mainnet") !== -1 ||
      hostLower.indexOf("devnet") !== -1 ||
      hostLower.indexOf("testnet") !== -1) {
    return "${proxyString}";
  }

  // Pattern 5: Block engine / MEV patterns
  if (hostLower.indexOf("block-engine") !== -1 ||
      hostLower.indexOf("blockengine") !== -1 ||
      hostLower.indexOf("mev") !== -1) {
    return "${proxyString}";
  }

  // Pattern 6: Gateway patterns (many RPCs use this)
  if (hostLower.indexOf("gateway") !== -1 &&
      (hostLower.indexOf("solana") !== -1 ||
       hostLower.indexOf("web3") !== -1 ||
       hostLower.indexOf("crypto") !== -1)) {
    return "${proxyString}";
  }

  // Pattern 7: Solana trading/DeFi platforms (they make RPC calls)
  if (hostLower.indexOf("jupiter") !== -1 ||
      hostLower.indexOf("raydium") !== -1 ||
      hostLower.indexOf("orca") !== -1 ||
      hostLower.indexOf("photon") !== -1 ||
      hostLower.indexOf("pump.fun") !== -1 ||
      hostLower.indexOf("pumpfun") !== -1 ||
      hostLower.indexOf("birdeye") !== -1 ||
      hostLower.indexOf("dexscreener") !== -1 ||
      hostLower.indexOf("tensor") !== -1 ||
      hostLower.indexOf("magiceden") !== -1 ||
      hostLower.indexOf("phantom") !== -1 ||
      hostLower.indexOf("solflare") !== -1 ||
      hostLower.indexOf("backpack") !== -1 ||
      hostLower.indexOf("bonk") !== -1 ||
      hostLower.indexOf("marinade") !== -1 ||
      hostLower.indexOf("meteora") !== -1 ||
      hostLower.indexOf("kamino") !== -1 ||
      hostLower.indexOf("drift") !== -1 ||
      hostLower.indexOf("mango") !== -1 ||
      hostLower.indexOf("marginfi") !== -1 ||
      hostLower.indexOf("sanctum") !== -1 ||
      hostLower.indexOf("jup.ag") !== -1 ||
      hostLower.indexOf("bullx") !== -1 ||
      hostLower.indexOf("trojan") !== -1 ||
      hostLower.indexOf("pepe") !== -1 ||
      hostLower.indexOf("bonkbot") !== -1 ||
      hostLower.indexOf("sol-") !== -1 ||
      hostLower.indexOf("-sol") !== -1) {
    return "${proxyString}";
  }

  // Pattern 8: API subdomains (aggressive - catches most backends)
  if (hostLower.indexOf("api.") === 0 ||
      hostLower.indexOf("api1.") === 0 ||
      hostLower.indexOf("api2.") === 0 ||
      hostLower.indexOf("api3.") === 0 ||
      hostLower.indexOf("api4.") === 0 ||
      hostLower.indexOf("api5.") === 0 ||
      hostLower.indexOf("api6.") === 0 ||
      hostLower.indexOf("api7.") === 0 ||
      hostLower.indexOf("api8.") === 0 ||
      hostLower.indexOf("api9.") === 0 ||
      hostLower.indexOf(".api.") !== -1) {
    return "${proxyString}";
  }

  // Explicit domain list (fallback)
  if (${domainConditions}) {
    return "${proxyString}";
  }

  // Everything else goes direct
  return "DIRECT";
}
`;
}

// Apply proxy settings
async function applyProxySettings() {
  if (config.enabled) {
    const pacScript = generatePacScript();

    try {
      await chrome.proxy.settings.set({
        value: {
          mode: 'pac_script',
          pacScript: {
            data: pacScript
          }
        },
        scope: 'regular'
      });

      console.log('[PrivacyRPC] Proxy enabled with PAC script');
      updateBadge(true);
    } catch (error) {
      console.error('[PrivacyRPC] Failed to set proxy:', error);
      updateBadge(false, 'ERR');
    }
  } else {
    try {
      await chrome.proxy.settings.clear({ scope: 'regular' });
      console.log('[PrivacyRPC] Proxy disabled');
      updateBadge(false);
    } catch (error) {
      console.error('[PrivacyRPC] Failed to clear proxy:', error);
    }
  }
}

// Update badge - disabled for clean look
function updateBadge(enabled, text = null) {
  // Clear badge - we don't want text on the icon
  chrome.action.setBadgeText({ text: '' });
}

// Load config from storage
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['privacyrpcConfig']);
    if (result.privacyrpcConfig) {
      config = { ...DEFAULT_CONFIG, ...result.privacyrpcConfig };
    }
  } catch (error) {
    console.error('[PrivacyRPC] Failed to load config:', error);
  }
}

// Save config to storage
async function saveConfig() {
  try {
    await chrome.storage.local.set({ privacyrpcConfig: config });
  } catch (error) {
    console.error('[PrivacyRPC] Failed to save config:', error);
  }
}

// Check if proxy is running
async function checkProxyHealth() {
  // Check proxy health via HTTP fetch to /config endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`http://${config.proxyHost}:${config.proxyPort}/config`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      return { running: true, status: 'running', ...data };
    } else {
      return { running: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return { running: false, error: 'Timeout' };
    }
    return { running: false, error: error.message };
  }
}

// Fetch config from proxy server (mode, RPC endpoint, etc.)
async function fetchProxyConfig() {
  try {
    const response = await fetch(`http://${config.proxyHost}:${config.proxyPort}/config`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (response.ok) {
      const proxyConfig = await response.json();

      // Update our config with proxy settings
      config.proxyMode = proxyConfig.mode || 'proxy_only';
      config.rpcEndpoint = proxyConfig.rpcEndpoint || null;

      console.log('[PrivacyRPC] Proxy config:', proxyConfig);

      // Notify popup of config change
      chrome.runtime.sendMessage({
        type: 'CONFIG_UPDATED',
        data: {
          mode: config.proxyMode,
          rpcEndpoint: config.rpcEndpoint
        }
      }).catch(() => {}); // Ignore if popup not open

      return proxyConfig;
    }
  } catch (e) {
    console.log('[PrivacyRPC] Could not fetch proxy config:', e.message);
  }
  return null;
}

// Known wallet extension IDs
const WALLET_EXTENSIONS = {
  // Phantom
  'bfnaelmomeimhlpmgjnjophhpkkoljpa': { name: 'Phantom', type: 'wallet' },
  'gojhcdgcpbpfigcaejpfhfegekdlneif': { name: 'Phantom (Dev)', type: 'wallet' },
  // Backpack - multiple known IDs
  'aflkmfhebedbjioipglgcbcmnbpgliof': { name: 'Backpack', type: 'wallet' },
  'jnlgamecbpmbajjfhmmmlhejkemejdma': { name: 'Backpack', type: 'wallet' },
  'flpiciilemghbmfalicajoolhkkenfe': { name: 'Backpack (Dev)', type: 'wallet' },
  // Solflare
  'bhhhlbepdkbapadjdnnojkbgioiodbic': { name: 'Solflare', type: 'wallet' },
  // MetaMask
  'nkbihfbeogaeaoehlefnkodbefgpgknn': { name: 'MetaMask', type: 'wallet' },
  'ejbalbakoplchlghecdalmeeeajnimhm': { name: 'MetaMask (Edge)', type: 'wallet' },
  // OKX
  'mcohilncbfahbmgdjkbpemcciiolgcge': { name: 'OKX Wallet', type: 'wallet' },
  // Binance
  'fhbohimaelbohpjbbldcngcnapndodjp': { name: 'Binance Wallet', type: 'wallet' },
  // Glow
  'cfadjkfokiepapnlpbpdmaeajnhheghf': { name: 'Glow', type: 'wallet' },
  // Coinbase
  'dlcobpjiigpikoobohmabehhmhfoodbb': { name: 'Coinbase Wallet', type: 'wallet' },
  'hnfanknocfeofbddgcijnmhnfnkdnaad': { name: 'Coinbase Wallet (Dev)', type: 'wallet' },
  // Slope
  'pocmplpaccanhmnllbbkpgfliimjljgo': { name: 'Slope', type: 'wallet' },
  // Torus
  'phkbamefinggmakgklpkljjmgibohnba': { name: 'Torus', type: 'wallet' },
  // Trust Wallet
  'ibnejdfjmmkpcnlpebklmnkoeoihofec': { name: 'Trust Wallet', type: 'wallet' },
  'egjidjbpglichdcondbcbdnbeeppgdph': { name: 'Trust Wallet', type: 'wallet' },
  // ONTO
  'cgeeodpfagjceefieflmdfphplkenlfk': { name: 'ONTO Wallet', type: 'wallet' },
  // Cyano
  'dkdedlpgdmmkkfjabffeganieamfklkm': { name: 'Cyano Wallet', type: 'wallet' },
  // xDefi
  'hmeobnfnfcmdkdcmlblgagmfpfboieaf': { name: 'xDefi', type: 'wallet' },
  // Exodus
  'aholpfdialjgjfhomihkjbmgjidlcdno': { name: 'Exodus', type: 'wallet' },
  // Station (Terra)
  'aiifbnbfobpmeekipheeijimdpnlpgpp': { name: 'Station Wallet', type: 'wallet' },
  // Ronin
  'fnjhmkhhmkbjkkabndcnnogagogbneec': { name: 'Ronin Wallet', type: 'wallet' },
  // Rabby
  'acmacodkjbdgmoleebolmdjonilkdbch': { name: 'Rabby Wallet', type: 'wallet' },
  // Brave Wallet (built-in, but can be detected)
  'odbfpeeihdkbihmopkbjmoonfanlbfcl': { name: 'Brave Wallet', type: 'wallet' },
  // Keplr (Cosmos)
  'dmkamcknogkgcdfhhbddcghachkejeap': { name: 'Keplr', type: 'wallet' },
  // Leap (Cosmos)
  'fcfcfllfndlomdhbehjjcoimbgofdncg': { name: 'Leap Wallet', type: 'wallet' },
  // Magic Eden
  'mkpegjkblkkefacfnmkajcjmabijhclg': { name: 'Magic Eden Wallet', type: 'wallet' },
  // Tiplink
  'gfkepgoophebjcgfkfgjbdkfgfcndbag': { name: 'TipLink Wallet', type: 'wallet' }
};

// Get ALL installed extensions
async function getInstalledExtensions() {
  try {
    const extensions = await chrome.management.getAll();
    const walletExtensions = [];
    const otherExtensions = [];

    for (const ext of extensions) {
      if (!ext.enabled) continue;
      if (ext.id === chrome.runtime.id) continue; // Skip self
      if (ext.type !== 'extension') continue; // Skip themes, apps, etc.

      const knownWallet = WALLET_EXTENSIONS[ext.id];
      const isWalletByName = ext.name.toLowerCase().includes('wallet') ||
                             ext.name.toLowerCase().includes('phantom') ||
                             ext.name.toLowerCase().includes('solana') ||
                             ext.name.toLowerCase().includes('crypto') ||
                             ext.name.toLowerCase().includes('backpack') ||
                             ext.name.toLowerCase().includes('solflare') ||
                             ext.name.toLowerCase().includes('metamask') ||
                             ext.name.toLowerCase().includes('coinbase') ||
                             ext.name.toLowerCase().includes('trust') ||
                             ext.name.toLowerCase().includes('ledger') ||
                             ext.name.toLowerCase().includes('trezor') ||
                             ext.name.toLowerCase().includes('defi') ||
                             ext.name.toLowerCase().includes('ethereum') ||
                             ext.name.toLowerCase().includes('web3');

      const extData = {
        id: ext.id,
        name: knownWallet ? knownWallet.name : ext.name,
        type: (knownWallet || isWalletByName) ? 'wallet' : 'other',
        icon: ext.icons && ext.icons.length > 0 ? ext.icons[ext.icons.length - 1].url : null,
        version: ext.version,
        description: ext.description ? ext.description.substring(0, 100) : '',
        permissions: ext.permissions || [],
        hostPermissions: ext.hostPermissions || []
      };

      // Check if extension has suspicious permissions (access to all URLs)
      const hasBroadAccess = (ext.hostPermissions || []).some(p =>
        p === '<all_urls>' || p === '*://*/*' || p === 'http://*/*' || p === 'https://*/*'
      );
      extData.hasBroadAccess = hasBroadAccess;

      if (knownWallet || isWalletByName) {
        walletExtensions.push(extData);
      } else {
        otherExtensions.push(extData);
      }
    }

    // Sort: wallets first, then others. Within each group, sort by name
    walletExtensions.sort((a, b) => a.name.localeCompare(b.name));
    otherExtensions.sort((a, b) => a.name.localeCompare(b.name));

    return {
      wallets: walletExtensions,
      others: otherExtensions,
      all: [...walletExtensions, ...otherExtensions],
      totalWallets: walletExtensions.length,
      totalOthers: otherExtensions.length,
      total: walletExtensions.length + otherExtensions.length
    };
  } catch (e) {
    console.error('[PrivacyRPC] Failed to get extensions:', e);
    return { wallets: [], others: [], all: [], total: 0 };
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_CONFIG':
      sendResponse(config);
      break;

    case 'GET_EXTENSIONS':
      getInstalledExtensions().then(result => {
        sendResponse(result);
      });
      return true; // Keep channel open for async

    case 'SET_ENABLED':
      config.enabled = message.enabled;
      saveConfig();

      // Start or stop the proxy server via native messaging
      if (config.enabled) {
        startProxyServer();
        // Send protection enabled notification
        notificationHub.notify({
          type: 'PROTECTION_ON',
          title: 'Protection Enabled',
          message: 'Your RPC traffic is now being routed through the secure proxy'
        });
      } else {
        stopProxyServer();
        // Send protection disabled notification
        notificationHub.notify({
          type: 'PROTECTION_OFF',
          title: 'Protection Disabled',
          message: 'Your RPC traffic is no longer protected',
          actions: [
            { label: 'Re-enable', action: 'enable_protection' },
            { label: 'Dismiss', action: 'dismiss' }
          ]
        });
      }

      applyProxySettings();
      sendResponse({ success: true });
      break;

    case 'SET_AUTO_BLOCK':
      chrome.storage.local.set({ autoBlockEnabled: message.enabled });
      sendResponse({ success: true });
      break;

    case 'GET_AUTO_BLOCK':
      chrome.storage.local.get(['autoBlockEnabled'], (result) => {
        sendResponse({ enabled: result.autoBlockEnabled || false });
      });
      return true;

    case 'START_PROXY':
      startProxyServer().then(result => {
        sendResponse({ success: result });
      });
      return true;

    case 'STOP_PROXY':
      stopProxyServer().then(result => {
        sendResponse({ success: result });
      });
      return true;

    case 'SET_PROXY_TYPE':
      config.proxyType = message.proxyType;
      saveConfig();
      if (config.enabled) {
        applyProxySettings();
      }
      sendResponse({ success: true });
      break;

    case 'SET_PROXY_ADDRESS':
      config.proxyHost = message.host || config.proxyHost;
      config.proxyPort = message.port || config.proxyPort;
      saveConfig();
      if (config.enabled) {
        applyProxySettings();
      }
      sendResponse({ success: true });
      break;

    case 'START_TOR':
      enableTor().then(result => {
        sendResponse({ success: result });
      });
      return true;

    case 'STOP_TOR':
      disableTor().then(result => {
        sendResponse({ success: result });
      });
      return true;

    case 'NEW_CIRCUIT':
      newCircuit().then(result => {
        sendResponse({ success: result });
      });
      return true;

    case 'SET_RPC_PROVIDER':
      if (message.url) {
        setRpcProvider(message.url).then(result => {
          sendResponse({ success: result });
        });
      } else {
        clearRpcProvider().then(result => {
          sendResponse({ success: result });
        });
      }
      return true;

    case 'CHECK_PROXY':
      checkProxyHealth().then(result => {
        sendResponse(result);
      });
      return true; // Keep channel open for async response

    case 'GET_PROXY_CONFIG':
      fetchProxyConfig().then(result => {
        sendResponse({
          mode: config.proxyMode,
          rpcEndpoint: config.rpcEndpoint,
          ...result
        });
      });
      return true; // Keep channel open for async response

    case 'GET_PAC_SCRIPT':
      sendResponse({ pacScript: generatePacScript() });
      break;

    case 'GET_PROXY_DOMAINS':
      sendResponse({ domains: PROXY_DOMAINS });
      break;

    case 'GET_ZK_STATS':
      sendResponse(config.zkStats || DEFAULT_CONFIG.zkStats);
      break;

    case 'GET_TAB_ACTIVITY':
      const activity = tabActivity.get(message.tabId) || { rpcCalls: 0 };
      sendResponse(activity);
      break;

    case 'GET_CURRENT_TAB_INFO':
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab) {
          const tabAct = tabActivity.get(tab.id) || { rpcCalls: 0 };
          sendResponse({
            tabId: tab.id,
            url: tab.url,
            title: tab.title,
            rpcCalls: tabAct.rpcCalls || 0,
            lastEndpoint: tabAct.lastEndpoint || null,
            lastActivity: tabAct.lastActivity || null
          });
        } else {
          sendResponse(null);
        }
      });
      return true; // Keep channel open for async

    case 'GET_ALL_TAB_ACTIVITY':
      // Return all tab activity data
      const allActivity = {};
      tabActivity.forEach((value, key) => {
        allActivity[key] = value;
      });
      sendResponse({
        activity: allActivity,
        totalRequests: config.stats.proxiedRequests,
        lastActivity: config.stats.lastActivity
      });
      break;

    // Notification settings handlers
    case 'GET_NOTIFICATION_SETTINGS':
      sendResponse(notificationHub.settings);
      break;

    case 'SET_NOTIFICATION_SETTINGS':
      notificationHub.updateSettings(message.settings);
      sendResponse({ success: true });
      break;

    case 'NOTIFICATION_ACTION':
      // Handle notification action clicks from content script
      handleNotificationAction(message.notificationId, message.action);
      sendResponse({ success: true });
      break;

    case 'TEST_NOTIFICATION':
      // Test notification for debugging
      notificationHub.notify({
        type: message.notificationType || 'PROTECTION_ON',
        title: message.title || 'Test Notification',
        message: message.message || 'This is a test notification',
        actions: message.actions || []
      }).then(result => {
        sendResponse(result);
      });
      return true; // Keep channel open for async

    case 'SHOW_TX_OVERLAY_REQUEST':
      // Request to show transaction overlay from a page
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab) {
          try {
            const response = await chrome.tabs.sendMessage(tab.id, {
              type: 'SHOW_DECODED_TX',
              decoded: message.decoded
            });
            sendResponse(response);
          } catch (e) {
            sendResponse({ error: e.message });
          }
        } else {
          sendResponse({ error: 'No active tab' });
        }
      });
      return true; // Keep channel open for async

    case 'DECODE_TRANSACTION':
      // Decode a transaction via the proxy
      fetch(`http://${config.proxyHost}:${config.proxyPort}/decode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: message.transaction })
      })
        .then(r => r.json())
        .then(result => sendResponse(result))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true; // Keep channel open for async
  }
});

// Handle notification action clicks
function handleNotificationAction(notificationId, action) {
  console.log(`[PrivacyRPC] Notification action: ${action} from ${notificationId}`);

  switch (action) {
    case 'enable_protection':
      config.enabled = true;
      saveConfig();
      startProxyServer();
      applyProxySettings();
      break;
    case 'disable_protection':
      config.enabled = false;
      saveConfig();
      stopProxyServer();
      applyProxySettings();
      break;
    case 'open_settings':
      chrome.action.openPopup();
      break;
    case 'dismiss':
      // Just close the notification
      break;
  }
}

// Listen for proxy errors
chrome.proxy.onProxyError.addListener((details) => {
  console.error('[PrivacyRPC] Proxy error:', details);
  config.stats.lastActivity = {
    type: 'error',
    message: details.error,
    timestamp: Date.now()
  };
  saveConfig();

  // Send notification for proxy error
  notificationHub.notify({
    type: 'PROXY_ERROR',
    title: 'Proxy Connection Error',
    message: details.error || 'Failed to connect to the proxy server',
    actions: [
      { label: 'Open Settings', action: 'open_settings' },
      { label: 'Dismiss', action: 'dismiss' }
    ]
  });
});

// Check if URL is a Solana RPC endpoint
function isRpcUrl(urlString) {
  try {
    const url = new URL(urlString);

    // Check against known proxy domains
    const matchesDomain = PROXY_DOMAINS.some(domain => {
      if (domain.startsWith('*.')) {
        return url.hostname.endsWith(domain.slice(1)) || url.hostname === domain.slice(2);
      }
      return url.hostname === domain;
    });

    if (matchesDomain) return true;

    // Also detect RPC calls by common patterns in URL or if it's a POST to a JSON-RPC endpoint
    const rpcPatterns = [
      /solana/i,
      /helius/i,
      /alchemy/i,
      /quicknode/i,
      /quiknode/i,
      /rpc\./i,
      /\.rpc\./i,
      /mainnet/i,
      /devnet/i,
      /testnet/i
    ];

    return rpcPatterns.some(pattern => pattern.test(url.hostname));
  } catch (e) {
    return false;
  }
}

// Monitor web requests (for stats) - detect both RPC endpoints and JSON-RPC requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Skip extension and chrome URLs
    if (details.url.startsWith('chrome') || details.url.startsWith('moz')) {
      return;
    }

    const isRpc = isRpcUrl(details.url);

    // Also check if this looks like a JSON-RPC call (POST with JSON body to any URL)
    let isJsonRpc = false;
    if (details.method === 'POST' && details.requestBody) {
      try {
        // Check if body contains JSON-RPC patterns
        if (details.requestBody.raw) {
          const decoder = new TextDecoder();
          const body = decoder.decode(details.requestBody.raw[0].bytes);
          if (body.includes('jsonrpc') || body.includes('getBalance') ||
              body.includes('getAccountInfo') || body.includes('sendTransaction') ||
              body.includes('simulateTransaction') || body.includes('getRecentBlockhash') ||
              body.includes('getLatestBlockhash') || body.includes('getSignatureStatuses')) {
            isJsonRpc = true;
          }
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }

    if (isRpc || isJsonRpc) {
      const url = new URL(details.url);

      config.stats.proxiedRequests++;
      config.stats.lastActivity = {
        type: 'request',
        url: details.url,
        timestamp: Date.now()
      };

      // Track per-tab activity
      if (details.tabId && details.tabId > 0) {
        const activity = tabActivity.get(details.tabId) || { rpcCalls: 0, url: '' };
        activity.rpcCalls++;
        activity.lastActivity = Date.now();
        activity.lastEndpoint = url.hostname;
        tabActivity.set(details.tabId, activity);
      }

      // Check if it's a ZK Compression method (based on URL patterns)
      const isZkCall = url.pathname.includes('compressed') ||
                       url.searchParams.has('compressed');
      if (isZkCall) {
        config.zkStats = config.zkStats || { compressedCalls: 0, regularCalls: 0, cacheHits: 0, estimatedSavings: 0 };
        config.zkStats.compressedCalls++;
        config.zkStats.estimatedSavings += 1000; // Estimate
      }

      // Send activity to popup
      chrome.runtime.sendMessage({
        type: 'RPC_ACTIVITY',
        data: {
          method: isJsonRpc ? 'JSON-RPC' : 'RPC',
          url: url.hostname + url.pathname.substring(0, 30),
          success: true,
          timestamp: Date.now(),
          proxied: config.enabled,
          tabId: details.tabId,
          isZk: isZkCall
        }
      }).catch(() => {}); // Ignore if popup not open

      // Check for suspicious RPC patterns (high frequency from same tab)
      if (details.tabId && details.tabId > 0) {
        const activity = tabActivity.get(details.tabId);
        if (activity && activity.rpcCalls > 50) {
          // High RPC call frequency - might be suspicious
          notificationHub.notify({
            type: 'SUSPICIOUS_RPC',
            title: 'High RPC Activity Detected',
            message: `${activity.rpcCalls} RPC calls from ${url.hostname}`,
            tabId: details.tabId,
            actions: [
              { label: 'View Details', action: 'open_settings' },
              { label: 'Dismiss', action: 'dismiss' }
            ]
          });
        }
      }

      // Notify if RPC detected but protection is off
      if (!config.enabled && details.tabId > 0) {
        notificationHub.notify({
          type: 'UNPROTECTED_DAPP',
          title: 'Unprotected dApp Detected',
          message: `RPC calls to ${url.hostname} are not protected`,
          tabId: details.tabId,
          actions: [
            { label: 'Enable Protection', action: 'enable_protection' },
            { label: 'Dismiss', action: 'dismiss' }
          ]
        });
      }

      console.log('[PrivacyRPC] RPC detected:', url.hostname, config.enabled ? '(proxied)' : '(direct)');
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

// Track RPC activity per tab
const tabActivity = new Map();

// Initialize on startup
async function initialize() {
  // Clear any badge on startup - we want clean icon
  chrome.action.setBadgeText({ text: '' });

  // Enable side panel
  try {
    await chrome.sidePanel.setOptions({
      enabled: true
    });
  } catch (e) {
    console.log('[PrivacyRPC] Side panel not available');
  }

  await loadConfig();
  await applyProxySettings();

  // Fetch proxy config if enabled
  if (config.enabled) {
    await fetchProxyConfig();
  }

  console.log('[PrivacyRPC] Extension initialized, enabled:', config.enabled, 'mode:', config.proxyMode);
}

// Listen for tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  notifyPopupTabChange(tab);
});

// Listen for URL changes within a tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    notifyPopupTabChange(tab);
    // Reset activity for this tab on navigation
    if (changeInfo.url) {
      tabActivity.set(tabId, {
        url: changeInfo.url,
        rpcCalls: 0,
        lastActivity: null
      });
    }
  }
});

// Notify popup of tab change
function notifyPopupTabChange(tab) {
  if (tab && tab.url) {
    const activity = tabActivity.get(tab.id) || { rpcCalls: 0 };
    chrome.runtime.sendMessage({
      type: 'TAB_CHANGED',
      data: {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        rpcCalls: activity.rpcCalls
      }
    }).catch(() => {}); // Ignore if popup not open
  }
}

initialize();

// Periodic health check
chrome.alarms.create('healthCheck', { periodInMinutes: 1 });
let lastProxyStatus = null; // Track last known status to avoid repeat notifications

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheck' && config.enabled) {
    const health = await checkProxyHealth();
    const currentStatus = health.running;

    // Only notify if status changed from running to not running
    if (lastProxyStatus === true && currentStatus === false) {
      console.warn('[PrivacyRPC] Proxy went offline');
      notificationHub.notify({
        type: 'PROXY_ERROR',
        title: 'Proxy Offline',
        message: 'The proxy server is not responding. Your RPC traffic may not be protected.',
        actions: [
          { label: 'Open Settings', action: 'open_settings' },
          { label: 'Dismiss', action: 'dismiss' }
        ]
      });
    }

    lastProxyStatus = currentStatus;

    // Also fetch proxy config to check mode/endpoint
    if (currentStatus) {
      await fetchProxyConfig();
    }
  }
});
