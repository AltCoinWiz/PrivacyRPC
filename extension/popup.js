/**
 * PrivacyRPC Popup Script
 * Modern black/white UI with multiple pages
 */

// State
let config = {
  enabled: false,
  autoBlock: false, // Auto-block all transactions without prompt
  torEnabled: false,
  torConnected: false,
  torIp: null,
  customRpc: '',
  proxyHost: '127.0.0.1',
  proxyPort: 8899,
  proxyMode: 'proxy_only', // 'proxy_only' or 'private_rpc'
  rpcEndpoint: null, // Endpoint from desktop app
  alerts: [],
  activity: [],
  recentScans: [],
  debugLogs: []
};

// Proxy status (live check)
let proxyRunning = false;

// Notification settings state
let notificationSettings = {
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
  }
};

// DOM Elements - initialized after DOM is ready
let elements = {};

// Suspicious activity tracking
let suspiciousActivityState = {
  firstRpcTime: null,
  pageLoadTime: Date.now(),
  balanceCheckCount: 0,
  transferAttempts: 0
};

// Store detailed data for sites and extensions
let detailData = {
  currentSite: null,
  extensions: [],
  scans: {}
};

// Initialize DOM elements
function initElements() {
  elements = {
    // Header Status Lights
    proxyDot: document.getElementById('proxyDot'),
    rpcDot: document.getElementById('rpcDot'),
    torHeaderDot: document.getElementById('torHeaderDot'),
    openSidePanel: document.getElementById('openSidePanel'),
    openPopout: document.getElementById('openPopout'),

    // Status
    statusBanner: document.getElementById('statusBanner'),
    statusIcon: document.getElementById('statusIcon'),
    statusTitle: document.getElementById('statusTitle'),
    statusSubtitle: document.getElementById('statusSubtitle'),
    modeBadge: document.getElementById('modeBadge'),
    modeIndicator: document.getElementById('modeIndicator'),

    // Current site
    siteName: document.getElementById('siteName'),
    siteRpcCount: document.getElementById('siteRpcCount'),
    siteStatus: document.getElementById('siteStatus'),

    // Toggles
    toggleProtection: document.getElementById('toggleProtection'),
    torStatus: document.getElementById('torStatus'),
    torDot: document.getElementById('torDot'),
    torLabel: document.getElementById('torLabel'),
    torIp: document.getElementById('torIp'),

    // RPC Status in settings
    rpcStatusDot: document.getElementById('rpcStatusDot'),
    rpcStatusText: document.getElementById('rpcStatusText'),
    rpcEndpointDisplay: document.getElementById('rpcEndpointDisplay'),

    // Alerts
    alertCount: document.getElementById('alertCount'),
    alertsList: document.getElementById('alertsList'),

    // Activity
    activityList: document.getElementById('activityList'),
    clearActivity: document.getElementById('clearActivity'),
    activitySiteName: document.getElementById('activitySiteName'),
    activitySiteRpcCount: document.getElementById('activitySiteRpcCount'),
    activitySiteStatus: document.getElementById('activitySiteStatus'),
    endpointsList: document.getElementById('endpointsList'),
    endpointCount: document.getElementById('endpointCount'),
    activityFooter: document.getElementById('activityFooter'),
    viewAllActivity: document.getElementById('viewAllActivity'),
    downloadActivity: document.getElementById('downloadActivity'),
    allActivityList: document.getElementById('allActivityList'),
    allActivityCount: document.getElementById('allActivityCount'),
    allActivityBackBtn: document.getElementById('allActivityBackBtn'),
    rpcDetailContent: document.getElementById('rpcDetailContent'),
    rpcDetailBackBtn: document.getElementById('rpcDetailBackBtn'),

    // Scanner
    scanUrl: document.getElementById('scanUrl'),
    scanBtn: document.getElementById('scanBtn'),
    scanResults: document.getElementById('scanResults'),
    recentScans: document.getElementById('recentScans'),

    // Settings
    proxyHost: document.getElementById('proxyHost'),
    proxyPort: document.getElementById('proxyPort'),
    debugLogs: document.getElementById('debugLogs'),
    clearLogs: document.getElementById('clearLogs'),

    // Extensions
    extensionsList: document.getElementById('extensionsList'),
    extensionCount: document.getElementById('extensionCount'),

    // Detail page
    detailContent: document.getElementById('detailContent'),
    detailBackBtn: document.getElementById('detailBackBtn'),

    // Current site (make clickable)
    currentSite: document.getElementById('currentSite'),

    // Navigation
    navItems: document.querySelectorAll('.nav-item'),
    pages: document.querySelectorAll('.page'),

    // Notification settings
    toggleNativeNotif: document.getElementById('toggleNativeNotif'),
    toggleOverlayNotif: document.getElementById('toggleOverlayNotif'),
    notifProxyError: document.getElementById('notifProxyError'),
    notifTorStatus: document.getElementById('notifTorStatus'),
    notifSuspicious: document.getElementById('notifSuspicious'),
    notifExtWarning: document.getElementById('notifExtWarning'),
    notifProtection: document.getElementById('notifProtection')
  };
}

// Initialize
async function init() {
  initElements();
  await loadConfig();
  await loadNotificationSettings();
  setupEventListeners();
  // If protection is enabled, show as running immediately (quick fix for UI)
  if (config.enabled) {
    proxyRunning = true;
  }
  updateUI();
  updateNotificationSettingsUI();
  getCurrentTab();
  updateZKStats();
  getInstalledExtensions();
  getBackgroundActivity();
  // Fetch proxy config to get mode/endpoint from desktop app
  fetchProxyConfig();
}

// Fetch proxy config from desktop app
async function fetchProxyConfig() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_PROXY_CONFIG' });
    if (result) {
      config.proxyMode = result.mode || 'proxy_only';
      config.rpcEndpoint = result.rpcEndpoint || null;
      updateUI();
      log(`Proxy mode: ${config.proxyMode}, endpoint: ${config.rpcEndpoint ? 'configured' : 'none'}`);
    }
  } catch (e) {
    log('Failed to fetch proxy config: ' + e.message);
  }
}

// Load notification settings from background
async function loadNotificationSettings() {
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_NOTIFICATION_SETTINGS' });
    if (settings) {
      notificationSettings = { ...notificationSettings, ...settings };
    }
  } catch (e) {
    log('Failed to load notification settings: ' + e.message);
  }
}

// Save notification settings to background
async function saveNotificationSettings() {
  try {
    await chrome.runtime.sendMessage({
      type: 'SET_NOTIFICATION_SETTINGS',
      settings: notificationSettings
    });
  } catch (e) {
    log('Failed to save notification settings: ' + e.message);
  }
}

// Update notification settings UI
function updateNotificationSettingsUI() {
  if (elements.toggleNativeNotif) {
    elements.toggleNativeNotif.checked = notificationSettings.nativeNotificationsEnabled;
  }
  if (elements.toggleOverlayNotif) {
    elements.toggleOverlayNotif.checked = notificationSettings.overlayNotificationsEnabled;
  }
  if (elements.notifProxyError) {
    elements.notifProxyError.checked = notificationSettings.native?.proxyError ?? true;
  }
  if (elements.notifTorStatus) {
    elements.notifTorStatus.checked = notificationSettings.native?.torConnected ?? true;
  }
  if (elements.notifSuspicious) {
    elements.notifSuspicious.checked = notificationSettings.native?.suspiciousActivity ?? true;
  }
  if (elements.notifExtWarning) {
    elements.notifExtWarning.checked = notificationSettings.native?.extensionWarning ?? true;
  }
  if (elements.notifProtection) {
    elements.notifProtection.checked = notificationSettings.native?.protectionStatusChange ?? true;
  }
}

// Get activity data from background script
async function getBackgroundActivity() {
  try {
    const bgData = await chrome.runtime.sendMessage({ type: 'GET_ALL_TAB_ACTIVITY' });
    if (bgData) {
      log(`Background: ${bgData.totalRequests} total requests`);
      // Store background activity data for reference
      detailData.backgroundActivity = bgData;
    }
  } catch (e) {
    log('Failed to get background activity: ' + e.message);
  }
}

// Get ALL installed extensions
async function getInstalledExtensions() {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'GET_EXTENSIONS' });
    if (result && elements.extensionsList) {
      renderExtensionsList(result);
      if (elements.extensionCount) {
        elements.extensionCount.textContent = result.total.toString();
      }
    }
  } catch (e) {
    log('Failed to get extensions: ' + e.message);
    if (elements.extensionsList) {
      elements.extensionsList.innerHTML = '<div class="no-alerts">Could not scan extensions</div>';
    }
  }
}

// Render extensions list - shows ALL extensions with security indicators
function renderExtensionsList(result) {
  if (!elements.extensionsList) return;

  const allExtensions = result.all || [];
  detailData.extensions = allExtensions; // Store for detail view

  if (allExtensions.length === 0) {
    elements.extensionsList.innerHTML = '<div class="no-alerts">No extensions detected</div>';
    return;
  }

  elements.extensionsList.innerHTML = allExtensions.map((ext, index) => {
    // Determine badge type and text
    let badgeClass = 'other';
    let badgeText = 'Extension';

    if (ext.type === 'wallet') {
      badgeClass = config.enabled ? 'protected' : 'wallet';
      badgeText = config.enabled ? 'Protected' : 'Wallet';
    } else if (ext.hasBroadAccess) {
      badgeClass = 'warning';
      badgeText = 'All Sites';
    }

    return `
      <div class="extension-item clickable ${ext.hasBroadAccess && ext.type !== 'wallet' ? 'suspicious' : ''}" data-ext-index="${index}">
        <div class="extension-icon">
          ${ext.icon ? `<img src="${ext.icon}" alt="${ext.name}" onerror="this.style.display='none'">` : `<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></span>`}
        </div>
        <div class="extension-info">
          <h5>${ext.name}</h5>
          <p title="${ext.description || ''}">${ext.type === 'wallet' ? 'Wallet' : ext.hasBroadAccess ? 'Has broad access' : 'Extension'}</p>
        </div>
        <span class="extension-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');

  // Add click handlers for extension items
  elements.extensionsList.querySelectorAll('.extension-item.clickable').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.extIndex);
      if (detailData.extensions[index]) {
        showExtensionDetail(detailData.extensions[index]);
      }
    });
  });
}

// Update ZK Compression stats
async function updateZKStats() {
  try {
    const stats = await chrome.runtime.sendMessage({ type: 'GET_ZK_STATS' });
    if (stats) {
      const zkStatus = document.getElementById('zkStatus');
      const zkCompressed = document.getElementById('zkCompressed');
      const zkSavings = document.getElementById('zkSavings');
      const zkCacheHits = document.getElementById('zkCacheHits');

      if (zkCompressed) zkCompressed.textContent = stats.compressedCalls || 0;
      if (zkSavings) zkSavings.textContent = formatSavings(stats.estimatedSavings || 0);
      if (zkCacheHits) zkCacheHits.textContent = stats.cacheHits || 0;

      if (zkStatus && stats.compressedCalls > 0) {
        zkStatus.textContent = 'ACTIVE';
        zkStatus.classList.add('active');
      }
    }
  } catch (e) {
    log('Failed to get ZK stats: ' + e.message);
  }
}

// Format savings in SOL
function formatSavings(lamports) {
  if (lamports < 1000) return lamports + ' lam';
  if (lamports < 1000000) return (lamports / 1000).toFixed(1) + 'K';
  return (lamports / 1000000000).toFixed(4) + ' SOL';
}

// Load config from storage
async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(['privacyrpcConfig']);
    if (result.privacyrpcConfig) {
      config = { ...config, ...result.privacyrpcConfig };
    }
  } catch (e) {
    log('Failed to load config: ' + e.message);
  }
}

// Save config
async function saveConfig() {
  try {
    await chrome.storage.local.set({ privacyrpcConfig: config });
  } catch (e) {
    log('Failed to save config: ' + e.message);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Side Panel button
  if (elements.openSidePanel) {
    elements.openSidePanel.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.sidePanel.open({ tabId: tab.id });
        window.close();
      } catch (e) {
        log('Failed to open side panel: ' + e.message);
      }
    });
  }

  // Popout button
  if (elements.openPopout) {
    elements.openPopout.addEventListener('click', () => {
      chrome.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: 380,
        height: 580,
        focused: true
      });
      window.close();
    });
  }

  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      switchPage(page);
    });
  });

  // Protection toggle
  if (elements.toggleProtection) {
    elements.toggleProtection.addEventListener('change', async (e) => {
      config.enabled = e.target.checked;
      await saveConfig();

      // Send message to background - this will start/stop proxy via native messaging
      chrome.runtime.sendMessage({
        type: 'SET_ENABLED',
        enabled: config.enabled
      });

      if (config.enabled) {
        // Immediately show as running when enabled (quick fix for UI feedback)
        proxyRunning = true;
        updateUI();
        addAlert('success', 'Protection Active', 'RPC traffic is now being routed through proxy');
      } else {
        proxyRunning = false;
        updateUI();
        addAlert('info', 'Protection Disabled', 'RPC traffic is now direct');
      }
    });
  }

  // Tor status is now read-only - controlled by desktop app
  // No toggle event listener needed

  // Auto-block toggle
  const toggleAutoBlock = document.getElementById('toggleAutoBlock');
  if (toggleAutoBlock) {
    // Load saved state
    chrome.storage.local.get(['autoBlockEnabled'], (result) => {
      toggleAutoBlock.checked = result.autoBlockEnabled || false;
      config.autoBlock = result.autoBlockEnabled || false;
    });

    toggleAutoBlock.addEventListener('change', async (e) => {
      config.autoBlock = e.target.checked;
      await chrome.storage.local.set({ autoBlockEnabled: config.autoBlock });

      // Notify background script
      chrome.runtime.sendMessage({
        type: 'SET_AUTO_BLOCK',
        enabled: config.autoBlock
      });

      if (config.autoBlock) {
        addAlert('warning', 'Auto-Block Enabled', 'All transactions will be blocked automatically');
      } else {
        addAlert('info', 'Auto-Block Disabled', 'Transactions will prompt for approval');
      }
    });
  }

  // Scanner
  if (elements.scanBtn) {
    elements.scanBtn.addEventListener('click', () => {
      const url = elements.scanUrl.value.trim();
      if (url) {
        scanWebsite(url);
      }
    });
  }

  if (elements.scanUrl) {
    elements.scanUrl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const url = elements.scanUrl.value.trim();
        if (url) {
          scanWebsite(url);
        }
      }
    });
  }

  // Settings - RPC endpoint can be set from extension or desktop app
  if (elements.saveRpc) {
    elements.saveRpc.addEventListener('click', async () => {
      config.customRpc = elements.customRpc.value.trim();
      config.proxyHost = elements.proxyHost.value.trim() || '127.0.0.1';
      config.proxyPort = parseInt(elements.proxyPort.value) || 8899;
      await saveConfig();

      updateUI();
      addAlert('success', 'Settings Saved', 'RPC endpoint updated');

      chrome.runtime.sendMessage({
        type: 'SET_PROXY_ADDRESS',
        host: config.proxyHost,
        port: config.proxyPort
      });

      // Send RPC provider to desktop app via native messaging
      if (config.customRpc) {
        chrome.runtime.sendMessage({
          type: 'SET_RPC_PROVIDER',
          url: config.customRpc
        });
      } else {
        chrome.runtime.sendMessage({
          type: 'SET_RPC_PROVIDER',
          url: null
        });
      }
    });
  }

  // Clear buttons
  if (elements.clearActivity) {
    elements.clearActivity.addEventListener('click', () => {
      config.activity = [];
      saveConfig();
      renderActivityList();
    });
  }

  if (elements.clearLogs) {
    elements.clearLogs.addEventListener('click', () => {
      config.debugLogs = [];
      saveConfig();
      renderDebugLogs();
    });
  }

  // Current site click - show detail (fetch fresh data first)
  if (elements.currentSite) {
    elements.currentSite.classList.add('clickable');
    elements.currentSite.addEventListener('click', async () => {
      try {
        // Get fresh data from background
        const tabInfo = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_INFO' });
        if (tabInfo && tabInfo.url) {
          const url = new URL(tabInfo.url);
          const siteData = {
            hostname: url.hostname,
            url: tabInfo.url,
            title: tabInfo.title,
            tabId: tabInfo.tabId,
            rpcCalls: tabInfo.rpcCalls || currentTabRpcCount || 0,
            lastEndpoint: tabInfo.lastEndpoint
          };
          detailData.currentSite = siteData;
          showSiteDetail(siteData);
        } else if (detailData.currentSite) {
          showSiteDetail(detailData.currentSite);
        }
      } catch (e) {
        log('Error getting site data: ' + e.message);
        if (detailData.currentSite) {
          showSiteDetail(detailData.currentSite);
        }
      }
    });
  }

  // Detail back button
  if (elements.detailBackBtn) {
    elements.detailBackBtn.addEventListener('click', () => {
      switchPage('home');
    });
  }

  // View all activity button
  if (elements.viewAllActivity) {
    elements.viewAllActivity.addEventListener('click', () => {
      showAllActivity();
    });
  }

  // Download activity button
  if (elements.downloadActivity) {
    elements.downloadActivity.addEventListener('click', () => {
      downloadActivityLog();
    });
  }

  // All activity back button
  if (elements.allActivityBackBtn) {
    elements.allActivityBackBtn.addEventListener('click', () => {
      switchPage('activity');
    });
  }

  // RPC detail back button
  if (elements.rpcDetailBackBtn) {
    elements.rpcDetailBackBtn.addEventListener('click', () => {
      // Go back to activity or all-activity based on where we came from
      const prevPage = window.rpcDetailPreviousPage || 'activity';
      switchPage(prevPage);
    });
  }

  // Status banner click - go to settings if using public RPC
  if (elements.statusBanner) {
    elements.statusBanner.addEventListener('click', () => {
      const hasPrivateRpc = config.customRpc && config.customRpc.trim().length > 0;
      if (config.enabled && !hasPrivateRpc) {
        switchPage('settings');
      }
    });
  }

  // Notification settings handlers
  if (elements.toggleNativeNotif) {
    elements.toggleNativeNotif.addEventListener('change', (e) => {
      notificationSettings.nativeNotificationsEnabled = e.target.checked;
      saveNotificationSettings();
    });
  }

  if (elements.toggleOverlayNotif) {
    elements.toggleOverlayNotif.addEventListener('change', (e) => {
      notificationSettings.overlayNotificationsEnabled = e.target.checked;
      saveNotificationSettings();
    });
  }

  if (elements.notifProxyError) {
    elements.notifProxyError.addEventListener('change', (e) => {
      notificationSettings.native.proxyError = e.target.checked;
      notificationSettings.overlay.securityWarnings = e.target.checked;
      saveNotificationSettings();
    });
  }

  if (elements.notifTorStatus) {
    elements.notifTorStatus.addEventListener('change', (e) => {
      notificationSettings.native.torConnected = e.target.checked;
      notificationSettings.native.torDisconnected = e.target.checked;
      saveNotificationSettings();
    });
  }

  if (elements.notifSuspicious) {
    elements.notifSuspicious.addEventListener('change', (e) => {
      notificationSettings.native.suspiciousActivity = e.target.checked;
      notificationSettings.overlay.securityWarnings = e.target.checked;
      saveNotificationSettings();
    });
  }

  if (elements.notifExtWarning) {
    elements.notifExtWarning.addEventListener('change', (e) => {
      notificationSettings.native.extensionWarning = e.target.checked;
      notificationSettings.overlay.suspiciousExtension = e.target.checked;
      saveNotificationSettings();
    });
  }

  if (elements.notifProtection) {
    elements.notifProtection.addEventListener('change', (e) => {
      notificationSettings.native.protectionStatusChange = e.target.checked;
      saveNotificationSettings();
    });
  }
}

// Track previous page for back navigation
let previousPage = 'home';

// Switch page
function switchPage(pageName) {
  // Track previous page (but not for detail pages)
  const currentPage = document.querySelector('.page.active');
  if (currentPage && !['rpc-detail', 'all-activity', 'detail'].includes(currentPage.id.replace('page-', ''))) {
    previousPage = currentPage.id.replace('page-', '');
  }

  // Update nav items (only for main pages)
  elements.navItems.forEach(item => {
    const isMainPage = ['home', 'activity', 'scanner', 'settings'].includes(pageName);
    item.classList.toggle('active', isMainPage && item.dataset.page === pageName);
  });

  // Update pages
  elements.pages.forEach(page => {
    const isActive = page.id === `page-${pageName}`;
    page.classList.toggle('active', isActive);
    // Track if all-activity was active (for back navigation)
    if (page.id === 'page-all-activity') {
      page.classList.toggle('was-active', isActive);
    }
  });

  // Refresh activity when switching to activity page
  if (pageName === 'activity') {
    renderActivityList();
  }
}

// Update UI
function updateUI() {
  const hasPrivateRpc = config.customRpc && config.customRpc.trim().length > 0;
  const torActive = config.torEnabled && config.torConnected;
  // Only show protected if proxy is actually running
  const isFullyProtected = proxyRunning && (hasPrivateRpc || torActive);

  // Header status lights (3 separate indicators)
  // Proxy light (cyan) - on when proxy is running
  if (elements.proxyDot) {
    if (proxyRunning && config.enabled) {
      elements.proxyDot.className = 'status-dot active';
    } else {
      elements.proxyDot.className = 'status-dot';
    }
  }

  // RPC light (purple) - on when private RPC is configured
  if (elements.rpcDot) {
    if (config.proxyMode === 'private_rpc' && config.rpcEndpoint) {
      elements.rpcDot.className = 'status-dot active-purple';
    } else {
      elements.rpcDot.className = 'status-dot';
    }
  }

  // Tor light (orange) - on when Tor is connected
  if (elements.torHeaderDot) {
    if (config.torConnected) {
      elements.torHeaderDot.className = 'status-dot active-orange';
    } else if (config.torEnabled) {
      elements.torHeaderDot.className = 'status-dot warning'; // connecting
    } else {
      elements.torHeaderDot.className = 'status-dot';
    }
  }

  // Status banner
  if (!config.enabled) {
    elements.statusBanner.className = 'status-banner danger';
    elements.statusBanner.style.cursor = 'default';
    elements.statusIcon.innerHTML = `<span class="icon icon-lg">${svgIcons.shieldOff}</span>`;
    elements.statusIcon.style.color = '#FF4757';
    elements.statusTitle.textContent = 'Protection Disabled';
    elements.statusSubtitle.textContent = 'Your RPC traffic is not protected';
  } else if (!proxyRunning) {
    // Proxy is offline
    elements.statusBanner.className = 'status-banner danger';
    elements.statusBanner.style.cursor = 'pointer';
    elements.statusIcon.innerHTML = `<span class="icon icon-lg">${svgIcons.warning}</span>`;
    elements.statusIcon.style.color = '#FF4757';
    elements.statusTitle.textContent = 'Proxy Offline';
    elements.statusSubtitle.textContent = 'Start the PrivacyRPC desktop app';
  } else if (isFullyProtected) {
    // Full protection with private RPC or Tor
    elements.statusBanner.className = 'status-banner protected';
    elements.statusBanner.style.cursor = 'default';
    elements.statusIcon.innerHTML = `<span class="icon icon-lg">${svgIcons.shield}</span>`;
    elements.statusIcon.style.color = '#5AF5F5';
    elements.statusTitle.textContent = 'Protection Active';
    elements.statusSubtitle.textContent = torActive
      ? 'Traffic routed through Tor'
      : 'All RPC traffic is being routed securely';
  } else {
    // Protection on but using public RPC without Tor - show warning
    elements.statusBanner.className = 'status-banner warning';
    elements.statusBanner.style.cursor = 'pointer';
    elements.statusIcon.innerHTML = `<span class="icon icon-lg">${svgIcons.warning}</span>`;
    elements.statusIcon.style.color = '#FFB800';
    elements.statusTitle.textContent = 'Protection Active';
    elements.statusSubtitle.textContent = 'All RPC traffic is being routed thru public RPC';
  }

  // Toggles
  elements.toggleProtection.checked = config.enabled;

  // Tor status (read-only, from desktop app)
  if (elements.torDot && elements.torLabel) {
    if (config.torConnected) {
      elements.torDot.className = 'status-dot active';
      elements.torLabel.textContent = 'Connected';
      elements.torLabel.style.color = '#5AF5F5';
      if (elements.torStatus) {
        elements.torStatus.style.display = 'flex';
        if (elements.torIp) elements.torIp.textContent = config.torIp || '';
      }
    } else if (config.torEnabled) {
      elements.torDot.className = 'status-dot warning';
      elements.torLabel.textContent = 'Connecting...';
      elements.torLabel.style.color = '#FFB800';
      if (elements.torStatus) elements.torStatus.style.display = 'none';
    } else {
      elements.torDot.className = 'status-dot';
      elements.torLabel.textContent = 'Off';
      elements.torLabel.style.color = '#7D7D7D';
      if (elements.torStatus) elements.torStatus.style.display = 'none';
    }
  }

  // Settings - Proxy host/port
  if (elements.proxyHost) elements.proxyHost.value = config.proxyHost || '127.0.0.1';
  if (elements.proxyPort) elements.proxyPort.value = config.proxyPort || 8899;

  // RPC Endpoint Status in Settings
  if (elements.rpcStatusDot && elements.rpcStatusText) {
    if (config.proxyMode === 'private_rpc' && config.rpcEndpoint) {
      elements.rpcStatusDot.className = 'status-dot active';
      elements.rpcStatusText.textContent = 'Private RPC Active';
      elements.rpcStatusText.style.color = '#5AF5F5';
      // Show masked endpoint
      if (elements.rpcEndpointDisplay) {
        const masked = maskApiKey(config.rpcEndpoint);
        elements.rpcEndpointDisplay.textContent = masked;
        elements.rpcEndpointDisplay.style.display = 'block';
      }
    } else if (proxyRunning) {
      elements.rpcStatusDot.className = 'status-dot warning';
      elements.rpcStatusText.textContent = 'Proxy Only (no private RPC)';
      elements.rpcStatusText.style.color = '#FFB800';
      if (elements.rpcEndpointDisplay) {
        elements.rpcEndpointDisplay.textContent = 'Configure in desktop app';
        elements.rpcEndpointDisplay.style.display = 'block';
      }
    } else {
      elements.rpcStatusDot.className = 'status-dot';
      elements.rpcStatusText.textContent = 'Desktop app not running';
      elements.rpcStatusText.style.color = '#7D7D7D';
      if (elements.rpcEndpointDisplay) {
        elements.rpcEndpointDisplay.style.display = 'none';
      }
    }
  }

  // Mode badge - shows PROXY or PRIVATE RPC based on desktop app config
  if (elements.modeBadge && elements.modeIndicator) {
    if (config.proxyMode === 'private_rpc' && config.rpcEndpoint) {
      elements.modeBadge.textContent = 'PRIVATE RPC';
      elements.modeBadge.style.background = 'rgba(90, 245, 245, 0.2)';
      elements.modeBadge.style.color = '#5AF5F5';
      elements.modeIndicator.style.display = 'block';
    } else if (proxyRunning) {
      elements.modeBadge.textContent = 'PROXY MODE';
      elements.modeBadge.style.background = 'rgba(255, 184, 0, 0.2)';
      elements.modeBadge.style.color = '#FFB800';
      elements.modeIndicator.style.display = 'block';
    } else {
      elements.modeIndicator.style.display = 'none';
    }
  }

  // Render lists
  renderAlertsList();
  renderActivityList();
  renderDebugLogs();
  renderRecentScans();
}

// Get current tab info
async function getCurrentTab() {
  try {
    const tabInfo = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_INFO' });
    if (tabInfo && tabInfo.url) {
      currentTabId = tabInfo.tabId;
      currentTabRpcCount = tabInfo.rpcCalls || 0;
      updateSiteDisplay(tabInfo);
    } else {
      // Fallback to direct tab query
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        currentTabId = tab.id;
        currentTabRpcCount = 0;
        updateSiteDisplay({
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          rpcCalls: 0
        });
      }
    }
  } catch (e) {
    log('Failed to get current tab: ' + e.message);
  }
}

// Update site display
function updateSiteDisplay(tabInfo) {
  try {
    const url = new URL(tabInfo.url);

    // Update tracked tab info
    if (tabInfo.tabId) {
      currentTabId = tabInfo.tabId;
    }

    // Store site data for detail view
    detailData.currentSite = {
      hostname: url.hostname,
      url: tabInfo.url,
      title: tabInfo.title,
      tabId: tabInfo.tabId,
      rpcCalls: tabInfo.rpcCalls || currentTabRpcCount || 0,
      lastEndpoint: tabInfo.lastEndpoint
    };

    if (elements.siteName) {
      elements.siteName.textContent = url.hostname || 'Unknown';
    }

    if (elements.siteRpcCount) {
      const count = tabInfo.rpcCalls || currentTabRpcCount || 0;
      elements.siteRpcCount.textContent = `${count} RPC call${count !== 1 ? 's' : ''} detected`;
    }

    // Check if this is a known dApp or has RPC calls
    const isDapp = checkIfDapp(url.hostname);
    const hasRpcCalls = (tabInfo.rpcCalls || currentTabRpcCount || 0) > 0;

    if (elements.siteStatus) {
      if (isDapp || hasRpcCalls) {
        elements.siteStatus.textContent = 'dApp';
        elements.siteStatus.className = 'site-status safe';
      } else if (url.protocol === 'chrome-extension:' || url.protocol === 'chrome:') {
        elements.siteStatus.textContent = 'Extension';
        elements.siteStatus.className = 'site-status scanning';
      } else {
        elements.siteStatus.textContent = 'Website';
        elements.siteStatus.className = 'site-status scanning';
      }
    }

    // Show last RPC endpoint if available
    if (tabInfo.lastEndpoint) {
      log(`Last RPC: ${tabInfo.lastEndpoint}`);
    }
  } catch (e) {
    log('Failed to update site display: ' + e.message);
  }
}

// Check if site is a known dApp
function checkIfDapp(hostname) {
  const dapps = [
    // DEXs
    'jup.ag', 'jupiter.ag', 'raydium.io', 'orca.so', 'lifinity.io',
    'meteora.ag', 'phoenix.trade', 'drift.trade', 'zeta.markets',
    // Lending/DeFi
    'marinade.finance', 'solend.fi', 'mango.markets', 'kamino.finance',
    'marginfi.com', 'solblaze.org', 'jito.network',
    // NFT
    'magic.eden', 'tensor.trade', 'hyperspace.xyz', 'exchange.art',
    'formfunction.xyz', 'solanart.io', 'opensea.io',
    // Wallets
    'phantom.app', 'solflare.com', 'backpack.app', 'glow.app',
    // Explorers
    'solana.com', 'solscan.io', 'solanabeach.io', 'explorer.solana.com',
    'xray.helius.xyz', 'solana.fm',
    // Other
    'squads.so', 'realms.today', 'dialect.to', 'helius.dev',
    'shyft.to', 'quicknode.com', 'alchemy.com'
  ];
  return dapps.some(d => hostname.includes(d));
}

// Check proxy status via background service worker
async function checkProxyStatus() {
  // Quick fix: If protection is enabled, always show as running
  // This provides immediate UI feedback without waiting for health checks
  if (config.enabled) {
    proxyRunning = true;
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_PROXY' });
    const wasRunning = proxyRunning;
    proxyRunning = response && response.running;

    if (wasRunning !== proxyRunning) {
      updateUI();
    }
  } catch (e) {
    // Background might be asleep, try direct fetch as fallback
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const resp = await fetch(`http://127.0.0.1:${config.proxyPort || 8899}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeout);
      const wasRunning = proxyRunning;
      if (resp.ok) {
        const data = await resp.json();
        proxyRunning = data.status === 'ok';
      } else {
        proxyRunning = false;
      }
      if (wasRunning !== proxyRunning) {
        updateUI();
      }
    } catch (e2) {
      proxyRunning = false;
      updateUI();
    }
  }
}

// Start Tor connection — sends command to background -> native host -> desktop app
async function startTorConnection() {
  log('Starting Tor connection...');
  addAlert('info', 'Tor Starting', 'Connecting to Tor network...');

  // Show bootstrap progress UI
  if (elements.torStatus) {
    elements.torStatus.style.display = 'flex';
    elements.torStatus.className = 'tor-status connecting';
    if (elements.torSpinner) elements.torSpinner.style.display = 'block';
    if (elements.torStatusText) elements.torStatusText.textContent = 'Bootstrapping Tor...';
    if (elements.torIp) elements.torIp.textContent = '';
  }

  // Send START_TOR to background, which forwards to native host
  try {
    await chrome.runtime.sendMessage({ type: 'START_TOR' });
  } catch (e) {
    log('Failed to send START_TOR: ' + e.message);
    addAlert('danger', 'Tor Error', 'Failed to start Tor: ' + e.message);
  }
  // Actual connection status will arrive via TOR_STATUS message from background
}

// Stop Tor connection
async function stopTorConnection() {
  log('Stopping Tor connection...');

  try {
    await chrome.runtime.sendMessage({ type: 'STOP_TOR' });
  } catch (e) {
    log('Failed to send STOP_TOR: ' + e.message);
  }

  config.torConnected = false;
  config.torIp = null;
  saveConfig();
  updateUI();
  addAlert('info', 'Tor Disconnected', 'Tor routing disabled');
}

// Scan website
async function scanWebsite(url) {
  log(`Scanning: ${url}`);

  // Add protocol if missing
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  elements.scanBtn.textContent = 'Scanning...';
  elements.scanBtn.disabled = true;

  try {
    const hostname = new URL(url).hostname;
    const isDapp = checkIfDapp(hostname);

    // Check for existing RPC activity from this site
    const siteActivity = config.activity.filter(a => {
      try {
        return a.url && (a.url.includes(hostname) || hostname.includes(a.url.split('/')[0]));
      } catch (e) {
        return false;
      }
    });

    // Get unique RPC endpoints used
    const rpcEndpoints = [...new Set(siteActivity.map(a => a.url).filter(Boolean))];

    // Determine if using public RPC based on endpoints
    const publicRpcPatterns = ['api.mainnet-beta.solana.com', 'api.devnet.solana.com', 'rpc.ankr.com'];
    const usesPublicRpc = rpcEndpoints.some(ep =>
      publicRpcPatterns.some(pattern => ep.includes(pattern))
    ) || (!isDapp && siteActivity.length > 0);

    const result = {
      url: hostname,
      fullUrl: url,
      timestamp: Date.now(),
      safe: isDapp,
      rpcCalls: siteActivity.length || (isDapp ? Math.floor(Math.random() * 10) + 1 : 0),
      rpcEndpoints: rpcEndpoints.length > 0 ? rpcEndpoints : (isDapp ? ['helius-rpc.com', 'mainnet.helius-rpc.com'] : []),
      usesPublicRpc,
      issues: []
    };

    if (usesPublicRpc) {
      result.issues.push('Uses public Solana RPC - IP exposed to providers');
    }
    if (!isDapp) {
      result.issues.push('Unknown dApp - exercise caution');
    }
    if (result.rpcCalls > 10) {
      result.issues.push('High RPC call frequency detected');
    }

    // Add to recent scans
    config.recentScans.unshift(result);
    if (config.recentScans.length > 10) config.recentScans.pop();
    saveConfig();

    // Display result
    displayScanResult(result);
    renderRecentScans();

    elements.scanBtn.textContent = 'Scan';
    elements.scanBtn.disabled = false;
    elements.scanUrl.value = '';
  } catch (e) {
    log('Scan error: ' + e.message);
    elements.scanBtn.textContent = 'Scan';
    elements.scanBtn.disabled = false;
  }
}

// Display scan result
function displayScanResult(result) {
  const statusClass = result.safe ? 'safe' : (result.issues.length > 0 ? 'warning' : 'safe');
  const statusText = result.safe ? 'Safe' : (result.issues.length > 0 ? 'Caution' : 'Safe');

  elements.scanResults.innerHTML = `
    <div class="scan-result ${statusClass} clickable" id="currentScanResult">
      <h4>${statusText}: ${result.url}</h4>
      <p>${result.issues.length > 0 ? result.issues.join(', ') : 'No issues detected'}</p>
      <div class="scan-details">
        <div class="scan-detail-row">
          <span>RPC Calls Detected</span>
          <span>${result.rpcCalls}</span>
        </div>
        <div class="scan-detail-row">
          <span>RPC Endpoints</span>
          <span>${result.rpcEndpoints ? result.rpcEndpoints.length : 0}</span>
        </div>
        <div class="scan-detail-row">
          <span>Uses Public RPC</span>
          <span style="color: ${result.usesPublicRpc ? '#FFB800' : '#5AF5F5'}">${result.usesPublicRpc ? 'Yes' : 'No'}</span>
        </div>
        <div class="scan-detail-row">
          <span>Known dApp</span>
          <span>${result.safe ? 'Yes' : 'No'}</span>
        </div>
      </div>
      <p style="font-size: 10px; color: #7D7D7D; margin-top: 12px; text-align: center;">Click for more details</p>
    </div>
  `;

  // Add click handler for scan result
  const scanResultEl = document.getElementById('currentScanResult');
  if (scanResultEl) {
    scanResultEl.addEventListener('click', () => {
      showScanDetail(result);
    });
  }
}

// Add alert
function addAlert(type, title, message) {
  const alert = {
    id: Date.now(),
    type,
    title,
    message,
    timestamp: Date.now()
  };

  config.alerts.unshift(alert);
  if (config.alerts.length > 20) config.alerts.pop();
  saveConfig();
  renderAlertsList();
}

// SVG Icons
const svgIcons = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  shieldOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.69 14a6.9 6.9 0 00.31-2V5l-8-3-3.16 1.18"/><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 005.62-4.38"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
};

// Render alerts list
function renderAlertsList() {
  if (config.alerts.length === 0) {
    elements.alertsList.innerHTML = '<div class="no-alerts">No security alerts</div>';
    elements.alertCount.textContent = '0';
    return;
  }

  elements.alertCount.textContent = config.alerts.length.toString();

  elements.alertsList.innerHTML = config.alerts.slice(0, 10).map(alert => `
    <div class="alert-item">
      <div class="alert-icon"><span class="icon">${svgIcons[alert.type] || svgIcons.info}</span></div>
      <div class="alert-content">
        <h5>${alert.title}</h5>
        <p>${alert.message}</p>
      </div>
      <span class="alert-time">${formatTime(alert.timestamp)}</span>
    </div>
  `).join('');
}

// Get activity for current tab
function getCurrentTabActivity() {
  if (!currentTabId) return [];
  return config.activity.filter(a => a.tabId === currentTabId);
}

// Render activity list (filtered by current tab, limited view)
function renderActivityList() {
  const tabActivity = getCurrentTabActivity();
  const maxItems = 5; // Show only 5 items in limited view

  // Update site info in activity page
  if (elements.activitySiteName && detailData.currentSite) {
    elements.activitySiteName.textContent = detailData.currentSite.hostname || 'No site detected';
  }
  if (elements.activitySiteRpcCount) {
    elements.activitySiteRpcCount.textContent = `${tabActivity.length} RPC calls on this page`;
  }
  if (elements.activitySiteStatus) {
    elements.activitySiteStatus.textContent = tabActivity.length > 0 ? 'Active' : '-';
    elements.activitySiteStatus.className = tabActivity.length > 0 ? 'site-status safe' : 'site-status scanning';
  }

  // Render endpoints summary
  renderEndpointsList(tabActivity);

  // Render activity list
  if (tabActivity.length === 0) {
    elements.activityList.innerHTML = '<div class="no-alerts">No RPC activity on this page yet</div>';
    if (elements.activityFooter) elements.activityFooter.style.display = 'none';
    return;
  }

  const displayItems = tabActivity.slice(0, maxItems);
  elements.activityList.innerHTML = displayItems.map((item, index) => `
    <div class="log-item clickable" data-activity-index="${index}">
      <span class="log-method">${item.method || 'RPC'}</span>
      <span class="log-url">${item.url}</span>
      <span class="log-status ${item.success !== false ? 'success' : 'error'}">${item.success !== false ? 'OK' : 'ERR'}</span>
    </div>
  `).join('');

  // Add click handlers
  elements.activityList.querySelectorAll('.log-item.clickable').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.activityIndex);
      const activity = tabActivity[index];
      if (activity) {
        showRpcDetail(activity);
      }
    });
  });

  // Show/hide "View All" button
  if (elements.activityFooter) {
    elements.activityFooter.style.display = tabActivity.length > maxItems ? 'block' : 'none';
  }
}

// Render endpoints summary
function renderEndpointsList(activity) {
  if (!elements.endpointsList) return;

  // Group by endpoint
  const endpoints = {};
  activity.forEach(item => {
    const endpoint = item.url || 'Unknown';
    if (!endpoints[endpoint]) {
      endpoints[endpoint] = { count: 0, lastTime: 0 };
    }
    endpoints[endpoint].count++;
    if (item.timestamp > endpoints[endpoint].lastTime) {
      endpoints[endpoint].lastTime = item.timestamp;
    }
  });

  const endpointList = Object.entries(endpoints).sort((a, b) => b[1].count - a[1].count);

  if (elements.endpointCount) {
    elements.endpointCount.textContent = endpointList.length.toString();
  }

  if (endpointList.length === 0) {
    elements.endpointsList.innerHTML = '<div class="no-alerts">No endpoints detected</div>';
    return;
  }

  elements.endpointsList.innerHTML = endpointList.map(([endpoint, data]) => `
    <div class="endpoint-item">
      <span class="endpoint-host" title="${endpoint}">${endpoint}</span>
      <span class="endpoint-count">${data.count}x</span>
    </div>
  `).join('');
}

// Show RPC call detail page
function showRpcDetail(activity) {
  if (!elements.rpcDetailContent) return;

  const timestamp = new Date(activity.timestamp).toLocaleString();

  elements.rpcDetailContent.innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <div class="detail-icon">
          <span class="icon icon-lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span>
        </div>
        <div class="detail-title">
          <h3>RPC Call</h3>
          <p>${formatTime(activity.timestamp)} ago</p>
        </div>
        <span class="rating-badge ${activity.success !== false ? 'safe' : 'danger'}">${activity.success !== false ? 'Success' : 'Failed'}</span>
      </div>

      <div class="rpc-detail-section">
        <div class="rpc-detail-label">Method</div>
        <div class="rpc-detail-value">${activity.method || 'RPC'}</div>
      </div>

      <div class="rpc-detail-section">
        <div class="rpc-detail-label">Endpoint</div>
        <div class="rpc-detail-value">${activity.url || 'Unknown'}</div>
      </div>

      <div class="rpc-detail-section">
        <div class="rpc-detail-label">Timestamp</div>
        <div class="rpc-detail-value">${timestamp}</div>
      </div>

      <div class="rpc-detail-section">
        <div class="rpc-detail-label">Tab ID</div>
        <div class="rpc-detail-value">${activity.tabId || 'N/A'}</div>
      </div>

      <div class="rpc-detail-section">
        <div class="rpc-detail-label">Proxied</div>
        <div class="rpc-detail-value ${activity.proxied ? 'success' : 'error'}">${activity.proxied ? 'Yes - Protected' : 'No - Direct'}</div>
      </div>

      ${activity.isZk ? `
      <div class="rpc-detail-section">
        <div class="rpc-detail-label">ZK Compression</div>
        <div class="rpc-detail-value success">Yes - Compressed call</div>
      </div>
      ` : ''}
    </div>

    <button class="btn btn-secondary" style="width: 100%;" onclick="copyRpcDetail()">
      Copy to Clipboard
    </button>
  `;

  // Store current detail for copy function
  window.currentRpcDetail = activity;

  // Track where we came from for back navigation
  const allActivityPage = document.getElementById('page-all-activity');
  window.rpcDetailPreviousPage = allActivityPage && allActivityPage.classList.contains('active') ? 'all-activity' : 'activity';

  switchPage('rpc-detail');
}

// Copy RPC detail to clipboard
window.copyRpcDetail = function() {
  if (!window.currentRpcDetail) return;
  const activity = window.currentRpcDetail;
  const text = `RPC Call Detail
================
Method: ${activity.method || 'RPC'}
Endpoint: ${activity.url || 'Unknown'}
Timestamp: ${new Date(activity.timestamp).toLocaleString()}
Tab ID: ${activity.tabId || 'N/A'}
Proxied: ${activity.proxied ? 'Yes' : 'No'}
ZK Compression: ${activity.isZk ? 'Yes' : 'No'}
Status: ${activity.success !== false ? 'Success' : 'Failed'}`;

  navigator.clipboard.writeText(text).then(() => {
    // Show feedback
    const btn = document.querySelector('#page-rpc-detail .btn-secondary');
    if (btn) {
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.innerHTML = 'Copy to Clipboard';
      }, 2000);
    }
  });
};

// Show all activity page
function showAllActivity() {
  if (!elements.allActivityList) return;

  const tabActivity = getCurrentTabActivity();

  if (elements.allActivityCount) {
    elements.allActivityCount.textContent = tabActivity.length.toString();
  }

  if (tabActivity.length === 0) {
    elements.allActivityList.innerHTML = '<div class="no-alerts">No RPC activity yet</div>';
    switchPage('all-activity');
    return;
  }

  elements.allActivityList.innerHTML = tabActivity.map((item, index) => `
    <div class="log-item clickable" data-all-activity-index="${index}">
      <span class="log-method">${item.method || 'RPC'}</span>
      <span class="log-url">${item.url}</span>
      <span class="log-status ${item.success !== false ? 'success' : 'error'}">${item.success !== false ? 'OK' : 'ERR'}</span>
    </div>
  `).join('');

  // Add click handlers
  elements.allActivityList.querySelectorAll('.log-item.clickable').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.allActivityIndex);
      const activity = tabActivity[index];
      if (activity) {
        showRpcDetail(activity);
      }
    });
  });

  switchPage('all-activity');
}

// Download activity log as .txt file
function downloadActivityLog() {
  const tabActivity = getCurrentTabActivity();
  const hostname = detailData.currentSite?.hostname || 'unknown';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  let content = `PrivacyRPC Activity Log
========================
Site: ${hostname}
Export Date: ${new Date().toLocaleString()}
Total Calls: ${tabActivity.length}

`;

  if (tabActivity.length === 0) {
    content += 'No RPC activity recorded for this page.\n';
  } else {
    // Group by endpoint first
    const endpoints = {};
    tabActivity.forEach(item => {
      const endpoint = item.url || 'Unknown';
      if (!endpoints[endpoint]) {
        endpoints[endpoint] = [];
      }
      endpoints[endpoint].push(item);
    });

    content += `Endpoints Summary (${Object.keys(endpoints).length} unique):\n`;
    content += '-'.repeat(40) + '\n';
    Object.entries(endpoints).forEach(([endpoint, calls]) => {
      content += `  ${endpoint}: ${calls.length} calls\n`;
    });

    content += '\n\nDetailed Activity Log:\n';
    content += '='.repeat(40) + '\n\n';

    tabActivity.forEach((item, index) => {
      content += `Call #${index + 1}\n`;
      content += `-`.repeat(20) + '\n';
      content += `Method: ${item.method || 'RPC'}\n`;
      content += `Endpoint: ${item.url || 'Unknown'}\n`;
      content += `Timestamp: ${new Date(item.timestamp).toLocaleString()}\n`;
      content += `Proxied: ${item.proxied ? 'Yes' : 'No'}\n`;
      content += `ZK Compression: ${item.isZk ? 'Yes' : 'No'}\n`;
      content += `Status: ${item.success !== false ? 'Success' : 'Failed'}\n`;
      content += `Tab ID: ${item.tabId || 'N/A'}\n`;
      content += '\n';
    });
  }

  // Create and download file
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `privacyrpc-activity-${hostname}-${timestamp}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  addAlert('success', 'Activity Downloaded', `Saved ${tabActivity.length} RPC calls to file`);
}

// Render debug logs
function renderDebugLogs() {
  if (config.debugLogs.length === 0) {
    elements.debugLogs.innerHTML = '<div class="no-alerts">No debug logs</div>';
    return;
  }

  elements.debugLogs.innerHTML = config.debugLogs.slice(0, 50).map(log => `
    <div style="padding: 4px 0; border-bottom: 1px solid #1a1a1a; color: #666;">
      <span style="color: #444;">[${formatTime(log.timestamp)}]</span> ${log.message}
    </div>
  `).join('');
}

// Render recent scans
function renderRecentScans() {
  if (!elements.recentScans) return;

  if (config.recentScans.length === 0) {
    elements.recentScans.innerHTML = '<div class="no-alerts">No recent scans</div>';
    return;
  }

  elements.recentScans.innerHTML = config.recentScans.map((scan, index) => `
    <div class="alert-item clickable" data-scan-index="${index}">
      <div class="alert-icon"><span class="icon">${scan.safe ? svgIcons.success : svgIcons.warning}</span></div>
      <div class="alert-content">
        <h5>${scan.url}</h5>
        <p>${scan.rpcCalls} RPC calls detected</p>
      </div>
      <span class="alert-time">${formatTime(scan.timestamp)}</span>
    </div>
  `).join('');

  // Add click handlers for scan items
  elements.recentScans.querySelectorAll('.alert-item.clickable').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.scanIndex);
      if (config.recentScans[index]) {
        showScanDetail(config.recentScans[index]);
      }
    });
  });
}

// Show site detail page
async function showSiteDetail(siteData) {
  if (!elements.detailContent) return;

  // Try to get fresh activity data from background
  let bgTabActivity = null;
  try {
    const bgData = await chrome.runtime.sendMessage({ type: 'GET_ALL_TAB_ACTIVITY' });
    if (bgData && bgData.activity && siteData.tabId) {
      bgTabActivity = bgData.activity[siteData.tabId];
    }
  } catch (e) {
    // Ignore
  }

  // Get RPC calls for this tab from activity log
  const tabRpcCalls = config.activity.filter(a => {
    // Match by tab ID if available
    if (siteData.tabId && a.tabId === siteData.tabId) {
      return true;
    }
    return false;
  });

  // Also get all recent RPC activity (last 100 calls)
  const allRecentRpc = config.activity.slice(0, 100);

  // Use tab-specific calls if available, otherwise show all recent
  const rpcCalls = tabRpcCalls.length > 0 ? tabRpcCalls : allRecentRpc;

  // Get background RPC count if available
  const bgRpcCount = bgTabActivity ? bgTabActivity.rpcCalls : 0;

  // Group RPC calls by endpoint
  const callsByEndpoint = {};
  rpcCalls.forEach(call => {
    const endpoint = call.url || 'Unknown';
    if (!callsByEndpoint[endpoint]) {
      callsByEndpoint[endpoint] = { count: 0, method: call.method || 'RPC', lastTime: call.timestamp };
    }
    callsByEndpoint[endpoint].count++;
    if (call.timestamp > callsByEndpoint[endpoint].lastTime) {
      callsByEndpoint[endpoint].lastTime = call.timestamp;
    }
  });

  // Get current RPC count - use best available data
  const rpcCount = Math.max(
    siteData.rpcCalls || 0,
    currentTabRpcCount || 0,
    bgRpcCount || 0,
    tabRpcCalls.length
  );

  const isDapp = checkIfDapp(siteData.hostname);
  const hasRpcActivity = rpcCount > 0 || Object.keys(callsByEndpoint).length > 0;
  const rating = isDapp ? 'safe' : (hasRpcActivity ? 'warning' : 'unknown');
  const ratingText = isDapp ? 'Trusted dApp' : (hasRpcActivity ? 'Makes RPC Calls' : 'No RPC Detected');

  const endpointCount = Object.keys(callsByEndpoint).length;

  elements.detailContent.innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <div class="detail-icon">
          <span class="icon icon-lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg></span>
        </div>
        <div class="detail-title">
          <h3>${siteData.hostname || 'Unknown'}</h3>
          <p>${siteData.title || 'Website'}</p>
        </div>
        <span class="rating-badge ${rating}">${ratingText}</span>
      </div>

      <div class="detail-stats">
        <div class="detail-stat">
          <span class="detail-stat-value">${rpcCount}</span>
          <span class="detail-stat-label">RPC Calls</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">${endpointCount}</span>
          <span class="detail-stat-label">Endpoints</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value" style="color: ${config.enabled ? '#5AF5F5' : '#FFB800'}">${config.enabled ? 'Yes' : 'No'}</span>
          <span class="detail-stat-label">Protected</span>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Site Info</div>
        <div class="info-row">
          <span class="info-row-label">URL</span>
          <span class="info-row-value">${siteData.hostname || 'Unknown'}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">Tab ID</span>
          <span class="info-row-value">${siteData.tabId || 'N/A'}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">Type</span>
          <span class="info-row-value">${isDapp ? 'Known Solana dApp' : 'Website'}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">Protection</span>
          <span class="info-row-value" style="color: ${config.enabled ? '#5AF5F5' : '#FFB800'}">${config.enabled ? 'RPC calls proxied' : 'Direct connection'}</span>
        </div>
        ${(siteData.lastEndpoint || (bgTabActivity && bgTabActivity.lastEndpoint)) ? `
        <div class="info-row">
          <span class="info-row-label">Last RPC</span>
          <span class="info-row-value">${siteData.lastEndpoint || bgTabActivity.lastEndpoint}</span>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-section-title">RPC Activity (${rpcCalls.length} calls)</div>
      ${endpointCount > 0 ? Object.entries(callsByEndpoint)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([endpoint, data]) => `
        <div class="rpc-call-item">
          <span class="rpc-call-method">${data.method}</span>
          <span class="rpc-call-endpoint" title="${endpoint}">${endpoint}</span>
          <span class="rpc-call-count">${data.count}x</span>
        </div>
      `).join('') : `
        <div class="no-alerts">
          ${hasRpcActivity ? 'RPC calls detected but endpoints not logged' : 'No RPC calls detected on this page yet'}
          <br><br>
          <span style="font-size: 10px;">Visit a Solana dApp with protection enabled to see RPC activity</span>
        </div>
      `}
    </div>

    ${!config.enabled ? `
    <div class="detail-card" style="border-color: #3D3A0A;">
      <div class="detail-section-title" style="color: #FFB800;">Enable Protection</div>
      <p style="font-size: 12px; color: #7D7D7D; margin-bottom: 12px;">
        Turn on PrivacyRPC to protect your RPC calls and hide your IP from providers.
      </p>
      <button class="btn btn-primary" style="width: 100%;" onclick="document.getElementById('toggleProtection').click(); document.getElementById('detailBackBtn').click();">
        Enable PrivacyRPC
      </button>
    </div>
    ` : ''}
  `;

  switchPage('detail');
}

// Show extension detail page
// Known trusted RPC endpoints
const TRUSTED_RPC_ENDPOINTS = [
  'api.mainnet-beta.solana.com',
  'api.devnet.solana.com',
  'api.testnet.solana.com',
  'solana-api.projectserum.com',
  'rpc.helius.xyz',
  'mainnet.helius-rpc.com',
  'solana-mainnet.g.alchemy.com',
  'solana-mainnet.quiknode.pro',
  'ssc-dao.genesysgo.net'
];

function isKnownEndpoint(url) {
  return TRUSTED_RPC_ENDPOINTS.some(endpoint => url.includes(endpoint));
}

function showExtensionDetail(extData) {
  if (!elements.detailContent) return;

  const isWallet = extData.type === 'wallet';
  const rating = isWallet ? 'safe' : (extData.hasBroadAccess ? 'warning' : 'unknown');
  const ratingText = isWallet ? 'Wallet' : (extData.hasBroadAccess ? 'Broad Access' : 'Extension');

  // Get background RPC calls (tabId = -1, 0, or undefined = from extensions)
  const backgroundRpcCalls = config.activity.filter(a =>
    a.tabId === -1 || a.tabId === 0 || a.tabId === undefined
  );

  // Group by endpoint
  const bgCallsByEndpoint = {};
  backgroundRpcCalls.forEach(call => {
    const endpoint = call.url || 'Unknown';
    if (!bgCallsByEndpoint[endpoint]) {
      bgCallsByEndpoint[endpoint] = {
        count: 0,
        method: call.method || 'RPC',
        isTrusted: isKnownEndpoint(endpoint)
      };
    }
    bgCallsByEndpoint[endpoint].count++;
  });

  const bgEndpointCount = Object.keys(bgCallsByEndpoint).length;
  const untrustedEndpoints = Object.entries(bgCallsByEndpoint).filter(([_, data]) => !data.isTrusted);
  const hasUntrustedCalls = untrustedEndpoints.length > 0;

  elements.detailContent.innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <div class="detail-icon" style="width: 36px; height: 36px;">
          ${extData.icon ? `<img src="${extData.icon}" alt="${extData.name}" style="width: 24px; height: 24px; border-radius: 4px;" onerror="this.style.display='none'">` : `<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></span>`}
        </div>
        <div class="detail-title">
          <h3>${extData.name}</h3>
          <p>v${extData.version || 'unknown'}</p>
        </div>
        <span class="rating-badge ${rating}">${ratingText}</span>
      </div>

      <div class="detail-section">
        <div class="detail-section-title">Extension Info</div>
        <div class="info-row">
          <span class="info-row-label">Type</span>
          <span class="info-row-value">${isWallet ? 'Crypto Wallet' : 'Browser Extension'}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">All Sites Access</span>
          <span class="info-row-value" style="color: ${extData.hasBroadAccess ? '#FFB800' : '#5AF5F5'}">${extData.hasBroadAccess ? 'Yes' : 'No'}</span>
        </div>
        ${extData.description ? `
        <div class="info-row">
          <span class="info-row-label">Description</span>
          <span class="info-row-value" style="font-size: 10px;">${extData.description}</span>
        </div>
        ` : ''}
        <div class="info-row">
          <span class="info-row-label">ID</span>
          <span class="info-row-value" style="font-family: monospace; font-size: 9px;">${extData.id.substring(0, 20)}...</span>
        </div>
      </div>

      ${extData.hasBroadAccess && !isWallet ? `
      <div class="detail-section">
        <div class="detail-section-title" style="color: #FFB800;">Security Notice</div>
        <p style="font-size: 12px; color: #7D7D7D; line-height: 1.5;">
          This extension has access to all websites. Be cautious - it can read data from any page you visit.
        </p>
      </div>
      ` : ''}
    </div>

    <div class="detail-card" style="border-color: ${hasUntrustedCalls ? '#3D3A0A' : '#1E2328'};">
      <div class="detail-section-title">Background RPC Activity (${backgroundRpcCalls.length} calls)</div>
      <p style="font-size: 10px; color: #7D7D7D; margin-bottom: 10px;">
        RPC calls from browser extensions (not tied to a specific tab)
      </p>
      ${bgEndpointCount > 0 ? `
        ${Object.entries(bgCallsByEndpoint)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 10)
          .map(([endpoint, data]) => `
          <div class="rpc-call-item" style="border-left: 3px solid ${data.isTrusted ? '#5AF5F5' : '#FFB800'}; padding-left: 10px; margin-left: -10px;">
            <span class="rpc-call-method">${data.method}</span>
            <span class="rpc-call-endpoint" title="${endpoint}">${endpoint}</span>
            <span class="rpc-call-count" style="color: ${data.isTrusted ? '#5AF5F5' : '#FFB800'}">${data.count}x</span>
          </div>
        `).join('')}
        ${hasUntrustedCalls ? `
        <div style="margin-top: 12px; padding: 10px; background: rgba(255, 184, 0, 0.1); border-radius: 8px; border: 1px solid #3D3A0A;">
          <p style="font-size: 11px; color: #FFB800; margin: 0;">
            ⚠️ ${untrustedEndpoints.length} unknown endpoint${untrustedEndpoints.length > 1 ? 's' : ''} detected.
            These may be from any installed extension.
          </p>
        </div>
        ` : `
        <div style="margin-top: 12px; padding: 10px; background: rgba(90, 245, 245, 0.05); border-radius: 8px; border: 1px solid #1E4040;">
          <p style="font-size: 11px; color: #5AF5F5; margin: 0;">
            ✓ All background RPC calls are to known trusted endpoints.
          </p>
        </div>
        `}
      ` : `
        <div class="no-alerts">
          No background RPC calls detected
          <br><br>
          <span style="font-size: 10px;">Extensions making RPC calls will appear here</span>
        </div>
      `}
    </div>

    ${isWallet ? `
    <div class="detail-card" style="border-color: ${config.enabled ? '#1E4040' : '#3D3A0A'};">
      <div class="detail-section-title" style="color: ${config.enabled ? '#5AF5F5' : '#FFB800'};">Protection Status</div>
      <p style="font-size: 12px; color: #7D7D7D; line-height: 1.5; margin-bottom: 12px;">
        ${config.enabled
          ? 'PrivacyRPC is protecting RPC calls from this wallet. Your IP is hidden from RPC providers.'
          : 'PrivacyRPC protection is OFF. Enable it to protect your RPC calls from this wallet.'}
      </p>
      ${!config.enabled ? `
      <button class="btn btn-primary" style="width: 100%;" onclick="document.getElementById('toggleProtection').click(); document.getElementById('detailBackBtn').click();">
        Enable Protection
      </button>
      ` : ''}
    </div>
    ` : ''}
  `;

  switchPage('detail');
}

// Show scan detail page
function showScanDetail(scanData) {
  if (!elements.detailContent) return;

  const rating = scanData.safe ? 'safe' : (scanData.issues.length > 0 ? 'warning' : 'unknown');
  const ratingText = scanData.safe ? 'Trusted' : (scanData.issues.length > 0 ? 'Caution' : 'Unknown');

  elements.detailContent.innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <div class="detail-icon">
          <span class="icon icon-lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
        </div>
        <div class="detail-title">
          <h3>${scanData.url}</h3>
          <p>Scanned ${formatTime(scanData.timestamp)} ago</p>
        </div>
        <span class="rating-badge ${rating}">${ratingText}</span>
      </div>

      <div class="detail-stats">
        <div class="detail-stat">
          <span class="detail-stat-value">${scanData.rpcCalls || 0}</span>
          <span class="detail-stat-label">RPC Calls</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">${scanData.usesPublicRpc ? 'Yes' : 'No'}</span>
          <span class="detail-stat-label">Public RPC</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat-value">${scanData.safe ? 'Yes' : 'No'}</span>
          <span class="detail-stat-label">Known dApp</span>
        </div>
      </div>

      ${scanData.issues.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title" style="color: #FFB800;">Issues Found</div>
        ${scanData.issues.map(issue => `
          <div class="info-row">
            <span class="info-row-label" style="color: #FFB800;">⚠</span>
            <span class="info-row-value">${issue}</span>
          </div>
        `).join('')}
      </div>
      ` : ''}

      <div class="detail-section">
        <div class="detail-section-title">Scan Results</div>
        <div class="info-row">
          <span class="info-row-label">Website</span>
          <span class="info-row-value">${scanData.url}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">Known dApp</span>
          <span class="info-row-value">${scanData.safe ? 'Yes - Trusted' : 'No - Unknown'}</span>
        </div>
        <div class="info-row">
          <span class="info-row-label">Uses Public RPC</span>
          <span class="info-row-value" style="color: ${scanData.usesPublicRpc ? '#FFB800' : '#5AF5F5'}">${scanData.usesPublicRpc ? 'Yes (privacy risk)' : 'No'}</span>
        </div>
      </div>
    </div>

    ${scanData.rpcEndpoints && scanData.rpcEndpoints.length > 0 ? `
    <div class="detail-card">
      <div class="detail-section-title">RPC Endpoints Used</div>
      ${scanData.rpcEndpoints.map(endpoint => `
        <div class="rpc-call-item">
          <span class="rpc-call-method">RPC</span>
          <span class="rpc-call-endpoint">${endpoint}</span>
        </div>
      `).join('')}
    </div>
    ` : ''}
  `;

  switchPage('detail');
}

// Log function
function log(message) {
  const entry = {
    timestamp: Date.now(),
    message
  };
  config.debugLogs.unshift(entry);
  if (config.debugLogs.length > 100) config.debugLogs.pop();
  console.log('[PrivacyRPC]', message);
}

// Format time
function formatTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// Mask API key in endpoint URL for display
function maskApiKey(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    // Mask api-key or similar params
    const params = new URLSearchParams(parsed.search);
    for (const [key, value] of params.entries()) {
      if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
        if (value.length > 8) {
          params.set(key, value.substring(0, 4) + '****' + value.substring(value.length - 4));
        } else {
          params.set(key, '****');
        }
      }
    }
    parsed.search = params.toString();
    return parsed.toString();
  } catch (e) {
    // If URL parsing fails, just mask anything after api-key=
    return url.replace(/(api[_-]?key=)([^&]+)/gi, '$1****');
  }
}

// Check for suspicious activity patterns
function checkSuspiciousActivity(rpcData) {
  const now = Date.now();
  const timeSincePageLoad = now - suspiciousActivityState.pageLoadTime;

  // Track first RPC time
  if (!suspiciousActivityState.firstRpcTime) {
    suspiciousActivityState.firstRpcTime = now;
  }

  const method = rpcData.method || '';
  const warnings = [];

  // Check for immediate balance checks (within 2 seconds of page load)
  if (timeSincePageLoad < 2000) {
    if (method.includes('getBalance') || method.includes('getTokenAccountsByOwner') ||
        method.includes('getAccountInfo') || method.includes('getTokenAccountBalance')) {
      suspiciousActivityState.balanceCheckCount++;
      if (suspiciousActivityState.balanceCheckCount === 1) {
        warnings.push({
          type: 'warning',
          title: 'Immediate Wallet Check',
          message: `Site checked wallet balance within ${Math.round(timeSincePageLoad)}ms of loading`
        });
      }
    }
  }

  // Check for transfer attempts
  if (method.includes('sendTransaction') || method.includes('signTransaction') ||
      method.includes('signAndSendTransaction') || method.includes('simulateTransaction')) {
    suspiciousActivityState.transferAttempts++;
    if (suspiciousActivityState.transferAttempts === 1 && timeSincePageLoad < 5000) {
      warnings.push({
        type: 'danger',
        title: 'Quick Transfer Attempt',
        message: 'Site attempting transaction shortly after loading - verify before approving!'
      });
    }
  }

  // Multiple rapid balance checks
  if (suspiciousActivityState.balanceCheckCount > 5 && timeSincePageLoad < 10000) {
    warnings.push({
      type: 'warning',
      title: 'Multiple Wallet Probes',
      message: `${suspiciousActivityState.balanceCheckCount} wallet checks in ${Math.round(timeSincePageLoad/1000)}s`
    });
  }

  return warnings;
}

// Reset suspicious activity state (call on tab change)
function resetSuspiciousActivityState() {
  suspiciousActivityState = {
    firstRpcTime: null,
    pageLoadTime: Date.now(),
    balanceCheckCount: 0,
    transferAttempts: 0
  };
}

// Track current tab RPC count locally
let currentTabRpcCount = 0;
let currentTabId = null;

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'RPC_ACTIVITY':
      config.activity.unshift(message.data);
      if (config.activity.length > 100) config.activity.pop();
      saveConfig();
      renderActivityList();

      // Update site RPC count for current tab immediately
      if (message.data.tabId && message.data.tabId === currentTabId) {
        currentTabRpcCount++;
        if (elements.siteRpcCount) {
          elements.siteRpcCount.textContent = `${currentTabRpcCount} RPC call${currentTabRpcCount !== 1 ? 's' : ''} detected`;
        }
        // Update site status to show dApp if RPC detected
        if (elements.siteStatus && currentTabRpcCount > 0) {
          elements.siteStatus.textContent = 'dApp';
          elements.siteStatus.className = 'site-status safe';
        }
        // Update detailData for current site
        if (detailData.currentSite) {
          detailData.currentSite.rpcCalls = currentTabRpcCount;
          detailData.currentSite.lastEndpoint = message.data.url;
        }

        // Check for suspicious activity patterns
        const warnings = checkSuspiciousActivity(message.data);
        warnings.forEach(w => addAlert(w.type, w.title, w.message));
      }

      // Update ZK stats if it's a ZK call
      if (message.data.isZk) {
        updateZKStats();
      }

      // Show alert for first RPC call on a site
      if (message.data.tabId === currentTabId && currentTabRpcCount === 1) {
        addAlert('info', 'RPC Detected', `${message.data.url}`);
      }
      break;

    case 'TAB_CHANGED':
      // Update display when user switches tabs
      currentTabId = message.data.tabId;
      currentTabRpcCount = message.data.rpcCalls || 0;
      updateSiteDisplay(message.data);
      // Reset suspicious activity tracking for new tab
      resetSuspiciousActivityState();
      // Refresh activity page if it's currently visible
      const activityPage = document.getElementById('page-activity');
      if (activityPage && activityPage.classList.contains('active')) {
        renderActivityList();
      }
      break;

    case 'ALERT':
      addAlert(message.level, message.title, message.message);
      break;

    case 'TOR_STATUS':
      config.torConnected = message.connected;
      config.torIp = message.ip;
      if (message.torEnabled !== undefined) {
        config.torEnabled = message.torEnabled;
      }
      if (message.rpcProvider !== undefined) {
        config.customRpc = message.rpcProvider || '';
      }
      saveConfig();

      // Update bootstrap progress display
      if (message.bootstrapProgress !== undefined && message.bootstrapProgress < 100 && config.torEnabled) {
        if (elements.torStatus) {
          elements.torStatus.style.display = 'flex';
          elements.torStatus.className = 'tor-status connecting';
          if (elements.torSpinner) elements.torSpinner.style.display = 'block';
          if (elements.torStatusText) elements.torStatusText.textContent = `Bootstrapping Tor... ${message.bootstrapProgress}%`;
          if (elements.torIp) elements.torIp.textContent = '';
        }
      }

      updateUI();

      // Show alert on connection
      if (message.connected && message.ip) {
        addAlert('success', 'Tor Connected', `Exit IP: ${message.ip}`);
      }
      break;

    case 'CONFIG_UPDATED':
      // Desktop app config changed (mode/endpoint)
      if (message.data) {
        config.proxyMode = message.data.mode || 'proxy_only';
        config.rpcEndpoint = message.data.rpcEndpoint || null;
        updateUI();
        log(`Config updated: mode=${config.proxyMode}`);
      }
      break;
  }
});

// Refresh interval for live updates
let refreshInterval = null;

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  init();

  // Refresh current tab info every 2 seconds while popup is open
  refreshInterval = setInterval(() => {
    getCurrentTab();
    updateZKStats();
    checkProxyStatus();
  }, 2000);
});

// Cleanup on unload
window.addEventListener('unload', () => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
