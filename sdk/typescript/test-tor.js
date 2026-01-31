/**
 * Test embedded Tor integration
 */

const { TorManager } = require('./dist/tor.js');

async function main() {
  console.log('PrivacyRPC - Embedded Tor Test');
  console.log('=============================\n');

  const tor = new TorManager({
    onBootstrapProgress: (progress, summary) => {
      process.stdout.write(`\r  Bootstrap: ${progress}% - ${summary}                    `);
    },
  });

  try {
    console.log('Starting embedded Tor...');
    await tor.start();

    console.log('\n\nTor is running!');
    console.log(`  SOCKS Port: ${tor.socksPort}`);
    console.log(`  Control Port: ${tor.controlPort}`);

    console.log('\nFetching exit IP...');
    const exitIp = await tor.getExitIp();
    console.log(`  Exit IP: ${exitIp || 'unknown'}`);

    console.log('\nRequesting new circuit...');
    await tor.newCircuit();

    console.log('Fetching new exit IP...');
    const newExitIp = await tor.getExitIp();
    console.log(`  New Exit IP: ${newExitIp || 'unknown'}`);

    const status = await tor.getStatus();
    console.log('\nTor Status:', status);

    console.log('\nStopping Tor...');
    await tor.stop();
    console.log('Done!');
  } catch (err) {
    console.error('\nError:', err.message);
    await tor.stop().catch(() => {});
    process.exit(1);
  }
}

main();
