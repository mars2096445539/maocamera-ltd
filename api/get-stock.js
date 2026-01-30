// 采用你已验证成功的 Node.js 兼容写法
const { createClient } = require('redis');

module.exports = async (req, res) => {
  // 自动兼容 REDIS_URL 或 STORAGE_URL
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = createClient({ url: redisUrl });

  // 获取 URL 参数中的 name
  const { name } = req.query;

  // 这是你之前同步的 11 件官方商品清单
  const productList = [
    "XB-2R BALLHEAD", "XB-1R BALLHEAD", "SV35 FLUIDHEAD", 
    "MD-3 GEARHEAD", "MD-4 GEARHEAD", "PT-14 BALLHEAD COMBO", 
    "PT-24 BALLHEAD COMBO", "MT-24 TRIPOD ONLY", "XT-15 BALLHEAD COMBO", 
    "MT-34 TRIPOD ONLY", "MT-33S TRIPOD ONLY"
  ];

  try {
    await client.connect();

    // 逻辑 A：如果传了具体名字，查询单个库存
    if (name) {
      const stock = await client.get(`stock:${name}`);
      await client.quit();
      
      if (stock === null) {
        return res.status(404).json({ success: false, message: "未找到该产品" });
      }
      return res.status(200).json({ 
        name, 
        stock: parseInt(stock), 
        inStock: parseInt(stock) > 0 
      });
    }

    // 逻辑 B：如果不传名字，返回全店库存清单
    const allStock = {};
    for (const pName of productList) {
      const val = await client.get(`stock:${pName}`);
      allStock[pName] = val !== null ? parseInt(val) : 0;
    }

    await client.quit();
    res.status(200).json({
      success: true,
      shop: "maocamera ltd",
      inventory: allStock
    });

  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};
