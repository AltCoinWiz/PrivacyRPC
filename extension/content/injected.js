/**
 * PrivacyRPC Injected Script
 * Runs in PAGE context to intercept wallet adapter calls
 * Intercepts signTransaction BEFORE it reaches Phantom
 */

(function() {
  'use strict';

  // Don't run twice
  if (window.__privacyRpcInjected) return;
  window.__privacyRpcInjected = true;

  console.log('[PrivacyRPC] Wallet interceptor injected');

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

})();
