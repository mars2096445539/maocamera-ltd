const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');
const APIContracts = require('authorizenet').APIContracts;
const APIControllers = require('authorizenet').APIControllers;
const Constants = require('authorizenet').Constants;

const ilZipTaxRatesPath = path.join(process.cwd(), 'data', 'il-zip-tax-rates.json');
let ilZipTaxRates = {};
try {
    ilZipTaxRates = JSON.parse(fs.readFileSync(ilZipTaxRatesPath, 'utf8'));
} catch (error) {
    ilZipTaxRates = {};
}

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

function isCheckoutEnabled() {
    const raw = String(process.env.CHECKOUT_ENABLED ?? 'true').trim().toLowerCase();
    return !['false', '0', 'no', 'off'].includes(raw);
}

function normalizeUsState(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (raw.length === 2) return raw;
    if (raw === 'ILLINOIS') return 'IL';
    return raw;
}

function normalizeZip(value) {
    return String(value || '').trim().replace(/[^0-9]/g, '').slice(0, 5);
}

function normalizeShippingAddress(address = {}) {
    return {
        line1: String(address.line1 || '').trim(),
        line2: String(address.line2 || '').trim(),
        city: String(address.city || '').trim(),
        state: normalizeUsState(address.state),
        zip: normalizeZip(address.zip),
        country: String(address.country || 'US').trim().toUpperCase()
    };
}

function isUsCountry(value) {
    const country = String(value || '').trim().toUpperCase();
    return country === 'US' || country === 'USA';
}

function getClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const realIp = String(req.headers['x-real-ip'] || '').trim();
    return forwardedFor || realIp || 'unknown';
}

async function applyRateLimit(client, key, windowSec, limit) {
    const safeWindowSec = Number.isInteger(windowSec) && windowSec > 0 ? windowSec : 60;
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 30;

    const current = await client.incr(key);
    if (current === 1) {
        await client.expire(key, safeWindowSec);
    }

    const ttl = await client.ttl(key);
    return {
        allowed: current <= safeLimit,
        remaining: Math.max(safeLimit - current, 0),
        retryAfter: ttl > 0 ? ttl : safeWindowSec
    };
}

async function getTaxRateFromAddress(address, redisClient) {
    const state = normalizeUsState(address.state);
    const zip = normalizeZip(address.zip);

    if (state !== 'IL') {
        return { taxRate: 0, source: 'non-il' };
    }

    if (zip && redisClient) {
        const redisRateRaw = await redisClient.hGet('tax:il:zip-rates', zip);
        if (redisRateRaw !== null) {
            const redisRate = Number.parseFloat(redisRateRaw);
            if (Number.isFinite(redisRate) && redisRate >= 0 && redisRate <= 1) {
                return { taxRate: redisRate, source: `redis:${zip}` };
            }
        }
    }

    if (zip && Object.prototype.hasOwnProperty.call(ilZipTaxRates, zip)) {
        return { taxRate: Number(ilZipTaxRates[zip]), source: `il-zip:${zip}` };
    }

    return { taxRate: 0.0625, source: 'il-fallback' };
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).end();

    if (!isCheckoutEnabled()) {
        return res.status(503).json({ error: 'Checkout is temporarily unavailable.' });
    }

    let redisClient = null;

    try {
        const { items, shippingAddress, billingSameAsShipping, shippingMethod } = req.body || {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Cart is empty.' });
        }
        if (items.length > 50) {
            return res.status(400).json({ error: 'Too many items in cart.' });
        }

        const normalizedShippingAddress = normalizeShippingAddress(shippingAddress);
        if (!isUsCountry(normalizedShippingAddress.country)) {
            return res.status(400).json({ error: 'Only US shipping addresses are supported.' });
        }
        if (!normalizedShippingAddress.state || !normalizedShippingAddress.zip) {
            return res.status(400).json({ error: 'Shipping address requires state and ZIP code.' });
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
        const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;

        if (redisUrl) {
            try {
                redisClient = createClient({ url: redisUrl });
                await redisClient.connect();
            } catch (redisConnectError) {
                redisClient = null;
            }
        }

        if (redisClient) {
            const ip = getClientIp(req);
            const windowSec = parseInt(process.env.CHECKOUT_RATE_LIMIT_WINDOW_SEC || '60', 10);
            const limit = parseInt(process.env.CHECKOUT_RATE_LIMIT_MAX || '30', 10);
            const limitKey = `ratelimit:checkout:${ip}`;
            const rateLimit = await applyRateLimit(redisClient, limitKey, windowSec, limit);

            if (!rateLimit.allowed) {
                res.setHeader('Retry-After', String(rateLimit.retryAfter));
                return res.status(429).json({ error: 'Too many checkout attempts. Please try again shortly.' });
            }
        }

        let subtotal = 0;
        const sanitizedItems = [];

        for (const cartItem of items) {
            if (!cartItem || typeof cartItem !== 'object') {
                return res.status(400).json({ error: 'Invalid cart item payload.' });
            }

            const requestedId = String(cartItem.id || '').trim();
            if (!requestedId) {
                return res.status(400).json({ error: 'Product id is required for every item.' });
            }

            const dbProduct = products.find(p => String(p.id) === requestedId);
            if (!dbProduct) {
                return res.status(400).json({ error: `Product id "${requestedId}" not found.` });
            }

            if (String(cartItem.id) !== String(dbProduct.id)) {
                return res.status(400).json({ error: `Invalid product id for ${dbProduct.name}.` });
            }

            if (cartItem.name && String(cartItem.name).trim() !== String(dbProduct.name)) {
                return res.status(400).json({ error: `Invalid product name for id ${dbProduct.id}.` });
            }

            const safeQuantity = parseInt(cartItem.quantity, 10);
            if (!Number.isInteger(safeQuantity) || safeQuantity < 1 || safeQuantity > 99) {
                return res.status(400).json({ error: `Invalid quantity for ${dbProduct.name}.` });
            }

            let availableStock = parseInt(dbProduct.stock, 10);
            if (!Number.isInteger(availableStock) || availableStock < 0) {
                availableStock = 0;
            }

            if (redisClient) {
                const liveStockRaw = await redisClient.get(`stock:${dbProduct.name}`);
                if (liveStockRaw !== null) {
                    const liveStock = parseInt(liveStockRaw, 10);
                    if (Number.isInteger(liveStock) && liveStock >= 0) {
                        availableStock = liveStock;
                    }
                }
            }

            if (safeQuantity > availableStock) {
                return res.status(400).json({ 
                    error: `Sorry, only ${availableStock} units of ${dbProduct.name} left.` 
                });
            }

            const safePrice = Number.parseFloat(dbProduct.price);
            const requestedPrice = Number.parseFloat(cartItem.price);
            if (Number.isFinite(requestedPrice)) {
                const normalizedRequested = Number(requestedPrice.toFixed(2));
                const normalizedSafe = Number(safePrice.toFixed(2));
                if (Math.abs(normalizedRequested - normalizedSafe) > 0.00001) {
                    return res.status(400).json({ error: `Invalid price for ${dbProduct.name}.` });
                }
            }
            subtotal += safePrice * safeQuantity;
            sanitizedItems.push({
                id: dbProduct.id,
                name: dbProduct.name,
                price: safePrice,
                quantity: safeQuantity
            });
        }

        const taxConfig = await getTaxRateFromAddress(normalizedShippingAddress, redisClient);
        const taxRate = taxConfig.taxRate;
        const taxAmount = Number((subtotal * taxRate).toFixed(2));

        // Shipping cost
        const isExpedited = shippingMethod === 'expedited';
        const shippingCost = isExpedited ? 11.99 : 0;

        const total = Number((subtotal + taxAmount + shippingCost).toFixed(2));
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

        // Add expedited shipping as a line item
        if (isExpedited) {
            const shippingLineItem = new APIContracts.LineItemType();
            shippingLineItem.setItemId('SHIP-EXPEDITED');
            shippingLineItem.setName('Expedited Shipping');
            shippingLineItem.setQuantity(1);
            shippingLineItem.setUnitPrice(shippingCost.toFixed(2));
            lineItemList.push(shippingLineItem);
        }

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

        if (billingSameAsShipping) {
            const billTo = new APIContracts.CustomerAddressType();
            billTo.setAddress(normalizedShippingAddress.line1);
            billTo.setCity(normalizedShippingAddress.city);
            billTo.setState(normalizedShippingAddress.state);
            billTo.setZip(normalizedShippingAddress.zip);
            billTo.setCountry(normalizedShippingAddress.country || 'US');
            transactionRequest.setBillTo(billTo);
        }

        const returnOptions = new APIContracts.SettingType();
        returnOptions.setSettingName('hostedPaymentReturnOptions');
        returnOptions.setSettingValue(JSON.stringify({
            showReceipt: false,
            url: `${origin}/success?invoice=${encodeURIComponent(invoiceNumber)}`,
            urlText: 'Continue',
            cancelUrl: `${origin}/cart`,
            cancelUrlText: 'Back to Cart'
        }));

        const iFrameOptions = new APIContracts.SettingType();
        iFrameOptions.setSettingName('hostedPaymentIFrameCommunicatorUrl');
        iFrameOptions.setSettingValue(JSON.stringify({
            url: `${origin}/iframe-communicator`
        }));

        const customerOptions = new APIContracts.SettingType();
        customerOptions.setSettingName('hostedPaymentCustomerOptions');
        customerOptions.setSettingValue(JSON.stringify({
            showEmail: true,
            requiredEmail: true
        }));

        const shippingAddressOptions = new APIContracts.SettingType();
        shippingAddressOptions.setSettingName('hostedPaymentShippingAddressOptions');
        shippingAddressOptions.setSettingValue(JSON.stringify({
            show: true,
            required: true
        }));

        const billingAddressOptions = new APIContracts.SettingType();
        billingAddressOptions.setSettingName('hostedPaymentBillingAddressOptions');
        billingAddressOptions.setSettingValue(JSON.stringify({
            show: true,
            required: true
        }));

        const paymentOptions = new APIContracts.SettingType();
        paymentOptions.setSettingName('hostedPaymentPaymentOptions');
        paymentOptions.setSettingValue(JSON.stringify({
            cardCodeRequired: true,
            showCreditCard: true
        }));

        const hostedPaymentSettings = new APIContracts.ArrayOfSetting();
        hostedPaymentSettings.setSetting([
            returnOptions,
            iFrameOptions,
            customerOptions,
            shippingAddressOptions,
            billingAddressOptions,
            paymentOptions
        ]);

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

        if (redisClient) {
            await redisClient.set(
                `order:${invoiceNumber}`,
                JSON.stringify({
                    invoiceNumber,
                    items: sanitizedItems,
                    shippingAddress: normalizedShippingAddress,
                    billingSameAsShipping: Boolean(billingSameAsShipping),
                    shippingMethod: isExpedited ? 'expedited' : 'standard',
                    shippingCost,
                    subtotal,
                    taxRate,
                    taxAmount,
                    total,
                    taxSource: taxConfig.source
                }),
                { EX: 172800 }
            );
        }

        const paymentBaseUrl = activeEnvironment === 'production'
            ? 'https://accept.authorize.net/payment/payment'
            : 'https://test.authorize.net/payment/payment';

        res.status(200).json({
            url: `${paymentBaseUrl}?token=${token}`,
            paymentPageUrl: paymentBaseUrl,
            token,
            environmentUsed: activeEnvironment,
            configuredEnvironment: preferredEnvironment,
            invoiceNumber,
            subtotal,
            shippingMethod: isExpedited ? 'expedited' : 'standard',
            shippingCost,
            taxRate,
            taxAmount,
            total,
            shippingAddress: normalizedShippingAddress
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    } finally {
        if (redisClient) {
            await redisClient.quit();
        }
    }
};
