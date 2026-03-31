function isCheckoutEnabled() {
    const raw = String(process.env.CHECKOUT_ENABLED ?? 'true').trim().toLowerCase();
    return !['false', '0', 'no', 'off'].includes(raw);
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).end();
    }

    return res.status(200).json({
        checkoutEnabled: isCheckoutEnabled()
    });
};
