import { createClient } from 'redis';
import { NextResponse } from 'next/server';

export const GET = async () => {
  // 自动兼容两种可能的变量名
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;

  if (!redisUrl) {
    return NextResponse.json({ error: "钥匙丢了：找不到 REDIS_URL 或 STORAGE_URL" }, { status: 500 });
  }

  const client = createClient({ url: redisUrl });

  try {
    await client.connect();

    // 录入你那 11 件商品的库存
    const products = {
      "PT-14 BALLHEAD COMBO": 2,
      "MAOCAMERA FILM CASE": 5,
      "M-HOLDER FOR LF": 3
      // ... 请在此补充剩余商品
    };

    for (const [name, stock] of Object.entries(products)) {
      await client.set(`stock:${name}`, stock.toString());
    }

    await client.quit();
    return NextResponse.json({ message: "maocamera ltd 库存初始化成功！" });

  } catch (error) {
    return NextResponse.json({ error: "连接失败", details: error.message }, { status: 500 });
  }
};