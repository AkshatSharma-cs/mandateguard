// server/src/paypal/client.js
import { fromCents } from '../money.js';

export class PayPalError extends Error {
  constructor(message, { status, body, debugId } = {}) {
    super(message);
    this.name = 'PayPalError';
    this.status = status ?? null;
    this.body = body ?? null;
    this.debugId = debugId ?? null;
  }
}

let tokenCache = { token: null, expiresAt: 0 };

function baseUrl() {
  const url = process.env.PAYPAL_BASE_URL;
  if (!url) throw new Error('PAYPAL_BASE_URL is not set');
  return url.replace(/\/+$/, '');
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function failIfNotOk(res, label) {
  if (res.ok) return parseBody(res);
  const body = await parseBody(res);
  throw new PayPalError(`PayPal ${label} failed with HTTP ${res.status}`, {
    status: res.status,
    body,
    debugId: res.headers.get('paypal-debug-id'),
  });
}

export async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set');

  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await failIfNotOk(res, 'token request');
  if (!body || typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new PayPalError('PayPal token response malformed', {
      status: res.status,
      body: null,
      debugId: res.headers.get('paypal-debug-id'),
    });
  }
  // Refresh 60 seconds before expiry.
  tokenCache = { token: body.access_token, expiresAt: now + (body.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function authedFetch(method, path, { headers = {}, body } = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return failIfNotOk(res, `${method} ${path.replace(/\/[A-Z0-9]{10,}/g, '/:id')}`);
}

export async function createOrder({ proposal_id, items, currency, mode, sandbox_demo_payment = false, payment_mode = 'store_checkout', domain, title, payee_email, demo_store_order = false, merchant_name }) {
  if (!proposal_id) throw new Error('createOrder: proposal_id required');
  if (!Array.isArray(items) || items.length === 0) throw new Error('createOrder: items required');
  if (mode !== 'sdk' && mode !== 'redirect') throw new Error(`createOrder: invalid mode ${mode}`);

  let itemTotalCents = 0;
  const ppItems = items.map((it) => {
    if (!Number.isSafeInteger(it.quantity) || it.quantity < 1) {
      throw new Error(`createOrder: invalid quantity for ${it.sku}`);
    }
    itemTotalCents += it.unit_price_cents * it.quantity;
    return {
      name: `${payment_mode === 'sandbox_simulation' ? '' : sandbox_demo_payment ? 'Sandbox demo: ' : ''}${String(title ?? it.name).slice(0, 127)}`,
      sku: payment_mode === 'sandbox_simulation' ? String(it.observation_id ?? it.sku).slice(0, 12) : it.sku,
      quantity: String(it.quantity),
      unit_amount: { currency_code: currency, value: fromCents(it.unit_price_cents) },
      category: 'PHYSICAL_GOODS',
    };
  });
  const total = fromCents(itemTotalCents);

  const purchaseUnit = {
        ...(payee_email ? { payee: { email_address: payee_email } } : {}),
        reference_id: proposal_id,
        custom_id: proposal_id,
        invoice_id: proposal_id,
        description: payment_mode === 'sandbox_simulation'
          ? `SANDBOX SIMULATION (no purchase at ${String(domain ?? 'store')}): ${String(title ?? items[0].name)}`.slice(0, 127)
          : demo_store_order ? `MandateGuard demo store order (sandbox): ${String(items[0].name).slice(0, 80)} from ${String(merchant_name ?? 'MandateGuard Demo Store').slice(0, 40)}`.slice(0, 127) : undefined,
        amount: {
          currency_code: currency,
          value: total,
          breakdown: { item_total: { currency_code: currency, value: total } },
        },
        items: ppItems,
      };
  const body = {
    intent: 'CAPTURE',
    purchase_units: [purchaseUnit],
  };

  // The demo store is the merchant and its configured Sandbox business account receives this payment; no real purchase or shipment occurs.

  if (mode === 'redirect') {
    const appBase = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
    body.payment_source = {
      paypal: {
        experience_context: {
          return_url: `${appBase}/return`,
          cancel_url: `${appBase}/cancel`,
          user_action: 'PAY_NOW',
          shipping_preference: 'NO_SHIPPING',
        },
      },
    };
  }

  const data = await authedFetch('POST', '/v2/checkout/orders', {
    headers: { 'PayPal-Request-Id': 'create_' + proposal_id },
    body,
  });

  const link = (data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  return { id: data.id, status: data.status, approve_url: link ? link.href : null };
}

export async function getOrder(order_id) {
  return authedFetch('GET', `/v2/checkout/orders/${encodeURIComponent(order_id)}`);
}

export async function captureOrder(order_id, request_id) {
  return authedFetch('POST', `/v2/checkout/orders/${encodeURIComponent(order_id)}/capture`, {
    headers: { 'PayPal-Request-Id': request_id },
    body: {},
  });
}
