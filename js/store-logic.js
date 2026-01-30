document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('productGrid');
    const searchInput = document.getElementById('searchInput');
    let allProducts = []; // 用于存储原始数据，方便搜索过滤

    // 1. 从 JSON 文件抓取数据
    // 注意：路径相对于 HTML 文件，所以在 pages 目录下需要用 ../
    fetch('../data/products.json')
        .then(response => {
            if (!response.ok) throw new Error('网络响应异常');
            return response.json();
        })
        .then(data => {
            allProducts = data;
            renderProducts(allProducts); // 初次加载显示全部
        })
        .catch(error => {
            console.error('加载产品数据失败:', error);
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 50px;">加载产品失败，请稍后再试。</p>';
        });

    // 2. 渲染产品的函数
    function renderProducts(items) {
        if (items.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 50px;">未找到匹配的产品。</p>';
            return;
        }

        grid.innerHTML = items.map(p => `
            <a href="product-detail.html?id=${p.id}" class="product-card" style="text-decoration: none; color: inherit;">
                <div class="product-img-container" style="background: #f9f9f9; aspect-ratio: 1/1; overflow: hidden;">
                    <img src="${p.cover_image}" alt="${p.name}" class="product-img" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
                <div class="product-info" style="padding: 15px;">
                    <div class="brand-tag" style="font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 1px;">${p.brand}</div>
                    <div class="product-name" style="font-weight: 600; margin: 5px 0; font-size: 1rem;">${p.name}</div>
                    <div class="product-price" style="color: #007bff; font-weight: 700;">$${p.price}</div>
                    <div style="font-size: 0.8rem; margin-top: 5px; color: ${p.stock > 0 ? '#28a745' : '#dc3545'};">
                        ${p.stock > 0 ? `In Stock: ${p.stock}` : 'Out of Stock'}
                    </div>
                </div>
            </a>
        `).join('');
    }

    // 3. 搜索过滤功能
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filtered = allProducts.filter(p => 
                p.name.toLowerCase().includes(searchTerm) || 
                p.brand.toLowerCase().includes(searchTerm) ||
                (p.cn_name && p.cn_name.toLowerCase().includes(searchTerm))
            );
            renderProducts(filtered);
        });
    }
});