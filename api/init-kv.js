// 彻底抛弃 @vercel/kv，改用官方推荐的 redis 零件
import { createClient } from 'redis';
import { NextResponse } from 'next/server';

export const GET = async () => {
  // 这里直接读取你在 Vercel 后台看到的那个 REDIS_URL
  const client = createClient({
    url: process.env.REDIS_URL
  });

  try {
    await client.connect();

    // 录入你那 11 件商品的库存数据
    const products = {
      "PT-14 BALLHEAD COMBO": 2,
      "MAOCAMERA FILM CASE": 5,
      "M-HOLDER FOR LF": 3
      // ... 剩下的 8 件请按需补充
    };

    for (const [name, stock] of Object.entries(products)) {
      await client.set(`stock:${name}`, stock.toString());
    }

    await client.quit();
    return NextResponse.json({ message: "Successfully synced to Redis using REDIS_URL!" });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Connection Failed", details: error.message }, { status: 500 });
  }
};