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

  let cursor = '0';
  let count = 0;
  do {
    const result = await client.scan(cursor, { MATCH: 'processed_txn:*', COUNT: 500 });
    cursor = result.cursor;
    count += result.keys.length;
  } while (cursor !== '0');

  await client.quit();
  console.log('processed_txn_count =>', count);

  const health = await fetch('https://www.maocamera.com/api/webhook-health?deep=1');
  console.log('webhook-health =>', health.status, await health.text());
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
