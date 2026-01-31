/**
 * PrivacyRPC Content Script
 * Handles in-page overlay notifications
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__privacyRpcContentScriptLoaded) return;
  window.__privacyRpcContentScriptLoaded = true;

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
    if (container && document.body.contains(container)) return container;

    container = document.createElement('div');
    container.className = 'privacyrpc-notification-container';
    container.id = 'privacyrpc-notifications';
    document.body.appendChild(container);
    return container;
  }

  // Show notification
  function showNotification(data) {
    const {
      id = `privacyrpc-notif-${++notificationCounter}`,
      type = 'INFO',
      title = 'PrivacyRPC',
      message = '',
      priority = 50,
      duration = 5000,
      actions = []
    } = data;

    ensureContainer();

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
    container.appendChild(notif);
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

  // Log initialization
  console.log('[PrivacyRPC] Content script loaded');
})();
