/**
 * maocamera ltd - 全局购物车角标同步逻辑
 * 确保所有页面在加载或购物车变动时实时更新数字
 */

function updateGlobalCartBadge() {
    // 1. 从 localStorage 读取购物车数据
    const cart = JSON.parse(localStorage.getItem('maocamera_cart')) || [];
    
    // 2. 找到角标元素 (ID 需为 cartBadge)
    const badge = document.getElementById('cartBadge');
    
    if (!badge) return; // 如果当前页面没有购物车图标，则跳过

    // 3. 计算商品总件数
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

    // 4. 根据数量显示或隐藏蓝点
    if (totalItems > 0) {
        badge.textContent = totalItems;
        badge.style.display = 'flex'; // 显示蓝点
        
        // 增加一个微小的缩放动画，提醒用户数量变了
        badge.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.3)' },
            { transform: 'scale(1)' }
        ], { duration: 300 });
        
    } else {
        badge.style.display = 'none'; // 0 件时完全隐藏
    }
}

// 页面加载完成后立即执行一次
document.addEventListener('DOMContentLoaded', updateGlobalCartBadge);

// 监听其他页面的 localStorage 变动 (例如用户在另一个标签页清空了购物车)
window.addEventListener('storage', (event) => {
    if (event.key === 'maocamera_cart') {
        updateGlobalCartBadge();
    }
});