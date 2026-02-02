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

// Broadcast message to all tabs (for proxy status changes)
async function broadcastToAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && !tab.url?.startsWith('chrome')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

// Connect to native messaging host
function connectNativeHost() {
  if (nativePort) return nativePort;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);

    nativePort.onMessage.addListener((msg) => {
      if (msg.status === 'started') {
        // Proxy started
      } else if (msg.status === 'error') {
        // Proxy error
      }

      // Forward Tor/RPC status fields to popup and update config
      if (msg.tor_enabled !== undefined || msg.tor_ip || msg.bootstrap_progress !== undefined || msg.rpc_provider !== undefined) {
        config.torEnabled = msg.tor_enabled || false;
        config.torConnected = msg.tor_connected || (msg.tor_enabled && !!msg.tor_ip);
        config.torIp = msg.tor_ip || null;

        chrome.runtime.sendMessage({
          type: 'TOR_STATUS',
          connected: config.torConnected,
          ip: config.torIp,
          torEnabled: config.torEnabled,
          bootstrapProgress: msg.bootstrap_progress || 0,
          rpcProvider: msg.rpc_provider || null
        }).catch(() => {}); // Ignore if popup not open

        // Update icon to reflect new status
        updateIcon();
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
  torEnabled: false,
  torConnected: false,
  torIp: null,
  trustedSites: [], // Sites where drainer warnings are suppressed
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
// NOTE: PAC proxy is DISABLED - we use fetch/XHR interception instead.
// PAC causes issues:
// 1. Routes WebSocket handshakes through proxy, breaking WebSockets
// 2. HTTPS CONNECT tunnels go to original destination, not Helius
// The injected.js handles RPC routing via fetch/XHR interception which works correctly.
async function applyProxySettings() {
  // Always clear PAC proxy - we rely on fetch/XHR interception now
  try {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    console.log('[PrivacyRPC] PAC proxy cleared (using fetch/XHR interception instead)');
    updateBadge(config.enabled);
  } catch (error) {
    console.error('[PrivacyRPC] Failed to clear proxy:', error);
  }
}

// Update icon with status dots
async function updateIcon() {
  try {
    const size = 128;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Load base icon
    try {
      const response = await fetch(chrome.runtime.getURL('icons/icon128.png'));
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, 0, 0, size, size);
    } catch (e) {
      // Fallback: draw a simple shield shape
      ctx.fillStyle = '#1E2328';
      ctx.fillRect(0, 0, size, size);
    }

    // Draw status dots in bottom-right corner (order: PROXY → TOR → RPC)
    // All dots use teal color (#5AF5F5) when active
    const dotSize = 20;
    const spacing = 22;
    const startX = size - 75;
    const startY = size - 22;

    // Proxy dot - first dot
    if (config.enabled) {
      ctx.beginPath();
      ctx.arc(startX, startY, dotSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#5AF5F5';
      ctx.fill();
    }

    // Tor dot - second dot
    if (config.torConnected) {
      ctx.beginPath();
      ctx.arc(startX + spacing, startY, dotSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#5AF5F5';
      ctx.fill();
    } else if (config.torEnabled) {
      // Connecting - yellow dot
      ctx.beginPath();
      ctx.arc(startX + spacing, startY, dotSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#FFB800';
      ctx.fill();
    }

    // RPC dot - third dot
    if (config.proxyMode === 'private_rpc' && config.rpcEndpoint) {
      ctx.beginPath();
      ctx.arc(startX + spacing * 2, startY, dotSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = '#5AF5F5';
      ctx.fill();
    }

    // Convert to ImageData and set as icon
    const imageData = ctx.getImageData(0, 0, size, size);
    await chrome.action.setIcon({ imageData: { 128: imageData } });
  } catch (e) {
    // Icon update failed - not critical, don't crash
  }
}

// Update badge - disabled for clean look
function updateBadge(enabled, text = null) {
  // Clear badge text
  chrome.action.setBadgeText({ text: '' });
  // Update icon with status dots
  updateIcon();
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`http://${config.proxyHost}:${config.proxyPort}/config`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (response.ok) {
      const proxyConfig = await response.json();

      // Update our config with all proxy settings
      config.proxyMode = proxyConfig.mode || 'proxy_only';
      config.rpcEndpoint = proxyConfig.rpcEndpoint || null;
      config.torEnabled = proxyConfig.torEnabled || false;
      config.torConnected = proxyConfig.torConnected || false;
      config.torIp = proxyConfig.torIp || null;

      // Update icon to reflect current mode
      updateIcon();

      // Notify popup of config change
      chrome.runtime.sendMessage({
        type: 'CONFIG_UPDATED',
        data: {
          mode: config.proxyMode,
          rpcEndpoint: config.rpcEndpoint,
          torEnabled: config.torEnabled,
          torConnected: config.torConnected,
          torIp: config.torIp
        }
      }).catch(() => {});

      return proxyConfig;
    }
  } catch (e) {
    // Proxy not running - clear Tor status to avoid showing stale data
    config.torEnabled = false;
    config.torConnected = false;
    config.torIp = null;
    updateIcon();

    // Notify popup that Tor is disconnected
    chrome.runtime.sendMessage({
      type: 'CONFIG_UPDATED',
      data: {
        mode: config.proxyMode,
        rpcEndpoint: null,
        torEnabled: false,
        torConnected: false,
        torIp: null
      }
    }).catch(() => {});
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

// ============================================================================
// REPUTABLE SOLANA SITES - Global whitelist for phishing detection
// These are the legitimate domains for popular Solana dApps
// ============================================================================
const REPUTABLE_SITES = {
  // DEXs and Trading
  'jup.ag': { name: 'Jupiter', category: 'DEX' },
  'jupiter.ag': { name: 'Jupiter', category: 'DEX' },
  'raydium.io': { name: 'Raydium', category: 'DEX' },
  'orca.so': { name: 'Orca', category: 'DEX' },
  'lifinity.io': { name: 'Lifinity', category: 'DEX' },

  // Trading Terminals
  'axiom.trade': { name: 'Axiom', category: 'Trading' },
  'photon-sol.tinyastro.io': { name: 'Photon', category: 'Trading' },
  'photon.trade': { name: 'Photon', category: 'Trading' },
  'bullx.io': { name: 'BullX', category: 'Trading' },
  'dexscreener.com': { name: 'DEX Screener', category: 'Analytics' },
  'birdeye.so': { name: 'Birdeye', category: 'Analytics' },

  // NFT Marketplaces
  'magiceden.io': { name: 'Magic Eden', category: 'NFT' },
  'tensor.trade': { name: 'Tensor', category: 'NFT' },
  'hyperspace.xyz': { name: 'Hyperspace', category: 'NFT' },

  // DeFi
  'marinade.finance': { name: 'Marinade', category: 'DeFi' },
  'meteora.ag': { name: 'Meteora', category: 'DeFi' },
  'kamino.finance': { name: 'Kamino', category: 'DeFi' },
  'drift.trade': { name: 'Drift', category: 'DeFi' },
  'mango.markets': { name: 'Mango', category: 'DeFi' },
  'marginfi.com': { name: 'MarginFi', category: 'DeFi' },
  'sanctum.so': { name: 'Sanctum', category: 'DeFi' },
  'solend.fi': { name: 'Solend', category: 'DeFi' },
  'jito.network': { name: 'Jito', category: 'DeFi' },

  // Memecoins / Launch
  'pump.fun': { name: 'Pump.fun', category: 'Memecoin' },

  // Wallets
  'phantom.app': { name: 'Phantom', category: 'Wallet' },
  'phantom.com': { name: 'Phantom', category: 'Wallet' },
  'solflare.com': { name: 'Solflare', category: 'Wallet' },
  'backpack.app': { name: 'Backpack', category: 'Wallet' },
  'backpack.exchange': { name: 'Backpack', category: 'Wallet' },

  // Infrastructure
  'solana.com': { name: 'Solana', category: 'Infrastructure' },
  'solscan.io': { name: 'Solscan', category: 'Explorer' },
  'solana.fm': { name: 'Solana FM', category: 'Explorer' },
  'explorer.solana.com': { name: 'Solana Explorer', category: 'Explorer' },
  'helius.dev': { name: 'Helius', category: 'RPC' },
  'helius.xyz': { name: 'Helius', category: 'RPC' }
};

// Levenshtein distance for typosquatting detection
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Check if hostname is a potential typosquat of a reputable site
function checkTyposquatting(hostname) {
  // Extract base domain (remove www and common subdomains)
  let domain = hostname.toLowerCase();
  if (domain.startsWith('www.')) domain = domain.slice(4);

  // Check if it's already a reputable site
  if (REPUTABLE_SITES[domain]) {
    return null; // It's the real site
  }

  // Check for close matches (typosquatting)
  for (const [reputableDomain, info] of Object.entries(REPUTABLE_SITES)) {
    const distance = levenshteinDistance(domain, reputableDomain);

    // If very close (1-2 character difference) and similar length, likely typosquat
    const lengthDiff = Math.abs(domain.length - reputableDomain.length);
    if (distance <= 2 && lengthDiff <= 2 && distance > 0) {
      return {
        suspectedTyposquat: domain,
        intendedSite: reputableDomain,
        siteName: info.name,
        category: info.category,
        distance
      };
    }

    // Check for common typosquatting patterns
    // Pattern: adding/removing letters
    if (domain.includes(reputableDomain.replace('.', '')) ||
        reputableDomain.includes(domain.replace('.', ''))) {
      if (domain !== reputableDomain) {
        return {
          suspectedTyposquat: domain,
          intendedSite: reputableDomain,
          siteName: info.name,
          category: info.category,
          distance
        };
      }
    }
  }

  return null;
}

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
          torEnabled: config.torEnabled,
          torConnected: config.torConnected,
          torIp: config.torIp,
          ...(result || {})
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

    case 'GET_TRUSTED_SITES':
      sendResponse({ trustedSites: config.trustedSites || [] });
      break;

    case 'TRUST_SITE':
      if (message.hostname) {
        const hostname = message.hostname.toLowerCase();
        if (!config.trustedSites.includes(hostname)) {
          config.trustedSites.push(hostname);
          saveConfig();
          console.log(`[PrivacyRPC] Site trusted: ${hostname}`);
        }
        sendResponse({ success: true, trustedSites: config.trustedSites });
      } else {
        sendResponse({ success: false, error: 'No hostname provided' });
      }
      break;

    case 'UNTRUST_SITE':
      if (message.hostname) {
        const hostname = message.hostname.toLowerCase();
        config.trustedSites = config.trustedSites.filter(s => s !== hostname);
        saveConfig();
        console.log(`[PrivacyRPC] Site untrusted: ${hostname}`);
        sendResponse({ success: true, trustedSites: config.trustedSites });
      } else {
        sendResponse({ success: false, error: 'No hostname provided' });
      }
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

    case 'GET_RPC_HISTORY':
      // Return stored RPC activity history
      sendResponse({
        history: rpcActivityHistory,
        total: rpcActivityHistory.length
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

    case 'PROXY_RPC_REQUEST':
      // Relay RPC request through our local proxy (bypasses page CSP)
      (async () => {
        const proxyUrl = `http://${config.proxyHost}:${config.proxyPort}`;
        console.log('[PrivacyRPC-BG] === PROXY RPC REQUEST ===');
        console.log('[PrivacyRPC-BG] Target:', message.targetUrl);
        console.log('[PrivacyRPC-BG] Proxy:', proxyUrl);
        console.log('[PrivacyRPC-BG] Body length:', message.body?.length || 0);

        try {
          const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Target-URL': message.targetUrl
            },
            body: typeof message.body === 'string' ? message.body : JSON.stringify(message.body)
          });

          console.log('[PrivacyRPC-BG] Proxy HTTP status:', response.status);

          if (!response.ok) {
            const errorText = await response.text();
            console.error('[PrivacyRPC-BG] Proxy error response:', errorText);
            throw new Error(`Proxy returned ${response.status}: ${errorText}`);
          }

          const data = await response.json();
          console.log('[PrivacyRPC-BG] SUCCESS - Got response data');
          sendResponse({ success: true, data });
        } catch (e) {
          console.error('[PrivacyRPC-BG] FAILED:', e.message);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true; // Keep channel open for async
  }
});

// Handle notification action clicks
function handleNotificationAction(notificationId, action) {
  console.log(`[PrivacyRPC] Notification action: ${action} from ${notificationId}`);

  // Handle trust_site:hostname format
  if (action.startsWith('trust_site:')) {
    const hostname = action.split(':')[1];
    if (hostname && !config.trustedSites.includes(hostname)) {
      config.trustedSites.push(hostname);
      saveConfig();
      console.log(`[PrivacyRPC] Site trusted via notification: ${hostname}`);
      // Show confirmation
      notificationHub.notify({
        type: 'PROTECTION_ON',
        title: 'Site Trusted',
        message: `${hostname} will no longer show drainer warnings. Manage in extension settings.`,
        actions: [
          { label: 'Undo', action: `untrust_site:${hostname}` },
          { label: 'OK', action: 'dismiss' }
        ]
      });
    }
    return;
  }

  // Handle untrust_site:hostname format (undo action)
  if (action.startsWith('untrust_site:')) {
    const hostname = action.split(':')[1];
    if (hostname) {
      config.trustedSites = config.trustedSites.filter(s => s !== hostname);
      saveConfig();
      console.log(`[PrivacyRPC] Site untrusted via notification: ${hostname}`);
    }
    return;
  }

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
    case 'block_site':
      // TODO: Implement site blocking
      console.log('[PrivacyRPC] Block site requested - not yet implemented');
      break;
    case 'close_tab':
      // Close the current tab (user clicked "Leave Site" on scam warning)
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab) {
          chrome.tabs.remove(tab.id);
          console.log('[PrivacyRPC] Closed tab due to scam warning');
        }
      });
      break;
    case 'dismiss':
      // Just close the notification
      break;
  }

  // Handle navigate:url format (for typosquatting redirection)
  if (action.startsWith('navigate:')) {
    const url = action.slice(9);
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab) {
        chrome.tabs.update(tab.id, { url });
        console.log(`[PrivacyRPC] Navigating to safe site: ${url}`);
      }
    });
  }
}

// Listen for proxy errors - with aggressive suppression to prevent notification floods
let lastProxyErrorTime = 0;
let proxyErrorNotificationShown = false;

chrome.proxy.onProxyError.addListener((details) => {
  const now = Date.now();

  // Only log once per 10 seconds to prevent console spam
  if (now - lastProxyErrorTime > 10000) {
    console.error('[PrivacyRPC] Proxy error:', details.error);
    lastProxyErrorTime = now;
  }

  config.stats.lastActivity = {
    type: 'error',
    message: details.error,
    timestamp: now
  };

  // Only show ONE notification until proxy is back online
  // Reset flag when proxy health check succeeds
  if (!proxyErrorNotificationShown) {
    proxyErrorNotificationShown = true;

    notificationHub.notify({
      type: 'PROXY_ERROR',
      title: 'Proxy Connection Error',
      message: 'Desktop app not running. RPC routing disabled until reconnected.',
      actions: [
        { label: 'Open Settings', action: 'open_settings' },
        { label: 'Dismiss', action: 'dismiss' }
      ]
    });

    // Auto-disable PAC proxy to stop the error flood
    chrome.proxy.settings.clear({ scope: 'regular' }).then(() => {
      console.log('[PrivacyRPC] PAC proxy cleared due to connection error');
    }).catch(() => {});
  }
});

// Check if URL is a Solana RPC endpoint
function isRpcUrl(urlString) {
  try {
    const url = new URL(urlString);

    // TODO: REMOVE BEFORE PRODUCTION - localhost detection for testing only
    if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
        (url.port === '3333' || url.pathname.includes('mock-rpc') || url.pathname.includes('rpc'))) {
      return true;
    }

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

    // DEBUG: Log all POST requests to help troubleshoot
    if (details.method === 'POST') {
      console.log('[PrivacyRPC DEBUG] POST request:', details.url, 'hasBody:', !!details.requestBody);
    }

    const isRpc = isRpcUrl(details.url);

    // Also check if this looks like a JSON-RPC call (POST with JSON body to any URL)
    let isJsonRpc = false;
    let rpcMethod = null;
    if (details.method === 'POST' && details.requestBody) {
      try {
        let body = null;

        // Try to get body from raw (ArrayBuffer)
        if (details.requestBody.raw && details.requestBody.raw[0] && details.requestBody.raw[0].bytes) {
          const decoder = new TextDecoder();
          body = decoder.decode(details.requestBody.raw[0].bytes);
        }
        // Fallback: try formData if raw not available
        else if (details.requestBody.formData) {
          body = JSON.stringify(details.requestBody.formData);
        }

        if (body) {
          console.log('[PrivacyRPC DEBUG] Request body:', body.substring(0, 200));

          if (body.includes('jsonrpc') || body.includes('getBalance') ||
              body.includes('getAccountInfo') || body.includes('sendTransaction') ||
              body.includes('simulateTransaction') || body.includes('getRecentBlockhash') ||
              body.includes('getLatestBlockhash') || body.includes('getSignatureStatuses') ||
              body.includes('getTokenAccountsByOwner')) {
            isJsonRpc = true;
            console.log('[PrivacyRPC DEBUG] JSON-RPC detected in body!');

            // Extract the RPC method name for pattern detection
            try {
              const parsed = JSON.parse(body);
              rpcMethod = parsed.method || null;
            } catch (e) {
              // Try regex fallback for method extraction
              const methodMatch = body.match(/"method"\s*:\s*"([^"]+)"/);
              if (methodMatch) rpcMethod = methodMatch[1];
            }
          }
        }
      } catch (e) {
        console.log('[PrivacyRPC DEBUG] Body parse error:', e.message);
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

        // Check for typosquatting ONLY when RPC detected and only once per tab
        if (!typosquatWarnings.has(details.tabId)) {
          chrome.tabs.get(details.tabId).then(tab => {
            if (tab && tab.url) {
              try {
                const tabHostname = new URL(tab.url).hostname.toLowerCase();

                // Skip if trusted
                if (config.trustedSites && config.trustedSites.includes(tabHostname)) {
                  return;
                }

                const typosquat = checkTyposquatting(tabHostname);
                if (typosquat) {
                  typosquatWarnings.set(details.tabId, true);
                  console.log(`[PrivacyRPC] URL check: ${typosquat.suspectedTyposquat} similar to ${typosquat.intendedSite}`);

                  notificationHub.notify({
                    type: 'EXT_WARNING',
                    title: 'Check URL',
                    message: `This site looks similar to ${typosquat.siteName} (${typosquat.intendedSite}). Verify you're on the correct site.`,
                    tabId: details.tabId,
                    priority: 80,
                    actions: [
                      { label: 'Trust Site', action: `trust_site:${tabHostname}` },
                      { label: 'Dismiss', action: 'dismiss' }
                    ]
                  });
                }
              } catch (e) {}
            }
          }).catch(() => {});
        }
      }

      // Check if it's a ZK Compression method (based on URL patterns)
      const isZkCall = url.pathname.includes('compressed') ||
                       url.searchParams.has('compressed');
      if (isZkCall) {
        config.zkStats = config.zkStats || { compressedCalls: 0, regularCalls: 0, cacheHits: 0, estimatedSavings: 0 };
        config.zkStats.compressedCalls++;
        config.zkStats.estimatedSavings += 1000; // Estimate
      }

      // Send activity to popup with actual RPC method name
      const now = Date.now();
      const activityData = {
        method: rpcMethod || (isJsonRpc ? 'JSON-RPC' : 'RPC'),
        url: url.hostname + url.pathname.substring(0, 30),
        success: true,
        timestamp: now,
        proxied: config.enabled,
        tabId: details.tabId,
        isZk: isZkCall
      };

      // Store in history (keep last 100)
      rpcActivityHistory.unshift(activityData);
      if (rpcActivityHistory.length > 100) rpcActivityHistory.pop();

      chrome.runtime.sendMessage({
        type: 'RPC_ACTIVITY',
        data: activityData
      }).catch(() => {}); // Ignore if popup not open

      // DRAINER PATTERN DETECTION - analyze RPC method sequence
      if (details.tabId && details.tabId > 0 && rpcMethod) {
        // Check if site is trusted before sending drainer warnings
        chrome.tabs.get(details.tabId).then(tab => {
          if (tab && tab.url) {
            try {
              const tabHostname = new URL(tab.url).hostname.toLowerCase();

              // Skip warnings for trusted sites
              if (config.trustedSites && config.trustedSites.includes(tabHostname)) {
                console.log(`[PrivacyRPC] Skipping drainer check for trusted site: ${tabHostname}`);
                return;
              }

              const warnings = analyzeRpcMethod(details.tabId, rpcMethod, now);
              if (warnings && warnings.length > 0) {
                for (const warning of warnings) {
                  notificationHub.notify({
                    type: 'SUSPICIOUS_RPC',
                    title: warning.title,
                    message: warning.message,
                    tabId: details.tabId,
                    actions: [
                      { label: 'Trust Site', action: `trust_site:${tabHostname}` },
                      { label: 'Block Site', action: 'block_site' },
                      { label: 'Dismiss', action: 'dismiss' }
                    ]
                  });
                  console.log(`[PrivacyRPC] DRAINER WARNING: ${warning.title} - ${warning.message}`);
                }
              }
            } catch (e) {
              console.log('[PrivacyRPC] Could not get tab hostname:', e);
            }
          }
        }).catch(() => {});
      }

      // NOTE: Removed generic "High RPC Activity" warning - it was too noisy.
      // Legitimate DeFi apps make hundreds of RPC calls.
      // Drainer pattern detection (above) is smarter and more targeted.

      // Notify if RPC detected but protection is off
      if (!config.enabled && details.tabId > 0) {
        // Get tab hostname for trust option
        chrome.tabs.get(details.tabId).then(tab => {
          if (tab && tab.url) {
            try {
              const tabHostname = new URL(tab.url).hostname.toLowerCase();
              notificationHub.notify({
                type: 'UNPROTECTED_DAPP',
                title: 'Unprotected dApp Detected',
                message: `RPC calls to ${url.hostname} are not protected`,
                tabId: details.tabId,
                actions: [
                  { label: 'Enable Protection', action: 'enable_protection' },
                  { label: 'Trust Site', action: `trust_site:${tabHostname}` },
                  { label: 'Dismiss', action: 'dismiss' }
                ]
              });
            } catch (e) {}
          }
        }).catch(() => {});
      }

      console.log('[PrivacyRPC] RPC detected:', url.hostname, config.enabled ? '(proxied)' : '(direct)');
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

// Track RPC activity per tab
const tabActivity = new Map();

// Store recent RPC activity history (persists even when popup is closed)
const rpcActivityHistory = [];

// ============================================================================
// DRAINER PATTERN DETECTION
// Based on DRAINER_PROTECTION_PLAN.md - detects specific RPC call sequences
// Pattern: getBalance → getTokenAccountsByOwner → multiple getAccountInfo → signTransaction
// ============================================================================

// Drainer detection state per tab
const drainerDetection = new Map();

// RPC methods that indicate asset enumeration (drainer scanning what to steal)
const ENUMERATION_METHODS = [
  'getBalance',
  'getTokenAccountsByOwner',
  'getTokenAccountsByDelegate',
  'getAccountInfo',
  'getMultipleAccounts',
  'getProgramAccounts'
];

// Methods that indicate transaction preparation
const TX_PREP_METHODS = [
  'getLatestBlockhash',
  'getRecentBlockhash',
  'getFeeForMessage'
];

// Methods that indicate transaction execution
const TX_EXEC_METHODS = [
  'sendTransaction',
  'simulateTransaction',
  'signTransaction',
  'signAllTransactions'
];

// Analyze RPC method for drainer patterns
function analyzeRpcMethod(tabId, method, timestamp) {
  if (!tabId || tabId < 0) return null;

  let state = drainerDetection.get(tabId);
  if (!state) {
    state = {
      firstCallTime: timestamp,
      enumerationCalls: [],
      txPrepCalls: [],
      txExecCalls: [],
      warnings: []
    };
    drainerDetection.set(tabId, state);
  }

  // Categorize the method
  if (ENUMERATION_METHODS.some(m => method.includes(m))) {
    state.enumerationCalls.push({ method, timestamp });
  } else if (TX_PREP_METHODS.some(m => method.includes(m))) {
    state.txPrepCalls.push({ method, timestamp });
  } else if (TX_EXEC_METHODS.some(m => method.includes(m))) {
    state.txExecCalls.push({ method, timestamp });
  }

  // Check for drainer patterns
  const warnings = [];
  const timeSinceFirst = timestamp - state.firstCallTime;

  // NOTE: We don't permanently suppress warnings anymore.
  // Warnings will re-fire until user clicks "Trust Site" (which adds to trustedSites).
  // NotificationHub throttling (30 sec cooldown) prevents spam.

  // Pattern 0: Immediate balance check (getBalance within 2 seconds of page load)
  // Drainers immediately check your balance before you've even interacted
  if (method.includes('getBalance') && timeSinceFirst < 2000) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'Immediate Balance Check',
      message: 'Site checked your wallet balance immediately on load - common drainer behavior',
      severity: 'medium'
    });
  }

  // Pattern 0b: Immediate token enumeration (getTokenAccountsByOwner within 3 seconds)
  if (method.includes('getTokenAccountsByOwner') && timeSinceFirst < 3000) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'Immediate Token Scan',
      message: 'Site scanned all your tokens immediately on load - verify this is expected',
      severity: 'medium'
    });
  }

  // Pattern 1: Rapid asset enumeration (5+ enumeration calls in 5 seconds)
  const recentEnumCalls = state.enumerationCalls.filter(c => timestamp - c.timestamp < 5000);
  if (recentEnumCalls.length >= 5) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'Drainer Pattern: Asset Scan',
      message: `Site is rapidly scanning your token balances (${recentEnumCalls.length} calls in ${Math.round(timeSinceFirst/1000)}s)`,
      severity: 'high'
    });
  }

  // Pattern 2: getTokenAccountsByOwner followed by multiple getAccountInfo (checking token values)
  const hasTokenEnum = state.enumerationCalls.some(c => c.method.includes('getTokenAccountsByOwner'));
  const accountInfoCount = state.enumerationCalls.filter(c => c.method.includes('getAccountInfo')).length;
  if (hasTokenEnum && accountInfoCount >= 3) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'Drainer Pattern: Token Check',
      message: 'Site enumerated your tokens then checked multiple account values',
      severity: 'high'
    });
  }

  // Pattern 3: Quick transaction after page load (TX within 10 seconds of first RPC)
  if (state.txExecCalls.length > 0 && timeSinceFirst < 10000) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'Quick Transaction Attempt',
      message: `Transaction requested ${Math.round(timeSinceFirst/1000)}s after page load - verify before signing`,
      severity: 'critical'
    });
  }

  // Pattern 4: Full drainer sequence (enumeration → prep → exec)
  if (state.enumerationCalls.length >= 3 &&
      state.txPrepCalls.length >= 1 &&
      state.txExecCalls.length >= 1) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'DRAINER DETECTED',
      message: 'Classic drainer pattern: scanned assets → prepared transaction → requesting signature',
      severity: 'critical'
    });
  }

  // Pattern 5: Multiple simulateTransaction calls (testing multiple token drains)
  const recentSimulations = state.txExecCalls.filter(c =>
    c.method.includes('simulateTransaction') && timestamp - c.timestamp < 10000
  );
  if (recentSimulations.length >= 3) {
    warnings.push({
      type: 'DRAINER_PATTERN',
      title: 'Multi-Token Drain Attempt',
      message: `Site simulated ${recentSimulations.length} transactions rapidly - may be testing which tokens to steal`,
      severity: 'critical'
    });
  }

  drainerDetection.set(tabId, state);
  return warnings.length > 0 ? warnings : null;
}

// Clear drainer detection state when tab navigates
function clearDrainerState(tabId) {
  drainerDetection.delete(tabId);
}

// Initialize on startup
async function initialize() {
  // Enable side panel
  try {
    await chrome.sidePanel.setOptions({
      enabled: true
    });
  } catch (e) {
    // Side panel not available
  }

  await loadConfig();

  // Clear any existing PAC proxy (we use fetch/XHR interception now)
  await applyProxySettings();

  // Check proxy health on startup
  if (config.enabled) {
    const health = await checkProxyHealth();
    lastProxyStatus = health.running;
    if (!health.running) {
      console.log('[PrivacyRPC] Proxy not running on startup');
    }
  }

  // Fetch proxy config to get current state from desktop app
  await fetchProxyConfig();

  // Update icon with current status
  updateIcon();
}

// Listen for tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  notifyPopupTabChange(tab);
});

// Track which tabs have already been warned about typosquatting
const typosquatWarnings = new Map();

// Listen for URL changes within a tab
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    notifyPopupTabChange(tab);
    // Reset activity and drainer detection for this tab on navigation
    if (changeInfo.url) {
      tabActivity.set(tabId, {
        url: changeInfo.url,
        rpcCalls: 0,
        lastActivity: null
      });
      // Clear drainer detection state for fresh analysis
      clearDrainerState(tabId);
      // Clear typosquat warning for this tab on navigation
      typosquatWarnings.delete(tabId);
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

// Periodic health check - every 30 seconds to keep Tor status synced
chrome.alarms.create('healthCheck', { periodInMinutes: 0.5 });
// Config sync alarm - more frequent for real-time Tor status updates
chrome.alarms.create('configSync', { periodInMinutes: 0.25 }); // Every 15 seconds
let lastProxyStatus = null;
let lastTorStatus = null;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'healthCheck' && config.enabled) {
    const health = await checkProxyHealth();
    const currentStatus = health.running;

    // Proxy came back online - reset error state and notify tabs
    if (currentStatus === true && lastProxyStatus === false) {
      proxyErrorNotificationShown = false; // Reset flood prevention flag
      console.log('[PrivacyRPC] Proxy back online');

      // Notify all tabs to re-enable RPC routing (fetch/XHR interception)
      broadcastToAllTabs({ type: 'CONFIG_UPDATED', data: { proxyRunning: true } });
    }

    // Proxy went offline - notify tabs to disable RPC routing
    if (currentStatus === false && lastProxyStatus === true) {
      broadcastToAllTabs({ type: 'CONFIG_UPDATED', data: { proxyRunning: false } });
    }

    // Only notify if status changed from running to not running
    if (lastProxyStatus === true && currentStatus === false) {
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
  }

  // Config sync - poll for Tor status changes from desktop app
  if (alarm.name === 'configSync') {
    const previousTorConnected = config.torConnected;
    const previousTorEnabled = config.torEnabled;

    await fetchProxyConfig();

    // Notify popup if Tor status changed
    if (previousTorConnected !== config.torConnected || previousTorEnabled !== config.torEnabled) {
      console.log(`[PrivacyRPC] Tor status changed: enabled=${config.torEnabled}, connected=${config.torConnected}`);

      // Send status update to popup
      chrome.runtime.sendMessage({
        type: 'TOR_STATUS',
        connected: config.torConnected,
        ip: config.torIp,
        torEnabled: config.torEnabled,
        bootstrapProgress: config.torConnected ? 100 : 0,
        rpcProvider: config.rpcEndpoint
      }).catch(() => {}); // Ignore if popup not open

      // Show notification for Tor status change
      if (config.torConnected && !previousTorConnected) {
        notificationHub.notify({
          type: 'TOR_CONNECTED',
          title: 'Tor Connected',
          message: config.torIp ? `Exit IP: ${config.torIp}` : 'Your RPC traffic is now routed through Tor'
        });
      } else if (!config.torConnected && previousTorConnected) {
        notificationHub.notify({
          type: 'TOR_DISCONNECTED',
          title: 'Tor Disconnected',
          message: 'RPC traffic is no longer routed through Tor'
        });
      }
    }
  }
});
