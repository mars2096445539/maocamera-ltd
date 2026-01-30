document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('productGrid');
    const searchInput = document.getElementById('searchInput');
    let allProducts = []; 

    // 1. 从 JSON 文件抓取数据
    fetch('../data/products.json')
        .then(response => {
            if (!response.ok) throw new Error('网络响应异常');
            return response.json();
        })
        .then(data => {
            allProducts = data;
            renderProducts(allProducts); 
            
            // 核心修复：渲染完后，立刻通知同步脚本去云端抓取真实库存
            if (window.syncLiveInventory) {
                window.syncLiveInventory();
            }
        })
        .catch(error => {
            console.error('加载产品数据失败:', error);
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 50px;">加载产品失败，请稍后再试。</p>';
        });

    // 2. 渲染产品的函数
// 核心：在渲染 HTML 时，必须给库存那一栏加上指定的类名
function renderProducts(items) {
    const grid = document.getElementById('productGrid');
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
                
                <div class="in-stock-label" style="font-size: 0.8rem; margin-top: 5px; color: ${p.stock > 0 ? '#28a745' : '#dc3545'};">
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
            // 搜索后也要重新同步一次云端库存
            if (window.syncLiveInventory) window.syncLiveInventory();
        });
    }
});