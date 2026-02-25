const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');
const APIContracts = require('authorizenet').APIContracts;
const APIControllers = require('authorizenet').APIControllers;
const Constants = require('authorizenet').Constants;

function getAuthorizeEnvironment(environmentName = process.env.AUTHORIZE_ENVIRONMENT) {
    return environmentName === 'production'
        ? Constants.endpoint.production
        : Constants.endpoint.sandbox;
}

function createHostedPaymentToken(requestPayload, environmentName = process.env.AUTHORIZE_ENVIRONMENT) {
    return new Promise((resolve, reject) => {
        const controller = new APIControllers.GetHostedPaymentPageController(requestPayload.getJSON());
        controller.setEnvironment(getAuthorizeEnvironment(environmentName));

        controller.execute(() => {
            const apiResponse = controller.getResponse();
            if (!apiResponse) {
                reject(new Error('Authorize.net response is empty'));
                return;
            }

            const response = new APIContracts.GetHostedPaymentPageResponse(apiResponse);
            const resultCode = response.getMessages()?.getResultCode();

            if (resultCode !== APIContracts.MessageTypeEnum.OK) {
                const message = response.getMessages()?.getMessage()?.[0]?.getText() || 'Unable to create hosted payment page.';
                reject(new Error(message));
                return;
            }

            resolve(response.getToken());
        });
    });
}

function normalizeOriginUrl(value) {
    const normalized = String(value || '').trim().replace(/^['\"]+|['\"]+$/g, '').replace(/\/+$/, '');
    return normalized;
}

function isLocalhostUrl(value) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value);
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const { items } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }

        const apiLoginId = process.env.AUTHORIZE_API_LOGIN_ID;
        const transactionKey = process.env.AUTHORIZE_TRANSACTION_KEY;
        if (!apiLoginId || !transactionKey) {
            return res.status(500).json({ error: 'Missing Authorize.net credentials.' });
        }

        const origin = normalizeOriginUrl(
            process.env.AUTHORIZE_RETURN_BASE_URL || req.headers.origin || process.env.SITE_URL
        );
        if (!origin) {
            return res.status(500).json({ error: 'Unable to determine site origin.' });
        }
        if (!/^https?:\/\//i.test(origin)) {
            return res.status(500).json({ error: 'SITE_URL must start with http:// or https://.' });
        }
        if (isLocalhostUrl(origin)) {
            return res.status(500).json({
                error: 'Authorize.net cannot use localhost callback URLs. Set AUTHORIZE_RETURN_BASE_URL to your public https domain.'
            });
        }

        const filePath = path.join(process.cwd(), 'data', 'products.json');
        const products = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        let subtotal = 0;
        const sanitizedItems = [];

        for (const cartItem of items) {
            const dbProduct = products.find(p => p.name === cartItem.name);
            if (!dbProduct) {
                return res.status(400).json({ error: `Product "${cartItem.name}" not found.` });
            }

            const safeQuantity = parseInt(cartItem.quantity, 10);
            if (!Number.isInteger(safeQuantity) || safeQuantity < 1) {
                return res.status(400).json({ error: `Invalid quantity for ${dbProduct.name}.` });
            }

            if (safeQuantity > dbProduct.stock) {
                return res.status(400).json({ 
                    error: `Sorry, only ${dbProduct.stock} units of ${dbProduct.name} left.` 
                });
            }

            const safePrice = Number.parseFloat(dbProduct.price);
            subtotal += safePrice * safeQuantity;
            sanitizedItems.push({
                id: dbProduct.id,
                name: dbProduct.name,
                price: safePrice,
                quantity: safeQuantity
            });
        }

        const taxRate = 0.09;
        const taxAmount = Number((subtotal * taxRate).toFixed(2));
        const total = Number((subtotal + taxAmount).toFixed(2));
        const invoiceNumber = `MC-${Date.now()}`;

        const merchantAuth = new APIContracts.MerchantAuthenticationType();
        merchantAuth.setName(apiLoginId);
        merchantAuth.setTransactionKey(transactionKey);

        const lineItemList = sanitizedItems.map(item => {
            const lineItem = new APIContracts.LineItemType();
            lineItem.setItemId(String(item.id).slice(0, 31));
            lineItem.setName(String(item.name).slice(0, 31));
            lineItem.setQuantity(item.quantity);
            lineItem.setUnitPrice(item.price.toFixed(2));
            return lineItem;
        });

        const lineItemsContainer = new APIContracts.ArrayOfLineItem();
        lineItemsContainer.setLineItem(lineItemList);

        const order = new APIContracts.OrderType();
        order.setInvoiceNumber(invoiceNumber);
        order.setDescription('maocamera ltd order');

        const transactionRequest = new APIContracts.TransactionRequestType();
        transactionRequest.setTransactionType(APIContracts.TransactionTypeEnum.AUTHCAPTURETRANSACTION);
        transactionRequest.setAmount(total.toFixed(2));
        transactionRequest.setLineItems(lineItemsContainer);
        transactionRequest.setOrder(order);

        const returnOptions = new APIContracts.SettingType();
        returnOptions.setSettingName('hostedPaymentReturnOptions');
        returnOptions.setSettingValue(JSON.stringify({
            showReceipt: false,
            url: `${origin}/pages/success.html?invoice=${encodeURIComponent(invoiceNumber)}`,
            urlText: 'Continue',
            cancelUrl: `${origin}/pages/cart.html`,
            cancelUrlText: 'Back to Cart'
        }));

        const iFrameOptions = new APIContracts.SettingType();
        iFrameOptions.setSettingName('hostedPaymentIFrameCommunicatorUrl');
        iFrameOptions.setSettingValue(JSON.stringify({
            url: `${origin}/pages/cart.html`
        }));

        const hostedPaymentSettings = new APIContracts.ArrayOfSetting();
        hostedPaymentSettings.setSetting([returnOptions, iFrameOptions]);

        const hostedRequest = new APIContracts.GetHostedPaymentPageRequest();
        hostedRequest.setMerchantAuthentication(merchantAuth);
        hostedRequest.setTransactionRequest(transactionRequest);
        hostedRequest.setHostedPaymentSettings(hostedPaymentSettings);

        const preferredEnvironment = process.env.AUTHORIZE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
        const fallbackEnvironment = preferredEnvironment === 'production' ? 'sandbox' : 'production';

        let token;
        let activeEnvironment = preferredEnvironment;
        try {
            token = await createHostedPaymentToken(hostedRequest, preferredEnvironment);
        } catch (primaryError) {
            if (!/invalid authentication values/i.test(primaryError.message)) {
                throw primaryError;
            }

            token = await createHostedPaymentToken(hostedRequest, fallbackEnvironment);
            activeEnvironment = fallbackEnvironment;
        }

        const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;
        if (redisUrl) {
            const client = createClient({ url: redisUrl });
            try {
                await client.connect();
                await client.set(
                    `order:${invoiceNumber}`,
                    JSON.stringify({ invoiceNumber, items: sanitizedItems }),
                    { EX: 172800 }
                );
            } finally {
                await client.quit();
            }
        }

        const paymentBaseUrl = activeEnvironment === 'production'
            ? 'https://accept.authorize.net/payment/payment'
            : 'https://test.authorize.net/payment/payment';

        res.status(200).json({
            url: `${paymentBaseUrl}?token=${encodeURIComponent(token)}`,
            invoiceNumber
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
