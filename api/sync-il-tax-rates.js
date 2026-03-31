const { createClient } = require('redis');

function normalizeZip(value) {
  return String(value || '').trim().replace(/[^0-9]/g, '').slice(0, 5);
}

function normalizeRate(value) {
  const rate = Number.parseFloat(String(value).trim());
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return null;
  return Number(rate.toFixed(6));
}

function parseCsv(text) {
  const rows = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const result = {};

  for (const row of rows) {
    if (/^zip\b/i.test(row)) continue;
    const parts = row.split(/[;,\t]/).map(part => part.trim());
    if (parts.length < 2) continue;

    const zip = normalizeZip(parts[0]);
    const rate = normalizeRate(parts[1]);
    if (!zip || rate === null) continue;
    result[zip] = rate;
  }

  return result;
}

function parseJson(text) {
  const parsed = JSON.parse(text);
  const result = {};

  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      const zip = normalizeZip(row?.zip);
      const rate = normalizeRate(row?.rate);
      if (!zip || rate === null) continue;
      result[zip] = rate;
    }
    return result;
  }

  for (const [rawZip, rawRate] of Object.entries(parsed || {})) {
    const zip = normalizeZip(rawZip);
    const rate = normalizeRate(rawRate);
    if (!zip || rate === null) continue;
    result[zip] = rate;
  }

  return result;
}

function isAuthorized(req) {
  const syncToken = process.env.IL_TAX_SYNC_TOKEN;
  const headerToken = req.headers['x-sync-token'];
  const cronUa = String(req.headers['user-agent'] || '').toLowerCase();
  const isCronCall = cronUa.includes('vercel-cron');

  if (syncToken && headerToken === syncToken) return true;
  if (isCronCall) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

function getClientIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  return forwardedFor || realIp || 'unknown';
}

async function applyRateLimit(client, key, windowSec, limit) {
  const safeWindowSec = Number.isInteger(windowSec) && windowSec > 0 ? windowSec : 3600;
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;

  const current = await client.incr(key);
  if (current === 1) {
    await client.expire(key, safeWindowSec);
  }

  const ttl = await client.ttl(key);
  return {
    allowed: current <= safeLimit,
    retryAfter: ttl > 0 ? ttl : safeWindowSec
  };
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).end();
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized sync request.' });
  }

  const sourceUrl = process.env.IL_ZIP_TAX_SOURCE_URL;
  if (!sourceUrl) {
    return res.status(500).json({ ok: false, error: 'Missing IL_ZIP_TAX_SOURCE_URL.' });
  }

  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  if (!redisUrl) {
    return res.status(500).json({ ok: false, error: 'Missing Redis configuration.' });
  }

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return res.status(502).json({ ok: false, error: `Source fetch failed with ${response.status}.` });
    }

    const bodyText = await response.text();
    let rates = {};

    try {
      rates = parseJson(bodyText);
    } catch {
      rates = parseCsv(bodyText);
    }

    const entries = Object.entries(rates);
    if (entries.length === 0) {
      return res.status(422).json({ ok: false, error: 'No valid ZIP rate entries in source.' });
    }

    const client = createClient({ url: redisUrl });
    await client.connect();

    try {
      const ip = getClientIp(req);
      const windowSec = parseInt(process.env.SYNC_RATE_LIMIT_WINDOW_SEC || '3600', 10);
      const limit = parseInt(process.env.SYNC_RATE_LIMIT_MAX || '20', 10);
      const limitKey = `ratelimit:sync-il-tax:${ip}`;
      const rateLimit = await applyRateLimit(client, limitKey, windowSec, limit);
      if (!rateLimit.allowed) {
        res.setHeader('Retry-After', String(rateLimit.retryAfter));
        return res.status(429).json({ ok: false, error: 'Too many sync requests. Please retry later.' });
      }

      await client.del('tax:il:zip-rates');
      await client.hSet('tax:il:zip-rates', rates);
      await client.set('tax:il:zip-rates:updatedAt', new Date().toISOString());
      await client.set('tax:il:zip-rates:count', String(entries.length));
    } finally {
      await client.quit();
    }

    return res.status(200).json({
      ok: true,
      sourceUrl,
      entries: entries.length,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
