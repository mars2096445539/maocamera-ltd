const { createClient } = require('redis');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const invoice = String(req.query?.invoice || '').trim();
  if (!invoice) {
    return res.status(400).json({ ok: false, error: 'Missing invoice.' });
  }

  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  if (!redisUrl) {
    return res.status(500).json({ ok: false, error: 'Missing Redis configuration.' });
  }

  const client = createClient({ url: redisUrl });
  try {
    await client.connect();
    const raw = await client.get(`order:${invoice}`);
    if (!raw) {
      return res.status(404).json({ ok: false, error: 'Order snapshot not found.' });
    }

    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];

    const derivedSubtotal = Number(items.reduce((sum, item) => {
      const price = Number.parseFloat(item.price || 0);
      const quantity = Number.parseInt(item.quantity, 10) || 0;
      return sum + (price * quantity);
    }, 0).toFixed(2));

    const subtotal = Number.isFinite(parsed.subtotal) ? Number(parsed.subtotal) : derivedSubtotal;
    const taxRate = Number.isFinite(parsed.taxRate) ? Number(parsed.taxRate) : 0.09;
    const shippingCost = Number.isFinite(parsed.shippingCost) ? Number(parsed.shippingCost) : 0;
    const tax = Number.isFinite(parsed.taxAmount)
      ? Number(parsed.taxAmount)
      : Number((subtotal * taxRate).toFixed(2));
    const total = Number.isFinite(parsed.total)
      ? Number(parsed.total)
      : Number((subtotal + tax + shippingCost).toFixed(2));

    return res.status(200).json({
      ok: true,
      invoiceNumber: invoice,
      items,
      customerEmail: parsed.customerEmail || null,
      transactionId: parsed.transactionId || null,
      subtotal,
      taxRate,
      tax,
      shippingMethod: parsed.shippingMethod || 'standard',
      shippingCost,
      total,
      shippingAddress: parsed.shippingAddress || null,
      taxSource: parsed.taxSource || 'legacy'
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  } finally {
    await client.quit();
  }
};
