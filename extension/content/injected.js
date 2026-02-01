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
  let walletIntercepted = false;

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
    if (!wallet || walletIntercepted) return;

    console.log(`[PrivacyRPC] Intercepting wallet: ${name}`);

    // Methods to intercept
    const methods = [
      'signTransaction',
      'signAllTransactions',
      'signAndSendTransaction'
    ];

    methods.forEach(method => {
      try {
        interceptMethod(wallet, method);
      } catch (e) {
        console.log(`[PrivacyRPC] Could not intercept ${method}:`, e);
      }
    });

    walletIntercepted = true;
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

    // Check immediately
    walletChecks.forEach(({ prop, subProp, name }) => {
      let wallet = window[prop];
      if (wallet && subProp) wallet = wallet[subProp];
      if (wallet) interceptWallet(wallet, name);
    });

    // Watch for future injections using Proxy on window
    const windowProxy = new Proxy(window, {
      set(target, prop, value) {
        target[prop] = value;

        // Check if this is a wallet being injected
        walletChecks.forEach(({ prop: watchProp, subProp, name }) => {
          if (prop === watchProp) {
            let wallet = value;
            if (wallet && subProp) wallet = wallet[subProp];
            if (wallet) {
              setTimeout(() => interceptWallet(wallet, name), 100);
            }
          }
        });

        return true;
      }
    });

    // Also use defineProperty observer for wallets that use that
    const originalDefineProperty = Object.defineProperty;
    Object.defineProperty = function(obj, prop, descriptor) {
      const result = originalDefineProperty.call(this, obj, prop, descriptor);

      if (obj === window) {
        walletChecks.forEach(({ prop: watchProp, subProp, name }) => {
          if (prop === watchProp && descriptor.value) {
            let wallet = descriptor.value;
            if (wallet && subProp) wallet = wallet[subProp];
            if (wallet) {
              setTimeout(() => interceptWallet(wallet, name), 100);
            }
          }
        });
      }

      return result;
    };

    // Periodic check as fallback
    let checks = 0;
    const interval = setInterval(() => {
      checks++;
      walletChecks.forEach(({ prop, subProp, name }) => {
        let wallet = window[prop];
        if (wallet && subProp) wallet = wallet[subProp];
        if (wallet && !walletIntercepted) interceptWallet(wallet, name);
      });

      // Stop after 30 seconds
      if (checks > 30 || walletIntercepted) {
        clearInterval(interval);
      }
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
