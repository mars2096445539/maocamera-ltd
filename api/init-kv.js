// 使用纯 Node.js 写法，彻底解决 image_2cd4e9.png 的模块缺失报错
const { createClient } = require('redis');

module.exports = async (req, res) => {
  // 自动兼容你之前设置的各种变量名
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = createClient({ url: redisUrl });

  try {
    await client.connect();

    // maocamera ltd 官方 11 件商品清单
    const products = {
      "XB-2R BALLHEAD": 0,
      "XB-1R BALLHEAD": 0,
      "SV35 FLUIDHEAD": 0,
      "MD-3 GEARHEAD": 0,
      "MD-4 GEARHEAD": 0,
      "PT-14 BALLHEAD COMBO": 0,
      "PT-24 BALLHEAD COMBO": 0,
      "MT-24 TRIPOD ONLY": 0,
      "XT-15 BALLHEAD COMBO": 0,
      "MT-34 TRIPOD ONLY": 0,
      "MT-33S TRIPOD ONLY": 0
    };

    // 批量录入 Redis
    for (const [name, stock] of Object.entries(products)) {
      await client.set(`stock:${name}`, stock.toString());
    }

    await client.quit();
    res.status(200).json({ 
      success: true, 
      message: "maocamera ltd 11款产品库存已全部同步成功！" 
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};