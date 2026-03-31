const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnv();

(async () => {
  const url = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = createClient({ url });
  await client.connect();

  // Find PT-24 orders
  console.log('=== PT-24 Orders ===');
  const keys = await client.keys('order:*');
  for (const k of keys) {
    const val = await client.get(k);
    if (val && val.includes('PT-24')) console.log(k, val);
  }

  // Check processed transactions
  const txKeys = await client.keys('processed_txn:*');
  console.log('\nTotal processed transactions:', txKeys.length);
  if (txKeys.length > 0) {
    console.log('Transaction keys:');
    for (const tk of txKeys) {
      console.log(' ', tk);
    }
  }

  // Check all stock keys
  console.log('\n=== Stock Keys ===');
  const stockKeys = await client.keys('stock:*');
  for (const sk of stockKeys) {
    const val = await client.get(sk);
    console.log(sk, '=', val);
  }

  await client.quit();
})();
