const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
  const client = redisUrl ? createClient({ url: redisUrl }) : null;

  const { name } = req.query;

  let products = [];
  try {
    const productsPath = path.join(process.cwd(), 'data', 'products.json');
    products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  } catch (readErr) {
    return res.status(500).json({ canPurchase: false, error: '读取产品数据失败' });
  }

  const productList = products.map((product) => product.name);

  try {
    if (client) {
      await client.connect();
    }

    if (name) {
      const product = products.find((p) => p.name === name);
      if (!product) {
        if (client) await client.quit();
        return res.status(404).json({ canPurchase: false, error: '未找到该产品' });
      }

      let count = parseInt(product.stock, 10);
      if (!Number.isInteger(count) || count < 0) count = 0;

      if (client) {
        const stockVal = await client.get(`stock:${name}`);
        if (stockVal !== null) {
          const redisCount = parseInt(stockVal, 10);
          if (Number.isInteger(redisCount) && redisCount >= 0) {
            count = redisCount;
          }
        }
        await client.quit();
      }

      return res.status(200).json({
        name,
        stock: count,
        canPurchase: count > 0 
      });
    }

    const inventory = {};
    for (const pName of productList) {
      const product = products.find((p) => p.name === pName);
      let count = parseInt(product?.stock, 10);
      if (!Number.isInteger(count) || count < 0) count = 0;

      if (client) {
        const val = await client.get(`stock:${pName}`);
        if (val !== null) {
          const redisCount = parseInt(val, 10);
          if (Number.isInteger(redisCount) && redisCount >= 0) {
            count = redisCount;
          }
        }
      }

      inventory[pName] = count;
    }

    if (client) {
      await client.quit();
    }

    res.status(200).json({
      shop: "maocamera ltd",
      inventory,
      globalStatus: "Operational" 
    });

  } catch (e) {
    if (client) {
      try {
        await client.quit();
      } catch (_) {}
    }
    res.status(500).json({ canPurchase: false, error: e.message });
  }
};