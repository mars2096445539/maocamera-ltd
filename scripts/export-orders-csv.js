const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');

function parseEnvContent(content) {
  const result = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

function loadRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  if (process.env.STORAGE_URL) return process.env.STORAGE_URL;

  const candidates = ['.env.local', '.env', '.env.development.local'];
  for (const file of candidates) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const parsed = parseEnvContent(fs.readFileSync(fullPath, 'utf8'));
    if (parsed.REDIS_URL) return parsed.REDIS_URL;
    if (parsed.STORAGE_URL) return parsed.STORAGE_URL;
  }

  return '';
}

function escapeCsv(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function itemsSummary(items) {
  if (!Array.isArray(items)) return '';
  return items
    .map((item) => `${item?.name || ''} x${item?.quantity || 0}`)
    .join(' | ');
}

function normalizeTimestamp(value) {
  if (!value) return '';
  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return new Date(n).toISOString();
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return '';
}

async function fetchOrderSnapshots(client) {
  const keys = [];
  let cursor = '0';

  do {
    const scanResult = await client.scan(cursor, { MATCH: 'order:*', COUNT: 200 });
    cursor = scanResult.cursor;
    if (Array.isArray(scanResult.keys) && scanResult.keys.length > 0) {
      keys.push(...scanResult.keys);
    }
  } while (cursor !== '0');

  if (keys.length === 0) return [];

  const values = await client.mGet(keys);
  const rows = [];

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const raw = values[index];
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const shipping = parsed.shippingAddress || {};
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      rows.push({
        redisKey: key,
        invoiceNumber: parsed.invoiceNumber || key.replace(/^order:/, ''),
        savedAt: normalizeTimestamp(parsed.savedAt),
        customerEmail: parsed.customerEmail || '',
        transactionId: parsed.transactionId || '',
        subtotal: parsed.subtotal ?? '',
        taxRate: parsed.taxRate ?? '',
        taxAmount: parsed.taxAmount ?? '',
        total: parsed.total ?? '',
        taxSource: parsed.taxSource || '',
        shipLine1: shipping.line1 || '',
        shipLine2: shipping.line2 || '',
        shipCity: shipping.city || '',
        shipState: shipping.state || '',
        shipZip: shipping.zip || '',
        shipCountry: shipping.country || '',
        itemCount: items.length,
        items: itemsSummary(items)
      });
    } catch (_) {
    }
  }

  rows.sort((a, b) => {
    const t1 = a.savedAt ? Date.parse(a.savedAt) : 0;
    const t2 = b.savedAt ? Date.parse(b.savedAt) : 0;
    return t2 - t1;
  });

  return rows;
}

function buildCsv(rows) {
  const headers = [
    'invoiceNumber',
    'savedAt',
    'customerEmail',
    'transactionId',
    'subtotal',
    'taxRate',
    'taxAmount',
    'total',
    'taxSource',
    'shipLine1',
    'shipLine2',
    'shipCity',
    'shipState',
    'shipZip',
    'shipCountry',
    'itemCount',
    'items',
    'redisKey'
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const line = headers.map((header) => escapeCsv(row[header])).join(',');
    lines.push(line);
  }
  return lines.join('\n');
}

async function main() {
  const redisUrl = loadRedisUrl();
  if (!redisUrl) {
    throw new Error('Missing REDIS_URL/STORAGE_URL in env or .env files.');
  }

  const client = createClient({ url: redisUrl });
  await client.connect();

  try {
    const rows = await fetchOrderSnapshots(client);
    const exportsDir = path.join(process.cwd(), 'exports');
    fs.mkdirSync(exportsDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(exportsDir, `orders-export-${timestamp}.csv`);
    fs.writeFileSync(filePath, buildCsv(rows), 'utf8');

    console.log(`Exported ${rows.length} order(s) to ${filePath}`);
  } finally {
    await client.quit();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
