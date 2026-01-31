/**
 * PrivacyRPC SDK - Basic Example
 *
 * Shows how to use PrivacyRPC with different privacy modes.
 */

import { PrivacyRPC, PrivacyMode } from '@privacyrpc/sdk';

async function main() {
  // ===========================================
  // Example 1: Standard mode (no privacy routing)
  // ===========================================
  console.log('Starting PrivacyRPC in standard mode...');

  const standard = PrivacyRPC.withHelius('your-api-key', {
    onAlert: (alert) => console.log('[Alert]', alert.type, alert.message),
  });

  await standard.start();
  console.log(`Proxy URL: ${standard.proxyUrl}`);
  console.log(`Privacy Mode: ${standard.privacyMode}`);

  // Your wallet can now use http://127.0.0.1:8899 as RPC
  await standard.stop();

  // ===========================================
  // Example 2: Tor mode (IP hidden from RPC)
  // ===========================================
  console.log('\nStarting PrivacyRPC with Tor...');

  const withTor = PrivacyRPC.withHelius('your-api-key', {
    privacy: 'tor',
    onAlert: (alert) => console.log('[Alert]', alert.type, alert.message),
  });

  await withTor.start();
  console.log(`Proxy URL: ${withTor.proxyUrl}`);
  console.log(`Privacy Mode: ${withTor.privacyMode}`);

  // Get exit IP
  const exitIp = await withTor.getExitIp();
  console.log(`Tor Exit IP: ${exitIp}`);

  // Request new circuit (new exit IP)
  await withTor.newCircuit();
  const newExitIp = await withTor.getExitIp();
  console.log(`New Tor Exit IP: ${newExitIp}`);

  await withTor.stop();

  // ===========================================
  // Example 3: QuickNode with phishing check
  // ===========================================
  console.log('\nStarting PrivacyRPC with QuickNode...');

  const quickNode = PrivacyRPC.withQuickNode(
    'https://your-endpoint.quiknode.pro/xxx',
    {
      privacy: 'none',
      onAlert: (alert) => console.log('[Alert]', alert.type, alert.message),
    }
  );

  await quickNode.start();

  // Check a domain for phishing
  const result = quickNode.checkPhishing('phantom-wallet.io');
  console.log('Phishing check:', result);

  const stats = quickNode.getStats();
  console.log('Stats:', stats);

  await quickNode.stop();
}

main().catch(console.error);
