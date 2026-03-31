const fs = require('fs');
const { createClient } = require('redis');

function parseEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

(async () => {
  const env = { ...parseEnv('.env.local'), ...parseEnv('.env') };
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL || env.REDIS_URL || env.STORAGE_URL;
  if (!redisUrl) throw new Error('No REDIS_URL/STORAGE_URL found');

  const client = createClient({ url: redisUrl });
  await client.connect();

  const invoice = 'MC-1772460973108';
  const tx = '81489267199';
  const key = 'stock:XT-15 BALLHEAD COMBO';

  const stock = await client.get(key);
  const orderRaw = await client.get(`order:${invoice}`);
  const processed = await client.get(`processed_txn:${tx}`);

  console.log('redis stock key =>', stock);
  console.log('order exists =>', !!orderRaw);
  if (orderRaw) {
    const order = JSON.parse(orderRaw);
    console.log('order items =>', order.items);
    console.log('savedAt =>', order.savedAt);
    console.log('transactionId =>', order.transactionId || null);
  }
  console.log('processed txn key exists =>', !!processed);

  await client.quit();

  const api = await fetch(
    `https://www.maocamera.com/api/get-stock?name=${encodeURIComponent('XT-15 BALLHEAD COMBO')}&t=${Date.now()}`
  );
  console.log('api get-stock =>', api.status, await api.text());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
