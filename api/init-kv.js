// 使用 Node.js 原生模块读取文件
const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = createClient({ url: redisUrl });

  try {
    // 1. 定位并读取你的 products.json 文件
    // 路径指向 C:\maocamera公司\网站\maocamera-ltd\data\products.json
    const jsonPath = path.join(process.cwd(), 'data', 'products.json');
    const fileContent = fs.readFileSync(jsonPath, 'utf8');
    const products = JSON.parse(fileContent);

    await client.connect();

    // 2. 遍历 JSON 里的 11 件商品并同步到 Redis
    const results = [];
    for (const p of products) {
      // 这里的 p.name 必须和你数据库的 key 对应
      await client.set(`stock:${p.name}`, p.stock.toString());
      results.push(`${p.name}: ${p.stock}`);
    }

    await client.quit();

    res.status(200).json({ 
      success: true, 
      message: "maocamera ltd 数据库已与 JSON 完成同步！",
      syncedItems: results 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: "同步失败，请检查 products.json 路径或格式", 
      details: error.message 
    });
  }
};