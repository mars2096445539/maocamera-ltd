const { createClient } = require('redis');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const envStatus = {
    AUTHORIZE_ENVIRONMENT: process.env.AUTHORIZE_ENVIRONMENT || 'sandbox',
    AUTHORIZE_API_LOGIN_ID: Boolean(process.env.AUTHORIZE_API_LOGIN_ID),
    AUTHORIZE_TRANSACTION_KEY: Boolean(process.env.AUTHORIZE_TRANSACTION_KEY),
    AUTHORIZE_SIGNATURE_KEY: Boolean(process.env.AUTHORIZE_SIGNATURE_KEY),
    REDIS_URL: Boolean(process.env.REDIS_URL || process.env.STORAGE_URL),
    SITE_URL: Boolean(process.env.SITE_URL)
  };

  const missing = Object.entries(envStatus)
    .filter(([key, value]) => key !== 'AUTHORIZE_ENVIRONMENT' && value === false)
    .map(([key]) => key);

  const includeRedisPing = req.query.deep === '1';
  let redis = { checked: false };

  if (includeRedisPing && envStatus.REDIS_URL) {
    const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
    const client = createClient({ url: redisUrl });

    try {
      redis.checked = true;
      await client.connect();
      const pong = await client.ping();
      redis.ok = pong === 'PONG';
      redis.ping = pong;
    } catch (error) {
      redis.ok = false;
      redis.error = error.message;
    } finally {
      try {
        await client.quit();
      } catch (_) {}
    }
  }

  const ready = missing.length === 0 && (!includeRedisPing || redis.ok !== false);

  return res.status(ready ? 200 : 503).json({
    ok: ready,
    timestamp: new Date().toISOString(),
    checks: envStatus,
    missing,
    redis,
    note: 'No secret values are returned; only presence/health status.'
  });
};
