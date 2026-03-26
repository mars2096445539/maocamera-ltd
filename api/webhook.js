const { createClient } = require('redis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const APIContracts = require('authorizenet').APIContracts;
const APIControllers = require('authorizenet').APIControllers;
const Constants = require('authorizenet').Constants;

const debugWebhook = process.env.AUTHORIZE_WEBHOOK_DEBUG === 'true' || process.env.NODE_ENV !== 'production';

function debugLog(message, payload = null) {
  if (!debugWebhook) return;
  if (payload === null) {
    console.log(`[AuthorizeWebhook] ${message}`);
    return;
  }
  console.log(`[AuthorizeWebhook] ${message}`, payload);
}

function maskValue(value, visibleHead = 6, visibleTail = 4) {
  const str = String(value || '');
  if (!str) return '';
  if (str.length <= visibleHead + visibleTail) return '*'.repeat(str.length);
  return `${str.slice(0, visibleHead)}...${str.slice(-visibleTail)}`;
}

function getAuthorizeEnvironment() {
  return process.env.AUTHORIZE_ENVIRONMENT === 'production'
    ? Constants.endpoint.production
    : Constants.endpoint.sandbox;
}

function normalizeSignatureKey(value) {
  return (value || '').replace(/[^a-fA-F0-9]/g, '');
}

function verifyWebhookSignature(rawPayload, headerSignature, signatureKey) {
  if (!rawPayload || !headerSignature || !signatureKey) return false;
  const hexKey = normalizeSignatureKey(signatureKey);
  if (!hexKey) return false;

  const digest = crypto
    .createHmac('sha512', Buffer.from(hexKey, 'hex'))
    .update(rawPayload, 'utf8')
    .digest('hex');

  return `sha512=${digest}`.toLowerCase() === String(headerSignature).toLowerCase();
}

function getTransactionDetails(merchantAuth, transId) {
  return new Promise((resolve, reject) => {
    const request = new APIContracts.GetTransactionDetailsRequest();
    request.setMerchantAuthentication(merchantAuth);
    request.setTransId(transId);

    const controller = new APIControllers.GetTransactionDetailsController(request.getJSON());
    controller.setEnvironment(getAuthorizeEnvironment());

    controller.execute(() => {
      const apiResponse = controller.getResponse();
      if (!apiResponse) {
        reject(new Error('Authorize.net transaction details response is empty'));
        return;
      }

      const response = new APIContracts.GetTransactionDetailsResponse(apiResponse);
      const resultCode = response.getMessages()?.getResultCode();
      if (resultCode !== APIContracts.MessageTypeEnum.OK) {
        const message = response.getMessages()?.getMessage()?.[0]?.getText() || 'Unable to read transaction details';
        reject(new Error(message));
        return;
      }

      resolve(response.getTransaction());
    });
  });
}

function extractLineItems(transaction) {
  const lineItemsNode = transaction?.getLineItems?.();
  const lineItems = lineItemsNode?.getLineItem?.() || [];
  return lineItems.map(item => ({
    name: item.getName?.(),
    quantity: parseInt(item.getQuantity?.(), 10) || 0
  })).filter(item => item.name && item.quantity > 0);
}

function extractCustomerEmail(transaction) {
  return String(
    transaction?.getCustomer?.()?.getEmail?.()
    || transaction?.getCustomer?.()?.email
    || ''
  ).trim();
}

function loadProductStockMap() {
  const productsPath = path.join(process.cwd(), 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  const stockMap = new Map();
  for (const product of products) {
    const stock = parseInt(product?.stock, 10);
    stockMap.set(product?.name, Number.isInteger(stock) && stock >= 0 ? stock : 0);
  }
  return stockMap;
}

// Disable Vercel's automatic body parsing so we get the raw buffer
// This is critical for webhook signature verification
// NOTE: config is set AFTER module.exports assignment below

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    // If body is already a Buffer (from bodyParser: false)
    if (Buffer.isBuffer(req.body)) {
      return resolve(req.body);
    }
    // If body is already a string
    if (typeof req.body === 'string') {
      return resolve(Buffer.from(req.body, 'utf8'));
    }
    // Read from stream
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const rawBodyBuf = await getRawBody(req);
  const rawBody = rawBodyBuf.toString('utf8');
  const signature = req.headers['x-anet-signature'];
  const signatureKey = process.env.AUTHORIZE_SIGNATURE_KEY;
  const apiLoginId = process.env.AUTHORIZE_API_LOGIN_ID;
  const transactionKey = process.env.AUTHORIZE_TRANSACTION_KEY;
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;

  debugLog('Signature check', {
    rawBodyLength: rawBody.length,
    signaturePresent: Boolean(signature),
    signatureKeyPresent: Boolean(signatureKey)
  });

  if (!verifyWebhookSignature(rawBody, signature, signatureKey)) {
    debugLog('Signature verification FAILED', {
      rawBodyPreview: rawBody.substring(0, 120)
    });
    return res.status(401).json({ received: false, error: 'Invalid Authorize.net signature.' });
  }

  debugLog('Signature verification PASSED');

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch (error) {
    return res.status(400).json({ received: false, error: 'Invalid webhook payload.' });
  }
  const eventType = payload.eventType || '';
  const transactionId = String(payload.payload?.id || '');

  const shouldProcess = eventType.includes('authcapture.created')
    || eventType.includes('capture.created')
    || eventType.includes('auth.created');

  debugLog('Incoming webhook', {
    eventType,
    transactionId: maskValue(transactionId),
    signaturePresent: Boolean(signature),
    shouldProcess
  });

  if (!shouldProcess || !transactionId || !redisUrl) {
    debugLog('Skipping webhook', {
      reason: !shouldProcess ? 'event_not_supported' : (!transactionId ? 'missing_transaction_id' : 'missing_redis_url')
    });
    return res.status(200).json({ received: true, skipped: true });
  }

  if (!apiLoginId || !transactionKey) {
    return res.status(500).json({ received: false, error: 'Missing Authorize.net API credentials.' });
  }

  const client = createClient({ url: redisUrl });

  try {
    await client.connect();

    const processedKey = `processed_txn:${transactionId}`;
    const lock = await client.set(processedKey, '1', { NX: true, EX: 604800 });
    if (lock === null) {
      debugLog('Duplicate webhook ignored', { transactionId: maskValue(transactionId) });
      return res.status(200).json({ received: true, duplicate: true });
    }

    const merchantAuth = new APIContracts.MerchantAuthenticationType();
    merchantAuth.setName(apiLoginId);
    merchantAuth.setTransactionKey(transactionKey);

    const transaction = await getTransactionDetails(merchantAuth, transactionId);
    const invoiceNumber = transaction?.getOrder?.()?.getInvoiceNumber?.();
    const customerEmail = extractCustomerEmail(transaction);
    debugLog('Fetched transaction details', {
      transactionId: maskValue(transactionId),
      invoiceNumber: invoiceNumber || null,
      customerEmail: customerEmail ? maskValue(customerEmail, 2, 10) : null
    });

    let items = extractLineItems(transaction);

    if (items.length === 0 && invoiceNumber) {
      const cachedOrder = await client.get(`order:${invoiceNumber}`);
      if (cachedOrder) {
        const parsed = JSON.parse(cachedOrder);
        items = (parsed.items || []).map(item => ({
          name: item.name,
          quantity: parseInt(item.quantity, 10) || 0
        })).filter(item => item.name && item.quantity > 0);
        debugLog('Recovered items from cached order', {
          invoiceNumber,
          itemCount: items.length
        });
      }
    }

    const productStockMap = loadProductStockMap();

    for (const item of items) {
      const stockKey = `stock:${item.name}`;
      const currentRaw = await client.get(stockKey);
      const fileStock = productStockMap.get(item.name) ?? 0;

      let effectiveStock = fileStock;
      if (currentRaw !== null) {
        const redisStock = parseInt(currentRaw, 10);
        if (Number.isInteger(redisStock) && redisStock >= 0) {
          effectiveStock = redisStock;
        } else if (Number.isInteger(redisStock) && redisStock < 0) {
          effectiveStock = Math.max(fileStock + redisStock, 0);
        }
      }

      const nextStock = Math.max(effectiveStock - item.quantity, 0);
      await client.set(stockKey, String(nextStock));
    }

    if (invoiceNumber && customerEmail) {
      const orderKey = `order:${invoiceNumber}`;
      const existing = await client.get(orderKey);
      if (existing) {
        const ttl = await client.ttl(orderKey);
        const parsed = JSON.parse(existing);
        parsed.customerEmail = customerEmail;
        parsed.transactionId = transactionId;

        if (ttl > 0) {
          await client.set(orderKey, JSON.stringify(parsed), { EX: ttl });
        } else {
          await client.set(orderKey, JSON.stringify(parsed));
        }
      }
    }

    debugLog('Inventory decremented', {
      invoiceNumber: invoiceNumber || null,
      lineItems: items.map(item => ({ name: item.name, quantity: item.quantity }))
    });

    debugLog('Webhook processed successfully', { transactionId: maskValue(transactionId) });
    res.status(200).json({ received: true, processed: true });
  } catch (err) {
    console.error('Authorize.net webhook processing error:', err);
    res.status(500).json({ received: false, error: err.message });
  } finally {
    await client.quit();
  }
};

// Must be set AFTER module.exports so the config is on the handler function
module.exports.config = {
  api: {
    bodyParser: false
  }
};
