const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');

function loadEnv() {
  const candidates = ['.env.local', '.env.development.local', '.env'];
  for (const file of candidates) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.trim().startsWith('#')) continue;
      const index = line.indexOf('=');
      if (index < 0) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, '');
      if (key && !process.env[key]) process.env[key] = value;
    }
  }
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/update-stock.js list',
    '  node scripts/update-stock.js set <id|name|all> <value>',
    '  node scripts/update-stock.js inc <id|name|all> <value>',
    '  node scripts/update-stock.js dec <id|name|all> <value>',
    '',
    'Examples:',
    '  node scripts/update-stock.js set pt-14 3',
    '  node scripts/update-stock.js dec "PT-14 BALLHEAD COMBO" 1',
    '  node scripts/update-stock.js set all 5'
  ].join('\n'));
}

function parseNumber(raw, label) {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function readProducts(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const products = JSON.parse(content);
  if (!Array.isArray(products)) {
    throw new Error('Invalid products.json format.');
  }
  return products;
}

function findTargets(products, targetRaw) {
  const target = String(targetRaw || '').trim();
  if (!target) throw new Error('Missing target product.');

  if (target.toLowerCase() === 'all') {
    return products.map((_, index) => index);
  }

  const lowered = target.toLowerCase();
  const byId = products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => String(product.id || '').toLowerCase() === lowered)
    .map(({ index }) => index);

  if (byId.length > 0) return byId;

  return products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => String(product.name || '').toLowerCase() === lowered)
    .map(({ index }) => index);
}

function applyStockChange(products, indexes, action, value) {
  const updates = [];
  for (const index of indexes) {
    const product = products[index];
    const current = Number.parseInt(product.stock, 10) || 0;
    let next = current;

    if (action === 'set') next = value;
    if (action === 'inc') next = current + value;
    if (action === 'dec') next = Math.max(0, current - value);

    product.stock = next;
    updates.push({
      id: product.id,
      name: product.name,
      before: current,
      after: next
    });
  }
  return updates;
}

async function syncRedis(updates) {
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  if (!redisUrl) {
    return { synced: false, reason: 'REDIS_URL/STORAGE_URL not configured' };
  }

  const client = createClient({ url: redisUrl });
  await client.connect();
  try {
    for (const item of updates) {
      await client.set(`stock:${item.name}`, String(item.after));
    }
  } finally {
    await client.quit();
  }

  return { synced: true, count: updates.length };
}

async function main() {
  loadEnv();

  const [command, target, valueRaw] = process.argv.slice(2);
  const dataFilePath = path.join(process.cwd(), 'data', 'products.json');
  const products = readProducts(dataFilePath);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'list') {
    const rows = products.map(product => ({
      id: product.id,
      name: product.name,
      stock: Number.parseInt(product.stock, 10) || 0
    }));
    console.table(rows);
    return;
  }

  if (!['set', 'inc', 'dec'].includes(command)) {
    throw new Error(`Unsupported command: ${command}`);
  }

  const value = parseNumber(valueRaw, 'Value');
  const indexes = findTargets(products, target);
  if (indexes.length === 0) {
    throw new Error(`Product not found for target: ${target}`);
  }

  const updates = applyStockChange(products, indexes, command, value);
  fs.writeFileSync(dataFilePath, `${JSON.stringify(products, null, 2)}\n`, 'utf8');

  const redis = await syncRedis(updates);

  console.log(JSON.stringify({
    ok: true,
    command,
    target,
    updatedCount: updates.length,
    updates,
    redis
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
