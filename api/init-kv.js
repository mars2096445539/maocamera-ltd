import { createClient } from 'redis';
import { NextResponse } from 'next/server';

export const GET = async () => {
  // 1. 创建客户端：它会自动读取你 Vercel 后台的 REDIS_URL
  const client = createClient({
    url: process.env.REDIS_URL
  });

  try {
    // 2. 建立连接
    await client.connect();

    // 3. 定义你的 11 件商品数据
    const products = {
      "PT-14 BALLHEAD COMBO": 2,
      "MAOCAMERA FILM CASE": 5,
      "M-HOLDER FOR LF": 3,
      // ... 剩下的 8 件商品请按此格式补充
    };

    // 4. 将数据写入数据库
    for (const [name, stock] of Object.entries(products)) {
      await client.set(`stock:${name}`, stock.toString());
    }

    // 5. 断开连接并返回成功消息
    await client.quit();
    return NextResponse.json({ message: "Successfully synced 11 products to Redis!" });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to connect to Redis" }, { status: 500 });
  }
};