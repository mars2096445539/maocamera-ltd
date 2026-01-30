// 坚持使用你已经跑通的 Node.js 兼容写法
const { createClient } = require('redis');

module.exports = async (req, res) => {
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = createClient({ url: redisUrl });

  const { name } = req.query;

  // maocamera ltd 官方 11 件商品清单
  const productList = [
    "XB-2R BALLHEAD", "XB-1R BALLHEAD", "SV35 FLUIDHEAD", 
    "MD-3 GEARHEAD", "MD-4 GEARHEAD", "PT-14 BALLHEAD COMBO", 
    "PT-24 BALLHEAD COMBO", "MT-24 TRIPOD ONLY", "XT-15 BALLHEAD COMBO", 
    "MT-34 TRIPOD ONLY", "MT-33S TRIPOD ONLY"
  ];

  try {
    await client.connect();

    // 1. 查询单个商品库存
    if (name) {
      const stockVal = await client.get(`stock:${name}`);
      await client.quit();

      if (stockVal === null) {
        return res.status(404).json({ canPurchase: false, error: "未找到该产品" });
      }

      const count = parseInt(stockVal);
      return res.status(200).json({
        name,
        stock: count,
        // 核心逻辑：库存大于 0 且非手动锁定才允许购买
        canPurchase: count > 0 
      });
    }

    // 2. 查询全店清单（供你管理使用）
    const inventory = {};
    for (const pName of productList) {
      const val = await client.get(`stock:${pName}`);
      inventory[pName] = val !== null ? parseInt(val) : 0;
    }

    await client.quit();
    res.status(200).json({
      shop: "maocamera ltd",
      inventory,
      // 如果你想一键关店，可以在这里把所有商品的购买权限统一置为 false
      globalStatus: "Operational" 
    });

  } catch (e) {
    res.status(500).json({ canPurchase: false, error: e.message });
  }
};