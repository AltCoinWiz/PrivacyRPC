/**
 * PrivacyRPC Injected Script
 * Runs in PAGE context to intercept wallet adapter calls and RPC requests
 * Intercepts signTransaction BEFORE it reaches Phantom
 * Intercepts fetch/XHR to route RPC calls through the proxy
 */

(function() {
  'use strict';

  // Don't run twice
  if (window.__privacyRpcInjected) return;
  window.__privacyRpcInjected = true;

  console.log('[PrivacyRPC] Injected script loaded');

  // ============================================================================
  // RPC ROUTING - Intercept fetch/XHR to route through proxy
  // ============================================================================

  const PROXY_URL = 'http://127.0.0.1:8899';

  // RPC endpoint patterns to intercept
  const RPC_PATTERNS = [
    /solana/i,
    /helius/i,
    /alchemy/i,
    /quicknode/i,
    /quiknode/i,
    /triton/i,
    /syndica/i,
    /ankr\.com/i,
    /getblock/i,
    /chainstack/i,
    /blockdaemon/i,
    /genesysgo/i,
    /jito/i,
    /astralane/i,
    /shyft/i,
    /extrnode/i,
    /rpcpool/i,
    /mainnet/i,
    /devnet/i,
    /testnet/i,
  ];

  // Check if URL is an RPC endpoint
  function isRpcUrl(url) {
    try {
      const parsed = new URL(url);
      // Skip localhost (that's our proxy)
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return false;
      }
      // Check against patterns
      return RPC_PATTERNS.some(pattern => pattern.test(parsed.hostname));
    } catch {
      return false;
    }
  }

  // Check if request body looks like JSON-RPC
  function isJsonRpcBody(body) {
    if (!body) return false;
    try {
      const str = typeof body === 'string' ? body : new TextDecoder().decode(body);
      return str.includes('jsonrpc') || str.includes('"method"');
    } catch {
      return false;
    }
  }

  // Store original fetch
  const originalFetch = window.fetch;

  // Intercepted fetch
  window.fetch = async function(input, init = {}) {
    // Get URL string
    let url = typeof input === 'string' ? input : input.url;

    // Check if proxy is enabled (set by content script)
    const proxyEnabled = window.__privacyRpcProxyEnabled === true;

    // Only intercept if: proxy enabled + RPC URL + POST method + JSON-RPC body
    if (proxyEnabled && isRpcUrl(url)) {
      const method = init.method || (input.method) || 'GET';

      if (method.toUpperCase() === 'POST') {
        // Get body
        let body = init.body;
        if (input instanceof Request && !body) {
          body = await input.clone().text();
        }

        // Check if it's JSON-RPC
        if (isJsonRpcBody(body)) {
          console.log('[PrivacyRPC] Routing RPC call through proxy:', url);

          // Route through content script -> background script (bypasses page CSP)
          try {
            const proxyResult = await sendRpcThroughExtension(url, body);
            console.log('[PrivacyRPC] Proxy result:', JSON.stringify(proxyResult).substring(0, 200));
            if (proxyResult && proxyResult.success) {
              // Create a fake Response object with the proxy data
              return new Response(JSON.stringify(proxyResult.data), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            // If proxy failed, fall through to original fetch
            console.warn('[PrivacyRPC] Proxy request failed, falling back to direct. Result:', proxyResult);
          } catch (e) {
            console.warn('[PrivacyRPC] Proxy request failed, falling back to direct:', e.message);
            // Fall through to original fetch
          }
        }
      }
    }

    // Use original fetch for everything else
    return originalFetch.call(window, input, init);
  };

  // Store original XMLHttpRequest
  const OriginalXHR = window.XMLHttpRequest;

  // Intercepted XMLHttpRequest - routes RPC calls through extension relay (bypasses CSP)
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    let targetUrl = null;
    let requestMethod = null;
    let isRpc = false;

    // Store original open
    const originalOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url, ...args) {
      targetUrl = url;
      requestMethod = method;
      const proxyEnabled = window.__privacyRpcProxyEnabled === true;
      isRpc = proxyEnabled && method.toUpperCase() === 'POST' && isRpcUrl(url);

      if (isRpc) {
        console.log('[PrivacyRPC] Will route XHR RPC through extension relay:', url);
      }

      // Always open with original URL - we'll intercept at send() if needed
      return originalOpen.call(this, method, url, ...args);
    };

    // Store original send
    const originalSend = xhr.send.bind(xhr);
    xhr.send = function(body) {
      if (isRpc && targetUrl && isJsonRpcBody(body)) {
        console.log('[PrivacyRPC] Routing XHR through extension relay');

        // Route through extension relay instead of direct XHR (bypasses CSP)
        sendRpcThroughExtension(targetUrl, body)
          .then(result => {
            if (result && result.success) {
              // Simulate successful XHR response
              const responseText = JSON.stringify(result.data);
              Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });
              Object.defineProperty(xhr, 'status', { value: 200, writable: false });
              Object.defineProperty(xhr, 'statusText', { value: 'OK', writable: false });
              Object.defineProperty(xhr, 'responseText', { value: responseText, writable: false });
              Object.defineProperty(xhr, 'response', { value: responseText, writable: false });

              // Fire events
              if (xhr.onreadystatechange) xhr.onreadystatechange();
              if (xhr.onload) xhr.onload();
              xhr.dispatchEvent(new Event('load'));
              xhr.dispatchEvent(new Event('loadend'));
            } else {
              // Proxy failed, fall back to original request
              console.warn('[PrivacyRPC] XHR relay failed, falling back to direct:', result?.error);
              return originalSend.call(this, body);
            }
          })
          .catch(err => {
            console.warn('[PrivacyRPC] XHR relay error, falling back to direct:', err.message);
            return originalSend.call(this, body);
          });

        return; // Don't call original send - we're handling it via relay
      }

      return originalSend.call(this, body);
    };

    return xhr;
  };

  // Copy static properties
  window.XMLHttpRequest.UNSENT = OriginalXHR.UNSENT;
  window.XMLHttpRequest.OPENED = OriginalXHR.OPENED;
  window.XMLHttpRequest.HEADERS_RECEIVED = OriginalXHR.HEADERS_RECEIVED;
  window.XMLHttpRequest.LOADING = OriginalXHR.LOADING;
  window.XMLHttpRequest.DONE = OriginalXHR.DONE;

  // Listen for proxy status updates from content script
  window.addEventListener('privacyrpc-proxy-status', (event) => {
    const enabled = event.detail?.enabled === true;
    window.__privacyRpcProxyEnabled = enabled;
    console.log('[PrivacyRPC] Proxy status updated:', enabled ? 'ENABLED' : 'DISABLED');
  });

  // Default to false until we hear from content script
  window.__privacyRpcProxyEnabled = false;

  console.log('[PrivacyRPC] Fetch/XHR interception ready');

  // Signal to content script that we're ready to receive proxy status
  window.dispatchEvent(new CustomEvent('privacyrpc-injected-ready'));

  // ============================================================================
  // RPC PROXY VIA EXTENSION - Routes RPC calls through background script
  // This bypasses page CSP which blocks connections to localhost
  // ============================================================================

  // Send RPC request through extension (background script makes the actual fetch)
  function sendRpcThroughExtension(targetUrl, body) {
    return new Promise((resolve, reject) => {
      const messageId = `privacyrpc-rpc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const handler = (event) => {
        if (event.detail && event.detail.messageId === messageId) {
          window.removeEventListener('privacyrpc-rpc-response', handler);
          if (event.detail.error) {
            reject(new Error(event.detail.error));
          } else {
            resolve(event.detail.result);
          }
        }
      };

      window.addEventListener('privacyrpc-rpc-response', handler);

      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('privacyrpc-rpc-response', handler);
        reject(new Error('RPC proxy timeout'));
      }, 30000);

      // Send request to content script
      window.dispatchEvent(new CustomEvent('privacyrpc-rpc-request', {
        detail: { targetUrl, body, messageId }
      }));
    });
  }

  // ============================================================================
  // WALLET INTERCEPTION - Original code below
  // ============================================================================

  console.log('[PrivacyRPC] Wallet interceptor ready');

  // Store original wallet methods
  const originalMethods = new Map();
  const interceptedWalletObjects = new WeakSet();

  // Communication with content script via custom events
  function sendToContentScript(type, data) {
    return new Promise((resolve, reject) => {
      const messageId = `privacyrpc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const handler = (event) => {
        console.log('[PrivacyRPC] Received response event:', event.detail);
        if (event.detail && event.detail.messageId === messageId) {
          console.log('[PrivacyRPC] Message ID matches, resolving...');
          window.removeEventListener('privacyrpc-response', handler);
          if (event.detail.error) {
            reject(new Error(event.detail.error));
          } else {
            console.log('[PrivacyRPC] Resolving with result:', event.detail.result);
            resolve(event.detail.result);
          }
        }
      };

      window.addEventListener('privacyrpc-response', handler);

      // Timeout after 60 seconds (user might take time to decide)
      setTimeout(() => {
        window.removeEventListener('privacyrpc-response', handler);
        reject(new Error('PrivacyRPC timeout'));
      }, 60000);

      window.dispatchEvent(new CustomEvent('privacyrpc-request', {
        detail: { type, data, messageId }
      }));
    });
  }

  // Convert transaction to base64 for decoding
  function transactionToBase64(transaction) {
    try {
      // Handle different transaction formats
      if (transaction.serialize) {
        // Solana web3.js Transaction object
        const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
        return btoa(String.fromCharCode(...serialized));
      } else if (transaction instanceof Uint8Array) {
        return btoa(String.fromCharCode(...transaction));
      } else if (typeof transaction === 'string') {
        // Already base64 or base58
        return transaction;
      } else if (transaction.serializedMessage) {
        // VersionedTransaction
        return btoa(String.fromCharCode(...transaction.serializedMessage));
      }
    } catch (e) {
      console.log('[PrivacyRPC] Could not serialize transaction:', e);
    }
    return null;
  }

  // Intercept a wallet method
  function interceptMethod(wallet, methodName) {
    if (!wallet[methodName]) return;

    const original = wallet[methodName].bind(wallet);
    originalMethods.set(`${wallet.constructor?.name || 'wallet'}.${methodName}`, original);

    wallet[methodName] = async function(...args) {
      console.log(`[PrivacyRPC] Intercepted ${methodName}`, args);

      try {
        // Extract transaction(s) from arguments
        let transactions = [];

        if (methodName === 'signTransaction' || methodName === 'signAndSendTransaction') {
          if (args[0]) transactions = [args[0]];
        } else if (methodName === 'signAllTransactions') {
          if (args[0] && Array.isArray(args[0])) transactions = args[0];
        }

        // Encode transactions for decoding
        const encodedTxs = transactions
          .map(tx => transactionToBase64(tx))
          .filter(Boolean);

        if (encodedTxs.length > 0) {
          // Send to content script for approval
          const result = await sendToContentScript('INTERCEPT_TRANSACTION', {
            method: methodName,
            transactions: encodedTxs,
            origin: window.location.origin,
            href: window.location.href
          });

          if (!result || !result.approved) {
            console.log('[PrivacyRPC] Transaction rejected by user');
            throw new Error('Transaction rejected by PrivacyRPC');
          }

          console.log('[PrivacyRPC] Transaction approved, passing to wallet');
        }
      } catch (e) {
        if (e.message === 'Transaction rejected by PrivacyRPC') {
          throw e;
        }
        // If our interception fails, log but don't block the transaction
        console.warn('[PrivacyRPC] Interception error (allowing transaction):', e);
      }

      // Call original method
      return original(...args);
    };
  }

  // Intercept a wallet provider
  function interceptWallet(wallet, name) {
    if (!wallet) return;
    if (interceptedWalletObjects.has(wallet)) return; // Already intercepted this exact wallet object

    console.log(`[PrivacyRPC] Intercepting wallet: ${name}`);
    interceptedWalletObjects.add(wallet);

    // Methods to intercept
    const methods = [
      'signTransaction',
      'signAllTransactions',
      'signAndSendTransaction'
    ];

    let interceptedCount = 0;
    methods.forEach(method => {
      try {
        if (wallet[method]) {
          interceptMethod(wallet, method);
          interceptedCount++;
        }
      } catch (e) {
        console.log(`[PrivacyRPC] Could not intercept ${method}:`, e);
      }
    });

    console.log(`[PrivacyRPC] Intercepted ${interceptedCount} methods on ${name}`);
  }

  // Watch for wallet injection
  function watchForWallet() {
    // Check common wallet providers
    const walletChecks = [
      { prop: 'solana', name: 'Phantom/Solana' },
      { prop: 'phantom', subProp: 'solana', name: 'Phantom' },
      { prop: 'solflare', name: 'Solflare' },
      { prop: 'backpack', name: 'Backpack' },
      { prop: 'braveSolana', name: 'Brave' },
      { prop: 'coinbaseSolana', name: 'Coinbase' },
      { prop: 'glow', subProp: 'solana', name: 'Glow' }
    ];

    // Track which wallets we've already intercepted
    const interceptedWallets = new Set();

    function tryInterceptWallet(prop, subProp, name) {
      let wallet = window[prop];
      if (wallet && subProp) wallet = wallet[subProp];
      if (wallet && !interceptedWallets.has(prop)) {
        interceptedWallets.add(prop);
        interceptWallet(wallet, name);
      }
    }

    // Check immediately
    walletChecks.forEach(({ prop, subProp, name }) => {
      tryInterceptWallet(prop, subProp, name);
    });

    // Use defineProperty to trap wallet injection BEFORE it happens
    walletChecks.forEach(({ prop, subProp, name }) => {
      if (window[prop]) return; // Already exists

      let _value = undefined;
      try {
        Object.defineProperty(window, prop, {
          configurable: true,
          enumerable: true,
          get() {
            return _value;
          },
          set(newValue) {
            console.log(`[PrivacyRPC] Detected ${prop} injection`);
            _value = newValue;
            // Wait a tick for wallet to fully initialize
            setTimeout(() => tryInterceptWallet(prop, subProp, name), 0);
            // Also check after a short delay in case methods are added async
            setTimeout(() => tryInterceptWallet(prop, subProp, name), 100);
            setTimeout(() => tryInterceptWallet(prop, subProp, name), 500);
          }
        });
      } catch (e) {
        // Property might already be defined, that's ok
      }
    });

    // Also override Object.defineProperty to catch wallets that use it
    const originalDefineProperty = Object.defineProperty;
    Object.defineProperty = function(obj, prop, descriptor) {
      const result = originalDefineProperty.call(this, obj, prop, descriptor);

      if (obj === window) {
        walletChecks.forEach(({ prop: watchProp, subProp, name }) => {
          if (prop === watchProp) {
            setTimeout(() => tryInterceptWallet(watchProp, subProp, name), 0);
            setTimeout(() => tryInterceptWallet(watchProp, subProp, name), 100);
          }
        });
      }

      return result;
    };

    // Aggressive periodic check as fallback (every 200ms for first 5 seconds)
    let fastChecks = 0;
    const fastInterval = setInterval(() => {
      fastChecks++;
      walletChecks.forEach(({ prop, subProp, name }) => {
        tryInterceptWallet(prop, subProp, name);
      });
      if (fastChecks >= 25) clearInterval(fastInterval); // Stop after 5 seconds
    }, 200);

    // Slower periodic check continues for 30 seconds
    let slowChecks = 0;
    const slowInterval = setInterval(() => {
      slowChecks++;
      walletChecks.forEach(({ prop, subProp, name }) => {
        tryInterceptWallet(prop, subProp, name);
      });
      if (slowChecks > 30) clearInterval(slowInterval);
    }, 1000);
  }

  // Start watching
  watchForWallet();

  // Also expose a manual trigger for testing
  window.__privacyRpcTestIntercept = async function(base64Tx) {
    return sendToContentScript('INTERCEPT_TRANSACTION', {
      method: 'signTransaction',
      transactions: [base64Tx],
      origin: window.location.origin,
      href: window.location.href
    });
  };

  // ============================================================================
  // DEBUG FUNCTIONS - Run these in console to trace RPC routing
  // ============================================================================

  // Test the full RPC routing flow
  window.__privacyRpcDebug = {
    // Check current status
    status: function() {
      console.log('=== PrivacyRPC Debug Status ===');
      console.log('Proxy enabled:', window.__privacyRpcProxyEnabled);
      console.log('Injected script loaded:', window.__privacyRpcInjected);
      return {
        proxyEnabled: window.__privacyRpcProxyEnabled,
        injectedLoaded: window.__privacyRpcInjected
      };
    },

    // Test if a URL would be detected as RPC
    testUrl: function(url) {
      const result = isRpcUrl(url);
      console.log(`URL "${url}" is RPC:`, result);
      return result;
    },

    // Test the extension relay (sends test message through content script -> background)
    testRelay: async function() {
      console.log('=== Testing Extension Relay ===');
      console.log('1. Sending test request to content script...');

      try {
        const testUrl = 'https://mainnet.helius-rpc.com/test';
        const testBody = JSON.stringify({ jsonrpc: '2.0', method: 'getHealth', params: [], id: 1 });

        const result = await sendRpcThroughExtension(testUrl, testBody);
        console.log('2. Got response:', result);
        return result;
      } catch (e) {
        console.error('2. Relay FAILED:', e.message);
        return { error: e.message };
      }
    },

    // Manual enable (in case content script didn't set it)
    enable: function() {
      window.__privacyRpcProxyEnabled = true;
      console.log('Proxy routing manually enabled');
    },

    // Manual disable
    disable: function() {
      window.__privacyRpcProxyEnabled = false;
      console.log('Proxy routing disabled');
    }
  };

  console.log('[PrivacyRPC] Debug functions available: window.__privacyRpcDebug.status() / testUrl() / testRelay() / enable() / disable()');

})();
