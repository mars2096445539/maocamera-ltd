import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    // 你刚才提供的完整 11 件商品数据
    const products = [
        { name: "XB-2R BALLHEAD", stock: 2 },
        { name: "XB-1R BALLHEAD", stock: 2 },
        { name: "SV35 FLUIDHEAD", stock: 3 },
        { name: "MD-3 GEARHEAD", stock: 4 },
        { name: "MD-4 GEARHEAD", stock: 2 },
        { name: "PT-14 BALLHEAD COMBO", stock: 2 },
        { name: "PT-24 BALLHEAD COMBO", stock: 4 },
        { name: "MT-24 TRIPOD ONLY", stock: 3 },
        { name: "XT-15 BALLHEAD COMBO", stock: 2 },
        { name: "MT-34 TRIPOD ONLY", stock: 1 },
        { name: "MT-33S TRIPOD ONLY", stock: 1 }
    ];

    try {
        for (const p of products) {
            // 将库存存入 KV 数据库，键名格式为 stock:商品名
            await kv.set(`stock:${p.name}`, p.stock);
        }
        return res.status(200).json({ message: "Successfully synced 11 products to KV!" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}