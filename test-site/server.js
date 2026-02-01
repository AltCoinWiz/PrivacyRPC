/**
 * PrivacyRPC Test Harness Server
 * Serves test pages and mocks RPC responses for drainer detection testing
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3333;

// Enable CORS for all origins (testing only)
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Mock wallet address for testing
const TEST_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const ATTACKER_WALLET = 'DrainerXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

// Track RPC calls for the control panel
let rpcCallLog = [];

// Mock RPC endpoint - simulates Solana RPC responses
app.post('/mock-rpc', (req, res) => {
  const { method, params, id } = req.body;

  // Log the call
  const logEntry = {
    timestamp: Date.now(),
    method,
    params: JSON.stringify(params).substring(0, 100)
  };
  rpcCallLog.push(logEntry);
  if (rpcCallLog.length > 100) rpcCallLog.shift();

  console.log(`[RPC] ${method}`);

  // Mock responses based on method
  let result;

  switch (method) {
    case 'getBalance':
      result = { value: 5000000000 }; // 5 SOL
      break;

    case 'getTokenAccountsByOwner':
      // Return multiple token accounts (drainer enumeration target)
      result = {
        value: [
          { pubkey: 'TokenAccount1XXX', account: { data: { parsed: { info: { mint: 'USDC111', tokenAmount: { uiAmount: 1000 } } } } } },
          { pubkey: 'TokenAccount2XXX', account: { data: { parsed: { info: { mint: 'BONK111', tokenAmount: { uiAmount: 50000000 } } } } } },
          { pubkey: 'TokenAccount3XXX', account: { data: { parsed: { info: { mint: 'JUP1111', tokenAmount: { uiAmount: 500 } } } } } },
        ]
      };
      break;

    case 'getAccountInfo':
      result = {
        value: {
          data: ['base64data', 'base64'],
          executable: false,
          lamports: 2039280,
          owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
        }
      };
      break;

    case 'simulateTransaction':
      // Return safe-looking simulation (for TOCTOU testing)
      result = {
        value: {
          err: null,
          logs: ['Program log: Instruction: Transfer', 'Program completed'],
          unitsConsumed: 5000
        }
      };
      break;

    case 'sendTransaction':
      // Return fake signature
      result = 'FakeSignature' + Date.now().toString(36) + 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      break;

    case 'getLatestBlockhash':
      result = {
        value: {
          blockhash: 'FakeBlockhash' + Date.now().toString(36),
          lastValidBlockHeight: 150000000
        }
      };
      break;

    default:
      result = null;
  }

  res.json({
    jsonrpc: '2.0',
    id,
    result
  });
});

// API to get RPC call log (for control panel)
app.get('/api/rpc-log', (req, res) => {
  res.json(rpcCallLog);
});

// API to clear RPC call log
app.post('/api/clear-log', (req, res) => {
  rpcCallLog = [];
  res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`
========================================
  PrivacyRPC Test Harness
========================================

  Server running at: http://localhost:${PORT}

  Test Pages:
  - http://localhost:${PORT}/              (Control Panel)
  - http://localhost:${PORT}/drainer-patterns/rapid-enumeration.html
  - http://localhost:${PORT}/drainer-patterns/immediate-check.html
  - http://localhost:${PORT}/drainer-patterns/multi-transfer.html
  - http://localhost:${PORT}/drainer-patterns/quick-transaction.html
  - http://localhost:${PORT}/phishing/seed-phrase-form.html
  - http://localhost:${PORT}/phishing/fake-claim.html
  - http://localhost:${PORT}/phishing/urgency-language.html
  - http://localhost:${PORT}/suspicious/wallet-probe.html

  Mock RPC: http://localhost:${PORT}/mock-rpc

========================================
  `);
});
