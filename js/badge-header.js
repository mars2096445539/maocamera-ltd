/**
 * maocamera ltd - 统一顶部组件 (Global Header)
 */
function injectGlobalHeader() {
    const placeholder = document.getElementById('badge-header-placeholder');
    if (!placeholder) return;

    placeholder.innerHTML = `
        <header class="main-header">
            <div class="container header-grid">
                <h1 class="logo"><a href="/">Mao Camera <span>ltd</span></a></h1>
                <nav class="main-nav">
                    <button class="nav-toggle" aria-label="toggle navigation"><span class="hamburger"></span></button>
                    <ul class="nav-links">
                        <li><a href="/pages/film-development.html">Development</a></li>
                        <li><a href="/pages/equipment-store.html">Store</a></li>
                        <li><a href="/pages/equipment-rental.html">Rental</a></li>
                        <li>
                            <a href="/pages/cart.html" class="cart-icon-container">
                                <span id="cartBadge" class="cart-badge"></span>
                                🛒 CART
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>
        </header>
    `;

    // 绑定汉堡菜单
    const navToggle = placeholder.querySelector('.nav-toggle');
    if (navToggle) navToggle.onclick = () => document.body.classList.toggle('nav-open');

    // 页面加载时执行一次同步
    window.syncCartBadge();
}

/**
 * 核心：全局同步函数
 */
window.syncCartBadge = function() {
    const cart = JSON.parse(localStorage.getItem('maocamera_cart')) || [];
    const badge = document.getElementById('cartBadge');
    if (!badge) return;

    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

    if (totalItems > 0) {
        badge.textContent = totalItems;
        badge.style.display = 'flex';
        // 物理跳动动画反馈
        badge.animate([
            { transform: 'scale(1)' },
            { transform: 'scale(1.5)' },
            { transform: 'scale(1)' }
        ], { duration: 300 });
    } else {
        badge.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', injectGlobalHeader);
// 监听跨标签页变动
window.addEventListener('storage', (e) => {
    if (e.key === 'maocamera_cart') window.syncCartBadge();
});