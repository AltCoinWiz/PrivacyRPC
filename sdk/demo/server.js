/**
 * PrivacyRPC Live Demo Server
 *
 * Real-time demo showing:
 * 1. Actual RPC Proxy with live Solana requests
 * 2. HTTP Forward Proxy for browser extension
 * 3. Real Tor routing with exit IP display
 * 4. Live phishing detection
 * 5. Real MITM detection
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

// Import the real SDK
const { PrivacyRPC, TorManager, PhishingDetector, MitmDetector, ForwardProxy } = require('../typescript/dist/index.js');

// Forward proxy for browser extension
let forwardProxy = null;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Live state
const state = {
  proxyRunning: false,
  privacyMode: 'none',
  torBootstrap: 0,
  exitIp: null,
  realIp: null,
  alerts: [],
  stats: {
    requests: 0,
    blocked: 0,
    phishingDetected: 0,
    avgLatency: 0
  },
  connectedRpc: null,
  configuredRpc: null,
  proxyPort: null
};

// SDK instances
let privacyRpc = null;
let phishingDetector = new PhishingDetector();
let mitmDetector = new MitmDetector();

// Get real IP for comparison
async function getRealIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const data = await res.json();
    return data.ip;
  } catch {
    return 'unknown';
  }
}

// Broadcast to all WebSocket clients
function broadcast(message) {
  const msg = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Add alert and broadcast
function addAlert(level, title, message, details = null) {
  const alert = {
    id: Date.now(),
    level,
    title,
    message,
    details,
    timestamp: new Date().toISOString()
  };
  state.alerts.unshift(alert);
  if (state.alerts.length > 50) state.alerts.pop();
  broadcast({ type: 'alert', data: alert });
}

// WebSocket handlers
wss.on('connection', async (ws) => {
  console.log('Client connected');

  // Get real IP on connect
  if (!state.realIp) {
    state.realIp = await getRealIp();
  }

  // Send initial state
  ws.send(JSON.stringify({ type: 'state', data: state }));

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);
      await handleMessage(msg);
    } catch (err) {
      console.error('Error handling message:', err);
      addAlert('danger', 'Error', err.message);
    }
  });
});

async function handleMessage(msg) {
  switch (msg.action) {
    case 'startProxy':
      await startProxy(msg.rpc, msg.privacy || 'none');
      break;

    case 'stopProxy':
      await stopProxy();
      break;

    case 'setPrivacy':
      await setPrivacyMode(msg.mode);
      break;

    case 'checkPhishing':
      checkPhishingDomain(msg.domain);
      break;

    case 'checkMitm':
      await checkMitmAttack(msg.hostname);
      break;

    case 'sendRpcRequest':
      await sendRealRpcRequest(msg.method, msg.params);
      break;

    case 'newCircuit':
      await requestNewCircuit();
      break;

    case 'getStatus':
      broadcast({ type: 'state', data: state });
      break;
  }
}

// Start the real proxy
async function startProxy(rpcUrl, privacy) {
  if (privacyRpc) {
    await privacyRpc.stop();
  }

  const rpc = rpcUrl || 'https://api.mainnet-beta.solana.com';
  state.configuredRpc = rpc;
  state.privacyMode = privacy;

  console.log('Starting proxy with RPC URL:', rpc);
  addAlert('info', 'Starting Proxy', `Initializing PrivacyRPC with ${privacy === 'tor' ? 'Tor' : 'direct'} mode...`);
  addAlert('info', 'RPC URL', rpc);

  // Track request timing for activity log
  const requestTimes = new Map();

  try {
    privacyRpc = new PrivacyRPC({
      primaryRpc: rpc,
      privacy: privacy,
      proxyPort: 8899,
      torConfig: {
        onBootstrapProgress: (progress, summary) => {
          state.torBootstrap = progress;
          broadcast({ type: 'torProgress', data: { progress, summary } });
        }
      },
      onAlert: (alert) => {
        const level = alert.severity === 'CRITICAL' ? 'danger' :
                      alert.severity === 'HIGH' ? 'warning' : 'info';
        addAlert(level, alert.type, alert.message, alert.details);
      },
      onRequest: (request) => {
        // Log incoming request
        requestTimes.set(request.id, Date.now());
        broadcast({
          type: 'activity',
          data: {
            timestamp: Date.now(),
            method: request.method,
            id: request.id,
            success: null,
            error: null,
            latency: null,
            details: 'Request sent...'
          }
        });
        return request;
      },
      onResponse: (response) => {
        // Log response
        const startTime = requestTimes.get(response.id);
        const latency = startTime ? Date.now() - startTime : null;
        requestTimes.delete(response.id);

        state.stats.requests++;
        if (latency) {
          state.stats.avgLatency = Math.round(
            (state.stats.avgLatency * (state.stats.requests - 1) + latency) / state.stats.requests
          );
        }

        broadcast({
          type: 'activity',
          data: {
            timestamp: Date.now(),
            method: response.id ? `Response #${response.id}` : 'Response',
            id: response.id,
            success: !response.error,
            error: response.error ? response.error.message : null,
            latency: latency,
            details: response.error ? response.error.message : 'OK'
          }
        });

        broadcast({ type: 'state', data: state });
        return response;
      }
    });

    await privacyRpc.start();

    state.proxyRunning = true;
    state.proxyPort = 8899;
    state.connectedRpc = rpc;

    // Get exit IP if using Tor
    if (privacy === 'tor' && privacyRpc.tor) {
      state.exitIp = await privacyRpc.getExitIp();
      addAlert('success', 'Tor Connected', `Exit IP: ${state.exitIp} (Your real IP: ${state.realIp})`);
    }

    broadcast({ type: 'state', data: state });
    addAlert('success', 'Proxy Started', `RPC Proxy running on localhost:${state.proxyPort}`);

  } catch (err) {
    addAlert('danger', 'Proxy Failed', err.message);
    state.proxyRunning = false;
    broadcast({ type: 'state', data: state });
  }
}

// Stop the proxy
async function stopProxy() {
  if (privacyRpc) {
    await privacyRpc.stop();
    privacyRpc = null;
  }

  state.proxyRunning = false;
  state.exitIp = null;
  state.torBootstrap = 0;
  state.privacyMode = 'none';

  broadcast({ type: 'state', data: state });
  addAlert('info', 'Proxy Stopped', 'PrivacyRPC proxy stopped');
}

// Change privacy mode (requires restart)
async function setPrivacyMode(mode) {
  if (state.proxyRunning) {
    addAlert('info', 'Switching Privacy Mode', `Restarting proxy with ${mode} mode...`);
    await stopProxy();
    await startProxy(state.configuredRpc, mode);
  } else {
    state.privacyMode = mode;
    broadcast({ type: 'state', data: state });
  }
}

// Request new Tor circuit
async function requestNewCircuit() {
  if (!privacyRpc || !privacyRpc.tor) {
    addAlert('warning', 'No Tor', 'Tor is not running');
    return;
  }

  addAlert('info', 'New Circuit', 'Requesting new Tor circuit...');

  try {
    await privacyRpc.newCircuit();
    state.exitIp = await privacyRpc.getExitIp();
    broadcast({ type: 'state', data: state });
    addAlert('success', 'New Circuit', `New exit IP: ${state.exitIp}`);
  } catch (err) {
    addAlert('danger', 'Circuit Failed', err.message);
  }
}

// Real phishing check
function checkPhishingDomain(domain) {
  const result = phishingDetector.check(domain);
  state.stats.requests++;

  if (result.isPhishing) {
    state.stats.phishingDetected++;
    state.stats.blocked++;
    addAlert('danger', 'PHISHING DETECTED', `${domain} - ${result.reason}`, {
      confidence: result.confidence,
      legitimateDomain: result.legitimateDomain,
      alerts: result.alerts
    });
  } else if (result.confidence === 'CONFIRMED') {
    addAlert('success', 'Safe Domain', `${domain} is verified legitimate`);
  } else {
    addAlert('warning', 'Unknown Domain', `${domain} - Exercise caution`);
  }

  broadcast({ type: 'phishingResult', data: { domain, ...result } });
  broadcast({ type: 'state', data: state });
}

// Real MITM check
async function checkMitmAttack(hostname) {
  // Always extract just the hostname, whether passed as URL or hostname
  if (!hostname) {
    hostname = state.configuredRpc || 'https://api.mainnet-beta.solana.com';
  }

  // If it looks like a URL, extract just the hostname
  if (hostname.includes('://')) {
    try {
      hostname = new URL(hostname).hostname;
    } catch (e) {
      // If URL parsing fails, try to extract hostname manually
      hostname = hostname.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    }
  }

  addAlert('info', 'MITM Check', `Checking ${hostname} for MITM attacks...`);

  try {
    const result = await mitmDetector.check(hostname);

    if (!result.isSafe) {
      state.stats.blocked++;
      for (const threat of result.threats) {
        addAlert('danger', 'MITM THREAT', threat.message, threat.details);
      }
    } else {
      addAlert('success', 'Connection Safe', `No MITM attacks detected on ${hostname}`);
    }

    broadcast({ type: 'mitmResult', data: { hostname, ...result } });
    broadcast({ type: 'state', data: state });
  } catch (err) {
    addAlert('warning', 'MITM Check Failed', err.message);
  }
}

// Send real RPC request through proxy
async function sendRealRpcRequest(method, params) {
  if (!state.proxyRunning) {
    addAlert('warning', 'Proxy Not Running', 'Start the proxy first');
    return;
  }

  const rpcMethod = method || 'getSlot';
  const rpcParams = params || [];

  addAlert('info', 'RPC Request', `Sending ${rpcMethod}...`);

  const startTime = Date.now();

  try {
    // Send through the proxy
    const response = await fetch(`http://127.0.0.1:${state.proxyPort}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: rpcMethod,
        params: rpcParams
      })
    });

    const data = await response.json();
    const latency = Date.now() - startTime;

    state.stats.requests++;
    state.stats.avgLatency = Math.round(
      (state.stats.avgLatency * (state.stats.requests - 1) + latency) / state.stats.requests
    );

    broadcast({
      type: 'rpcResponse',
      data: {
        method: rpcMethod,
        success: !data.error,
        latency,
        result: data.result,
        error: data.error
      }
    });

    if (data.error) {
      addAlert('warning', 'RPC Error', data.error.message);
    } else {
      addAlert('success', 'RPC Success', `${rpcMethod} completed in ${latency}ms`, {
        result: typeof data.result === 'object' ? JSON.stringify(data.result).slice(0, 100) : data.result
      });
    }

    broadcast({ type: 'state', data: state });

  } catch (err) {
    addAlert('danger', 'RPC Failed', err.message);
  }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json(state);
});

// Start forward proxy for browser extension
async function startForwardProxy() {
  try {
    forwardProxy = new ForwardProxy({
      port: 8899,
      onRequest: (method, target) => {
        console.log(`[ForwardProxy] ${method} ${target}`);
        broadcast({
          type: 'activity',
          data: {
            timestamp: Date.now(),
            method: `PROXY: ${method}`,
            id: null,
            success: true,
            error: null,
            latency: null,
            details: target
          }
        });
      },
      onError: (err, context) => {
        console.error(`[ForwardProxy] Error in ${context}:`, err.message);
      }
    });
    await forwardProxy.start();
    console.log('[PrivacyRPC] Forward proxy started on port 8899');
    return true;
  } catch (err) {
    console.error('[PrivacyRPC] Failed to start forward proxy:', err.message);
    return false;
  }
}

// Start server
const PORT = 3000;
server.listen(PORT, async () => {
  // Get real IP on startup
  state.realIp = await getRealIp();

  // Start forward proxy for browser extension
  const proxyStarted = await startForwardProxy();

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   PrivacyRPC LIVE Demo                                    ║
║   Privacy-First RPC Protection                            ║
║                                                           ║
║   Your IP: ${state.realIp.padEnd(45)}║
║                                                           ║
║   Dashboard: http://localhost:${PORT}                       ║
║   Forward Proxy: ${proxyStarted ? 'http://127.0.0.1:8899' : 'FAILED'}                     ║
║                                                           ║
║   Features:                                               ║
║   • HTTP Forward Proxy for browser extension              ║
║   • Real Tor routing with live exit IP                    ║
║   • Actual Solana RPC requests                            ║
║   • Live phishing detection                               ║
║   • Real MITM certificate checks                          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (privacyRpc) {
    await privacyRpc.stop();
  }
  if (forwardProxy) {
    await forwardProxy.stop();
  }
  process.exit(0);
});
