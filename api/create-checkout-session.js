const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { items } = req.body;

        // 1. 读取外部 JSON 商品库
        const filePath = path.join(process.cwd(), 'data', 'products.json');
        const products = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // 2. 校验库存与单价安全检查
        for (const cartItem of items) {
            const dbProduct = products.find(p => p.name === cartItem.name);
            
            if (!dbProduct) {
                return res.status(400).json({ error: `Product "${cartItem.name}" not found.` });
            }

            if (cartItem.quantity > dbProduct.stock) {
                return res.status(400).json({ 
                    error: `Sorry, only ${dbProduct.stock} units of ${dbProduct.name} left.` 
                });
            }
            
            // 覆盖前端传来的价格，防止恶意篡改金额
            cartItem.price = dbProduct.price; 
        }

        const lineItems = items.map(item => ({
            price_data: {
                currency: 'usd',
                product_data: { name: item.name },
                unit_amount: Math.round(item.price * 100),
            },
            quantity: item.quantity,
        }));

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: lineItems,
            mode: 'payment',
            success_url: `${req.headers.origin}/pages/success.html`,
            cancel_url: `${req.headers.origin}/pages/cart.html`,
        });

        res.status(200).json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}