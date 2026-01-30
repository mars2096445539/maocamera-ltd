const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

// 重要：必须禁用 Vercel 的默认解析器，Stripe 需要原始请求体来校验签名
export const config = {
    api: { bodyParser: false },
};

async function buffer(readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // 使用密钥验证这一条消息确实来自 Stripe
        event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
    } catch (err) {
        console.error(`❌ Webhook 签名验证失败: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // 核心逻辑：监听支付成功事件
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        
        const filePath = path.join(process.cwd(), 'data', 'products.json');
        let products = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // 联动扣减库存
        lineItems.data.forEach(item => {
            const productInDb = products.find(p => p.name === item.description);
            if (productInDb) {
                productInDb.stock = Math.max(0, productInDb.stock - item.quantity);
                console.log(`✅ 库存联动：${productInDb.name} 剩余 ${productInDb.stock} 件`);
            }
        });

        // 保存更新后的 JSON 文件
        fs.writeFileSync(filePath, JSON.stringify(products, null, 2));
    }

    res.status(200).json({ received: true });
}