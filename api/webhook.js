const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('redis');

module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = createClient({ url: redisUrl });

  let event;

  try {
    // 1. 验证信号确实来自 Stripe，防止恶意刷库存
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2. 只处理支付成功的事件
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      await client.connect();

      // 3. 从订单详情中获取产品和数量
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

      for (const item of lineItems.data) {
        // 假设你在 Stripe 产品的 Description 或 Name 里用了官方名称
        const productName = item.description; 
        const quantityPurchased = item.quantity;

        // 4. 云端自动减扣：DECRBY 命令
        await client.decrBy(`stock:${productName}`, quantityPurchased);
      }

      await client.quit();
    } catch (dbErr) {
      console.error("Redis Error:", dbErr);
    }
  }

  // 5. 必须返回 200，告诉 Stripe 我们收到了
  res.status(200).json({ received: true });
};