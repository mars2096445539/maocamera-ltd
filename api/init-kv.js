const { createClient } = require('redis');

module.exports = async (req, res) => {
  // 自动兼容你之前的 STORAGE 前缀或标准的 REDIS 变量
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;

  if (!redisUrl) {
    return res.status(500).json({ error: "找不到数据库连接地址 (REDIS_URL missing)" });
  }

  const client = createClient({ url: redisUrl });

  try {
    await client.connect();

    // 录入 maocamera ltd 的 11 件商品库存
    const products = {
      "PT-14 BALLHEAD COMBO": 2,
      "MAOCAMERA FILM CASE": 5,
      "M-HOLDER FOR LF": 3
      // ... 剩下的 8 件请在此补充
    };

    for (const [name, stock] of Object.entries(products)) {
      await client.set(`stock:${name}`, stock.toString());
    }

    await client.quit();
    res.status(200).json({ message: "maocamera ltd 库存初始化成功！" });

  } catch (error) {
    res.status(500).json({ error: "连接失败", details: error.message });
  }
};