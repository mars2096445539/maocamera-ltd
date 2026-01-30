async function addToCart(product) {
    // 1. 获取本地购物车数据
    let cart = JSON.parse(localStorage.getItem('maocamera_cart')) || [];
    const existing = cart.find(item => item.id === product.id);
    const currentQuantityInCart = existing ? existing.quantity : 0;

    try {
        // 2. 核心联动：在添加前，先去 KV 数据库抓取实时库存
        // 加上时间戳 t 防止浏览器缓存旧结果
        const response = await fetch(`/api/get-stock?name=${encodeURIComponent(product.name)}&t=${Date.now()}`);
        const stockData = await response.json();

        // 3. 校验：如果购物车已有的 + 新加的 > 数据库实时库存
        if (currentQuantityInCart + 1 > stockData.stock) {
            alert(`Sorry, maocamera ltd currently only has ${stockData.stock} in stock.`);
            return; // 拦截，不执行后续添加逻辑
        }

        // 4. 库存充足，执行存入逻辑
        if (existing) {
            existing.quantity += 1;
        } else {
            cart.push({ 
                id: product.id, 
                name: product.name, 
                price: parseFloat(product.price), 
                cover_image: product.cover_image, 
                quantity: 1 
            });
        }

        // 5. 保存并同步 UI
        localStorage.setItem('maocamera_cart', JSON.stringify(cart));
        if (window.syncCartBadge) window.syncCartBadge();
        
        // 可选：给用户一个成功反馈
        console.log(`✅ ${product.name} added to cart!`);

    } catch (err) {
        console.error("Stock check failed, adding to cart anyway (fallback):", err);
        // 如果 API 挂了，可以决定是允许添加还是报错
    }
}