const { createClient } = require('redis');
const crypto = require('crypto');
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

module.exports = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body || {});
  const signature = req.headers['x-anet-signature'];
  const signatureKey = process.env.AUTHORIZE_SIGNATURE_KEY;
  const apiLoginId = process.env.AUTHORIZE_API_LOGIN_ID;
  const transactionKey = process.env.AUTHORIZE_TRANSACTION_KEY;
  const redisUrl = process.env.REDIS_URL || process.env.STORAGE_URL;

  if (!verifyWebhookSignature(rawBody, signature, signatureKey)) {
    return res.status(401).json({ received: false, error: 'Invalid Authorize.net signature.' });
  }

  const payload = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(rawBody || '{}');
  const eventType = payload.eventType || '';
  const transactionId = String(payload.payload?.id || '');

  const shouldProcess = eventType.includes('authcapture.created') || eventType.includes('capture.created');

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
    debugLog('Fetched transaction details', {
      transactionId: maskValue(transactionId),
      invoiceNumber: invoiceNumber || null
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

    for (const item of items) {
      await client.decrBy(`stock:${item.name}`, item.quantity);
    }

    debugLog('Inventory decremented', {
      invoiceNumber: invoiceNumber || null,
      lineItems: items.map(item => ({ name: item.name, quantity: item.quantity }))
    });

    if (invoiceNumber) {
      await client.del(`order:${invoiceNumber}`);
    }

    debugLog('Webhook processed successfully', { transactionId: maskValue(transactionId) });
    res.status(200).json({ received: true, processed: true });
  } catch (err) {
    console.error('Authorize.net webhook processing error:', err);
    res.status(500).json({ received: false, error: err.message });
  } finally {
    await client.quit();
  }
};
