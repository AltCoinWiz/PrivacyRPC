/**
 * PrivacyRPC Content Script
 * Handles in-page overlay notifications
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__privacyRpcContentScriptLoaded) return;
  window.__privacyRpcContentScriptLoaded = true;

  // Inject the page-context script for wallet interception
  function injectScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('content/injected.js');
      script.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('[PrivacyRPC] Injected wallet interceptor');
    } catch (e) {
      console.error('[PrivacyRPC] Failed to inject script:', e);
    }
  }

  // Inject early
  injectScript();

  // ============================================================================
  // PROXY STATUS COMMUNICATION
  // Use custom events to tell injected script about proxy status (CSP-safe)
  // ============================================================================

  // Set proxy enabled flag via custom event (works with strict CSP)
  function setProxyEnabled(enabled) {
    // Dispatch custom event that injected script listens for
    window.dispatchEvent(new CustomEvent('privacyrpc-proxy-status', {
      detail: { enabled: enabled }
    }));
    console.log('[PrivacyRPC] Proxy routing:', enabled ? 'ENABLED' : 'DISABLED');
  }

  // Track current proxy status to re-send when injected script signals ready
  let currentProxyEnabled = false;

  // Listen for injected script ready signal
  window.addEventListener('privacyrpc-injected-ready', () => {
    console.log('[PrivacyRPC] Injected script ready, sending proxy status');
    setProxyEnabled(currentProxyEnabled);
  });

  // Modified checkProxyStatus to store the result
  async function updateProxyStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      if (!response || !response.enabled) {
        currentProxyEnabled = false;
        setProxyEnabled(false);
        return;
      }
      const proxyCheck = await chrome.runtime.sendMessage({ type: 'CHECK_PROXY' });
      currentProxyEnabled = proxyCheck && proxyCheck.running;
      setProxyEnabled(currentProxyEnabled);
    } catch (e) {
      console.log('[PrivacyRPC] Could not check proxy status:', e);
      currentProxyEnabled = false;
      setProxyEnabled(false);
    }
  }

  // Check status immediately
  updateProxyStatus();

  // Listen for config changes from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CONFIG_UPDATED') {
      // Re-check proxy status when config changes
      updateProxyStatus();
    }
    // ... rest of handlers below
  });

  // Notification container
  let container = null;
  const notifications = new Map();
  let notificationCounter = 0;

  // SVG Icons
  const icons = {
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    shieldOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19.69 14a6.9 6.9 0 00.31-2V5l-8-3-3.16 1.18"/><path d="M4.73 4.73L4 5v7c0 6 8 10 8 10a20.29 20.29 0 005.62-4.38"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    tor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 000 20M12 2c2.5 2 4 5.5 4 10s-1.5 8-4 10M12 2c-2.5 2-4 5.5-4 10s1.5 8 4 10"/></svg>',
    extension: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>',
    proxy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>'
  };

  // Priority to class mapping
  const priorityClasses = {
    100: 'privacyrpc-critical',
    80: 'privacyrpc-high',
    50: 'privacyrpc-medium',
    20: 'privacyrpc-low'
  };

  // Get priority class
  function getPriorityClass(priority) {
    if (priority >= 100) return 'privacyrpc-critical';
    if (priority >= 80) return 'privacyrpc-high';
    if (priority >= 50) return 'privacyrpc-medium';
    return 'privacyrpc-low';
  }

  // Get icon for notification type
  function getIcon(type) {
    const iconMap = {
      'TOR_CONNECTED': icons.tor,
      'TOR_DISCONNECTED': icons.tor,
      'PROXY_ERROR': icons.proxy,
      'PROTECTION_ON': icons.shield,
      'PROTECTION_OFF': icons.shieldOff,
      'SUSPICIOUS_RPC': icons.warning,
      'EXT_WARNING': icons.extension,
      'UNPROTECTED_DAPP': icons.alert,
      'RPC_BLOCKED': icons.shield
    };
    return iconMap[type] || icons.alert;
  }

  // Create notification container
  function ensureContainer() {
    // Wait for document.body to exist
    if (!document.body) {
      return null;
    }

    if (container && document.body.contains(container)) return container;

    container = document.createElement('div');
    container.className = 'privacyrpc-notification-container';
    container.id = 'privacyrpc-notifications';
    document.body.appendChild(container);
    return container;
  }

  // Show notification (with DOM ready retry)
  function showNotification(data, retryCount = 0) {
    const {
      id = `privacyrpc-notif-${++notificationCounter}`,
      type = 'INFO',
      title = 'PrivacyRPC',
      message = '',
      priority = 50,
      duration = 5000,
      actions = []
    } = data;

    // Try to get/create container
    const currentContainer = ensureContainer();

    // If DOM not ready, retry after a short delay (up to 10 retries = 1 second)
    if (!currentContainer) {
      if (retryCount < 10) {
        setTimeout(() => showNotification(data, retryCount + 1), 100);
        return null;
      } else {
        console.warn('[PrivacyRPC] Could not create notification container after retries');
        return null;
      }
    }

    // Remove existing notification with same id
    if (notifications.has(id)) {
      closeNotification(id, true);
    }

    const priorityClass = getPriorityClass(priority);
    const icon = getIcon(type);

    // Create notification element
    const notif = document.createElement('div');
    notif.className = `privacyrpc-notification ${priorityClass}`;
    notif.setAttribute('data-id', id);
    notif.style.position = 'relative';

    // Build notification HTML
    let actionsHtml = '';
    if (actions.length > 0) {
      actionsHtml = `
        <div class="privacyrpc-notification-actions">
          ${actions.map((action, i) => `
            <button class="privacyrpc-notification-btn ${i === 0 ? 'privacyrpc-notification-btn-primary' : 'privacyrpc-notification-btn-secondary'}" data-action="${action.action || action.label}">
              ${action.label}
            </button>
          `).join('')}
        </div>
      `;
    }

    notif.innerHTML = `
      <div class="privacyrpc-notification-icon">${icon}</div>
      <div class="privacyrpc-notification-content">
        <div class="privacyrpc-notification-title">${escapeHtml(title)}</div>
        <p class="privacyrpc-notification-message">${escapeHtml(message)}</p>
        ${actionsHtml}
      </div>
      <button class="privacyrpc-notification-close">${icons.close}</button>
      ${duration > 0 ? `<div class="privacyrpc-notification-progress" style="animation-duration: ${duration}ms;"></div>` : ''}
    `;

    // Add event listeners
    const closeBtn = notif.querySelector('.privacyrpc-notification-close');
    closeBtn.addEventListener('click', () => closeNotification(id));

    // Action button handlers
    const actionBtns = notif.querySelectorAll('.privacyrpc-notification-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        handleAction(id, action);
        closeNotification(id);
      });
    });

    // Add to container
    currentContainer.appendChild(notif);
    notifications.set(id, { element: notif, timeout: null });

    // Auto-dismiss after duration
    if (duration > 0) {
      const timeout = setTimeout(() => closeNotification(id), duration);
      notifications.get(id).timeout = timeout;
    }

    return id;
  }

  // Close notification
  function closeNotification(id, immediate = false) {
    const notifData = notifications.get(id);
    if (!notifData) return;

    const { element, timeout } = notifData;

    // Clear timeout
    if (timeout) clearTimeout(timeout);

    if (immediate) {
      element.remove();
      notifications.delete(id);
    } else {
      // Add closing animation
      element.classList.add('privacyrpc-closing');
      setTimeout(() => {
        element.remove();
        notifications.delete(id);
      }, 250);
    }
  }

  // Handle action button click
  function handleAction(notificationId, action) {
    // Send action to background
    chrome.runtime.sendMessage({
      type: 'NOTIFICATION_ACTION',
      notificationId,
      action
    });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_OVERLAY_NOTIFICATION') {
      const id = showNotification(message.notification);
      sendResponse({ success: true, id });
    } else if (message.type === 'CLOSE_OVERLAY_NOTIFICATION') {
      closeNotification(message.id);
      sendResponse({ success: true });
    } else if (message.type === 'PING') {
      // Health check
      sendResponse({ pong: true });
    }
    return true;
  });

  // ============================================================================
  // TRANSACTION DECODER OVERLAY
  // Shows decoded transaction info before signing
  // ============================================================================

  let txOverlay = null;
  let pendingTxResolve = null;

  // Risk level colors
  const riskColors = {
    'Low': '#5AF5F5',
    'Medium': '#FFB800',
    'High': '#FF6B00',
    'Critical': '#FF4757'
  };

  // Create transaction overlay
  function createTxOverlay() {
    if (txOverlay && document.body.contains(txOverlay)) return txOverlay;

    txOverlay = document.createElement('div');
    txOverlay.className = 'privacyrpc-tx-overlay';
    txOverlay.id = 'privacyrpc-tx-overlay';
    txOverlay.innerHTML = `
      <div class="privacyrpc-tx-backdrop"></div>
      <div class="privacyrpc-tx-modal">
        <div class="privacyrpc-tx-header">
          <div class="privacyrpc-tx-header-icon">${icons.shield}</div>
          <div class="privacyrpc-tx-header-text">
            <h2>Transaction Review</h2>
            <p>PrivacyRPC has decoded this transaction</p>
          </div>
          <button class="privacyrpc-tx-close">${icons.close}</button>
        </div>
        <div class="privacyrpc-tx-body">
          <div class="privacyrpc-tx-loading">
            <div class="privacyrpc-tx-spinner"></div>
            <p>Decoding transaction...</p>
          </div>
          <div class="privacyrpc-tx-content" style="display: none;"></div>
        </div>
        <div class="privacyrpc-tx-footer">
          <button class="privacyrpc-tx-btn privacyrpc-tx-btn-reject">Reject</button>
          <button class="privacyrpc-tx-btn privacyrpc-tx-btn-approve">Approve</button>
        </div>
      </div>
    `;

    // Event listeners
    txOverlay.querySelector('.privacyrpc-tx-backdrop').addEventListener('click', () => rejectTx());
    txOverlay.querySelector('.privacyrpc-tx-close').addEventListener('click', () => rejectTx());
    txOverlay.querySelector('.privacyrpc-tx-btn-reject').addEventListener('click', () => rejectTx());
    txOverlay.querySelector('.privacyrpc-tx-btn-approve').addEventListener('click', () => approveTx());

    document.body.appendChild(txOverlay);
    return txOverlay;
  }

  // Show transaction overlay with decoded info
  function showTxOverlay(decoded) {
    createTxOverlay();

    const loadingEl = txOverlay.querySelector('.privacyrpc-tx-loading');
    const contentEl = txOverlay.querySelector('.privacyrpc-tx-content');
    const riskColor = riskColors[decoded.risk_level] || '#7D7D7D';

    // Build warnings HTML
    let warningsHtml = '';
    if (decoded.warnings && decoded.warnings.length > 0) {
      warningsHtml = `
        <div class="privacyrpc-tx-warnings">
          <h4>Warnings</h4>
          ${decoded.warnings.map(w => `
            <div class="privacyrpc-tx-warning privacyrpc-tx-warning-${w.level.toLowerCase()}">
              <span class="privacyrpc-tx-warning-icon">${icons.warning}</span>
              <div>
                <strong>${escapeHtml(w.title)}</strong>
                <p>${escapeHtml(w.message)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Build instructions HTML
    let instructionsHtml = '';
    if (decoded.instructions && decoded.instructions.length > 0) {
      instructionsHtml = `
        <div class="privacyrpc-tx-instructions">
          <h4>Instructions (${decoded.instructions.length})</h4>
          ${decoded.instructions.map(inst => `
            <div class="privacyrpc-tx-instruction">
              <div class="privacyrpc-tx-instruction-header">
                <span class="privacyrpc-tx-instruction-program">${escapeHtml(inst.program)}</span>
                <span class="privacyrpc-tx-instruction-action">${escapeHtml(inst.action)}</span>
              </div>
              ${renderInstructionDetails(inst.details)}
            </div>
          `).join('')}
        </div>
      `;
    }

    // Origin info if available
    const originHtml = decoded.origin ? `
      <div class="privacyrpc-tx-origin">
        <span>Requesting site:</span>
        <strong>${escapeHtml(decoded.origin)}</strong>
      </div>
    ` : '';

    contentEl.innerHTML = `
      ${originHtml}
      <div class="privacyrpc-tx-summary">
        <div class="privacyrpc-tx-summary-icon" style="color: ${riskColor};">${icons.shield}</div>
        <div class="privacyrpc-tx-summary-text">
          <h3>${escapeHtml(decoded.summary)}</h3>
          <span class="privacyrpc-tx-risk" style="background: ${riskColor}20; color: ${riskColor}; border: 1px solid ${riskColor}40;">
            ${decoded.risk_level} Risk
          </span>
        </div>
      </div>
      ${warningsHtml}
      ${instructionsHtml}
      ${decoded.estimated_cost ? `
        <div class="privacyrpc-tx-cost">
          <span>Estimated Cost:</span>
          <strong>${decoded.estimated_cost.toFixed(6)} SOL</strong>
        </div>
      ` : ''}
    `;

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
    txOverlay.classList.add('privacyrpc-tx-visible');

    // If critical risk, highlight approve button as dangerous
    if (decoded.risk_level === 'Critical' || decoded.risk_level === 'High') {
      const approveBtn = txOverlay.querySelector('.privacyrpc-tx-btn-approve');
      approveBtn.classList.add('privacyrpc-tx-btn-danger');
      approveBtn.textContent = 'Approve Anyway';
    }
  }

  // Render instruction details
  function renderInstructionDetails(details) {
    if (!details || details.type === 'Unknown') {
      return details.data_preview ? `<code class="privacyrpc-tx-code">${escapeHtml(details.data_preview)}</code>` : '';
    }

    switch (details.type) {
      case 'SolTransfer':
        return `
          <div class="privacyrpc-tx-detail">
            <div class="privacyrpc-tx-detail-row">
              <span>From:</span>
              <code>${shortenAddress(details.from)}</code>
            </div>
            <div class="privacyrpc-tx-detail-row">
              <span>To:</span>
              <code>${shortenAddress(details.to)}</code>
            </div>
            <div class="privacyrpc-tx-detail-row privacyrpc-tx-amount">
              <span>Amount:</span>
              <strong>${details.amount_sol.toFixed(6)} SOL</strong>
            </div>
          </div>
        `;
      case 'TokenTransfer':
        return `
          <div class="privacyrpc-tx-detail">
            <div class="privacyrpc-tx-detail-row">
              <span>From:</span>
              <code>${shortenAddress(details.from)}</code>
            </div>
            <div class="privacyrpc-tx-detail-row">
              <span>To:</span>
              <code>${shortenAddress(details.to)}</code>
            </div>
            <div class="privacyrpc-tx-detail-row privacyrpc-tx-amount">
              <span>Amount:</span>
              <strong>${details.amount} tokens</strong>
            </div>
          </div>
        `;
      case 'TokenApprove':
        return `
          <div class="privacyrpc-tx-detail privacyrpc-tx-detail-warning">
            <div class="privacyrpc-tx-detail-row">
              <span>Source:</span>
              <code>${shortenAddress(details.source)}</code>
            </div>
            <div class="privacyrpc-tx-detail-row">
              <span>Delegate:</span>
              <code>${shortenAddress(details.delegate)}</code>
            </div>
            <div class="privacyrpc-tx-detail-row privacyrpc-tx-amount">
              <span>Amount:</span>
              <strong style="color: #FFB800;">${details.amount === 18446744073709551615 ? 'UNLIMITED' : details.amount} tokens</strong>
            </div>
          </div>
        `;
      default:
        return '';
    }
  }

  // Shorten address for display
  function shortenAddress(addr) {
    if (!addr || addr.length < 12) return addr || 'Unknown';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  }

  // Hide transaction overlay
  function hideTxOverlay() {
    if (txOverlay) {
      txOverlay.classList.remove('privacyrpc-tx-visible');
      const contentEl = txOverlay.querySelector('.privacyrpc-tx-content');
      const loadingEl = txOverlay.querySelector('.privacyrpc-tx-loading');
      if (contentEl) contentEl.style.display = 'none';
      if (loadingEl) loadingEl.style.display = 'block';
    }
  }

  // Approve transaction
  function approveTx() {
    console.log('[PrivacyRPC] Approve clicked, pendingTxResolve:', !!pendingTxResolve);
    hideTxOverlay();
    if (pendingTxResolve) {
      console.log('[PrivacyRPC] Resolving with approved: true');
      pendingTxResolve({ approved: true });
      pendingTxResolve = null;
    } else {
      console.warn('[PrivacyRPC] No pending resolve function!');
    }
  }

  // Reject transaction
  function rejectTx() {
    hideTxOverlay();
    if (pendingTxResolve) {
      pendingTxResolve({ approved: false });
      pendingTxResolve = null;
    }
  }

  // Decode transaction via proxy
  async function decodeTransaction(encodedTx) {
    try {
      const response = await fetch('http://127.0.0.1:8899/decode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: encodedTx })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.decoded) {
          return data.decoded;
        }
      }
    } catch (e) {
      console.log('[PrivacyRPC] Failed to decode transaction:', e);
    }
    return null;
  }

  // Request transaction approval - shows overlay and waits for user decision
  async function requestTxApproval(encodedTx) {
    createTxOverlay();
    txOverlay.classList.add('privacyrpc-tx-visible');

    // Decode the transaction
    const decoded = await decodeTransaction(encodedTx);

    if (decoded) {
      showTxOverlay(decoded);
    } else {
      // Show error state
      const loadingEl = txOverlay.querySelector('.privacyrpc-tx-loading');
      loadingEl.innerHTML = `
        <div class="privacyrpc-tx-error">
          <span>${icons.warning}</span>
          <p>Could not decode transaction</p>
          <small>Approve with caution</small>
        </div>
      `;
    }

    // Wait for user decision
    return new Promise(resolve => {
      pendingTxResolve = resolve;
    });
  }

  // Listen for transaction decode requests from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_OVERLAY_NOTIFICATION') {
      const id = showNotification(message.notification);
      sendResponse({ success: true, id });
    } else if (message.type === 'CLOSE_OVERLAY_NOTIFICATION') {
      closeNotification(message.id);
      sendResponse({ success: true });
    } else if (message.type === 'PING') {
      sendResponse({ pong: true });
    } else if (message.type === 'SHOW_TX_OVERLAY') {
      // Show transaction decoder overlay
      requestTxApproval(message.transaction).then(result => {
        sendResponse(result);
      });
      return true; // Keep channel open for async
    } else if (message.type === 'SHOW_DECODED_TX') {
      // Show already-decoded transaction
      createTxOverlay();
      txOverlay.classList.add('privacyrpc-tx-visible');
      showTxOverlay(message.decoded);
      new Promise(resolve => {
        pendingTxResolve = resolve;
      }).then(result => {
        sendResponse(result);
      });
      return true;
    }
    return true;
  });

  // Listen for custom events from the page (for demo purposes)
  window.addEventListener('privacyrpc-show-tx-overlay', async (event) => {
    if (event.detail && event.detail.decoded) {
      createTxOverlay();
      txOverlay.classList.add('privacyrpc-tx-visible');
      showTxOverlay(event.detail.decoded);
    }
  });

  // ============================================================================
  // RPC PROXY RELAY - Forward RPC requests from injected script to background
  // This bypasses page CSP by routing through the extension
  // ============================================================================

  window.addEventListener('privacyrpc-rpc-request', async (event) => {
    const { targetUrl, body, messageId } = event.detail || {};

    console.log('[PrivacyRPC-CS] Received RPC request from page:', { targetUrl, messageId, bodyLength: body?.length });

    if (!targetUrl || !body || !messageId) {
      console.warn('[PrivacyRPC-CS] Invalid RPC request - missing fields');
      return;
    }

    try {
      console.log('[PrivacyRPC-CS] Sending to background script...');

      // Send to background script which will make the actual fetch
      const result = await chrome.runtime.sendMessage({
        type: 'PROXY_RPC_REQUEST',
        targetUrl: targetUrl,
        body: body
      });

      console.log('[PrivacyRPC-CS] Background response:', result?.success ? 'SUCCESS' : 'FAILED', result?.error || '');

      // Send response back to injected script
      window.dispatchEvent(new CustomEvent('privacyrpc-rpc-response', {
        detail: { messageId, result }
      }));
      console.log('[PrivacyRPC-CS] Response sent back to page');
    } catch (e) {
      console.error('[PrivacyRPC-CS] RPC relay error:', e);
      window.dispatchEvent(new CustomEvent('privacyrpc-rpc-response', {
        detail: { messageId, error: e.message }
      }));
    }
  });

  // Listen for transaction interception requests from injected script
  window.addEventListener('privacyrpc-request', async (event) => {
    const { type, data, messageId } = event.detail || {};

    if (type === 'INTERCEPT_TRANSACTION') {
      console.log('[PrivacyRPC] Intercepted transaction request:', data);

      // Check if auto-block is enabled
      try {
        const result = await chrome.storage.local.get(['autoBlockEnabled']);
        if (result.autoBlockEnabled) {
          console.log('[PrivacyRPC] Auto-block enabled, rejecting transaction');
          window.dispatchEvent(new CustomEvent('privacyrpc-response', {
            detail: { messageId, result: { approved: false, autoBlocked: true } }
          }));
          return;
        }
      } catch (e) {
        console.log('[PrivacyRPC] Could not check auto-block setting:', e);
      }

      try {
        // Decode the first transaction (or combine info for multiple)
        let decoded = null;
        const transactions = data.transactions || [];

        if (transactions.length > 0) {
          // Try to decode via proxy
          decoded = await decodeTransaction(transactions[0]);

          // If multiple transactions, note that in the summary
          if (transactions.length > 1 && decoded) {
            decoded.summary = `${transactions.length} transactions: ${decoded.summary}`;
          }
        }

        // Show the overlay and wait for user decision
        createTxOverlay();
        txOverlay.classList.add('privacyrpc-tx-visible');

        if (decoded) {
          // Add origin info to the decoded data
          decoded.origin = data.origin;
          decoded.method = data.method;
          showTxOverlay(decoded);
        } else {
          // Show warning that we couldn't decode
          const loadingEl = txOverlay.querySelector('.privacyrpc-tx-loading');
          if (loadingEl) {
            loadingEl.innerHTML = `
              <div class="privacyrpc-tx-error">
                <span>${icons.warning}</span>
                <p>Could not decode transaction</p>
                <small>From: ${escapeHtml(data.origin || 'Unknown')}</small>
                <small style="margin-top: 8px;">Review carefully in your wallet</small>
              </div>
            `;
          }
        }

        // Wait for user decision
        console.log('[PrivacyRPC] Waiting for user decision...');
        const result = await new Promise(resolve => {
          pendingTxResolve = resolve;
        });

        console.log('[PrivacyRPC] User decided:', result);
        // Send response back to injected script
        window.dispatchEvent(new CustomEvent('privacyrpc-response', {
          detail: { messageId, result }
        }));
        console.log('[PrivacyRPC] Response sent to injected script');

      } catch (e) {
        console.error('[PrivacyRPC] Error handling intercept:', e);
        // On error, allow the transaction (don't block the user)
        window.dispatchEvent(new CustomEvent('privacyrpc-response', {
          detail: { messageId, result: { approved: true }, error: e.message }
        }));
      }
    }
  });

  // ============================================================================
  // DOM-BASED PHISHING DETECTION
  // Scans page content for scam patterns
  // ============================================================================

  // Track what we've already warned about on this page
  const domWarnings = new Set();


  // Urgency/scam language patterns
  const URGENCY_PATTERNS = [
    /act now/i, /limited time/i, /expires? (in|soon)/i, /hurry/i,
    /don'?t miss/i, /last chance/i, /ending soon/i, /claim (your |now|free)/i,
    /free (airdrop|tokens?|nft|mint)/i, /congratulations/i, /you('ve| have)? (been |)won/i,
    /selected for/i, /eligible for/i, /unclaimed (tokens?|rewards?|airdrop)/i,
    /urgent/i, /immediately/i, /act fast/i, /before it'?s (too late|gone)/i
  ];


  // Scan for urgency/scam language
  function scanForUrgencyLanguage() {
    if (domWarnings.has('urgency')) return;

    const pageText = document.body?.innerText || '';
    let matchCount = 0;
    const matches = [];

    for (const pattern of URGENCY_PATTERNS) {
      if (pattern.test(pageText)) {
        matchCount++;
        matches.push(pattern.source);
        if (matchCount >= 3) break; // 3+ matches = definitely suspicious
      }
    }

    if (matchCount >= 2) {
      domWarnings.add('urgency');
      showNotification({
        type: 'EXT_WARNING',
        title: 'Scam Language Detected',
        message: 'This page uses urgency tactics common in scams. Be very careful before connecting your wallet.',
        priority: 80,
        duration: 10000,
        actions: [
          { label: 'Trust Site', action: 'dismiss' },
          { label: 'Leave', action: 'close_tab' }
        ]
      });
      console.log('[PrivacyRPC] Urgency language detected:', matches);
    }
  }

  // Seed phrase keywords - if page mentions these + has many inputs = SCAM
  const SEED_PHRASE_KEYWORDS = [
    /seed\s*phrase/i, /recovery\s*phrase/i, /secret\s*phrase/i,
    /mnemonic/i, /12[\s-]*word/i, /24[\s-]*word/i,
    /backup\s*phrase/i, /wallet\s*phrase/i, /import\s*wallet/i,
    /restore\s*wallet/i, /enter\s*your\s*(seed|phrase|words)/i
  ];

  // Scan for seed phrase input forms
  // Rule: NO legitimate website asks for your seed phrase. EVER.
  // Wallets are apps/extensions, not websites.
  function scanForSeedPhraseForm() {
    if (domWarnings.has('seedphrase')) return;

    // Count text/password inputs on the page
    const inputs = document.querySelectorAll('input[type="text"], input[type="password"], input:not([type])');
    const inputCount = inputs.length;

    // Need at least 12 inputs (standard seed phrase length)
    if (inputCount < 12) return;

    // Check if page mentions seed phrase related keywords
    const pageText = document.body?.innerText || '';
    let hasKeyword = false;

    for (const pattern of SEED_PHRASE_KEYWORDS) {
      if (pattern.test(pageText)) {
        hasKeyword = true;
        break;
      }
    }

    // 12+ inputs AND seed phrase keywords = DEFINITE SCAM
    if (hasKeyword) {
      domWarnings.add('seedphrase');
      showNotification({
        type: 'EXT_WARNING',
        title: 'SEED PHRASE SCAM',
        message: 'This page is asking for your seed phrase. NO legitimate website ever asks for this. This is a SCAM designed to steal your wallet.',
        priority: 100,
        duration: 0, // Don't auto-dismiss - this is critical
        actions: [
          { label: 'Leave Now', action: 'close_tab' },
          { label: 'I Understand the Risk', action: 'dismiss' }
        ]
      });
      console.log('[PrivacyRPC] SEED PHRASE SCAM DETECTED - inputs:', inputCount);
    }
  }

  // Social media referrers - scam links commonly spread here
  const SOCIAL_REFERRERS = [
    { pattern: /twitter\.com|x\.com|t\.co/i, name: 'Twitter/X' },
    { pattern: /discord\.com|discord\.gg|discordapp\.com/i, name: 'Discord' },
    { pattern: /t\.me|telegram\./i, name: 'Telegram' },
    { pattern: /reddit\.com/i, name: 'Reddit' }
  ];

  // Check if user arrived from social media link
  function checkSocialReferrer() {
    if (domWarnings.has('socialref')) return;

    const referrer = document.referrer || '';
    if (!referrer) return; // Direct navigation, no warning

    for (const social of SOCIAL_REFERRERS) {
      if (social.pattern.test(referrer)) {
        domWarnings.add('socialref');
        showNotification({
          type: 'EXT_WARNING',
          title: 'Social Media Link',
          message: `You arrived from ${social.name}. Scam links spread on social media - verify this is legitimate before connecting your wallet.`,
          priority: 60,
          duration: 8000,
          actions: [
            { label: 'Got It', action: 'dismiss' },
            { label: 'Leave', action: 'close_tab' }
          ]
        });
        console.log('[PrivacyRPC] Social referrer detected:', social.name, referrer);
        break;
      }
    }
  }

  // Run DOM scans when page is ready
  function runDomScans() {
    // Check referrer immediately (doesn't need DOM)
    checkSocialReferrer();

    // Small delay to let page render
    setTimeout(() => {
      scanForUrgencyLanguage();
      scanForSeedPhraseForm();
    }, 1000);

    // Re-scan after more content loads (SPAs)
    setTimeout(() => {
      scanForUrgencyLanguage();
      scanForSeedPhraseForm();
    }, 3000);
  }

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runDomScans);
  } else {
    runDomScans();
  }

  // Also scan on major DOM changes (for SPAs)
  const observer = new MutationObserver((mutations) => {
    // Debounce - only scan once per second max
    if (!observer.scanning) {
      observer.scanning = true;
      setTimeout(() => {
        scanForUrgencyLanguage();
        scanForSeedPhraseForm();
        observer.scanning = false;
      }, 1000);
    }
  });

  // Start observing once body exists
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Log initialization
  console.log('[PrivacyRPC] Content script loaded with transaction decoder + DOM scanning');
})();
