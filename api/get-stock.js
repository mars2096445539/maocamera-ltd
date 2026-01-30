import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    const { name } = req.query;

    if (!name) {
        return res.status(400).json({ error: "Missing product name" });
    }

    try {
        // 从 KV 数据库读取该商品的实时库存
        const stock = await kv.get(`stock:${name}`);
        
        // 如果数据库里还没存这个商品，返回 0 或错误
        if (stock === null) {
            return res.status(404).json({ stock: 0, message: "Product not found in database" });
        }

        return res.status(200).json({ name, stock: parseInt(stock) });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}