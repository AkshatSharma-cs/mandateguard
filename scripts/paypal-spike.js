// scripts/paypal-spike.js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOrder, getOrder, captureOrder, PayPalError } from '../server/src/paypal/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function logError(err) {
  if (err instanceof PayPalError) {
    console.error('PayPalError', {
      status: err.status,
      debugId: err.debugId,
      body: JSON.stringify(err.body, null, 2),
    });
  } else {
    console.error(err);
  }
}

app.get('/spike/config', (_req, res) => {
  res.json({ client_id: process.env.PAYPAL_CLIENT_ID || null });
});

app.post('/spike/create', async (_req, res) => {
  try {
    const proposal_id = 'spike_' + Date.now();
    const order = await createOrder({
      proposal_id,
      items: [{ sku: 'p_spike', name: 'Test Mouse', quantity: 1, unit_price_cents: 2499 }],
      currency: 'USD',
      mode: 'sdk',
    });
    console.log(`created order ${order.id} (status ${order.status}) for ${proposal_id}`);
    res.json({ id: order.id, proposal_id });
  } catch (err) {
    logError(err);
    res.status(500).json({ error: err.message, debug_id: err.debugId ?? null });
  }
});

app.post('/spike/capture', async (req, res) => {
  const { order_id, proposal_id } = req.body || {};
  const assertions = [];
  const check = (name, pass, detail) => {
    assertions.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${pass ? '' : ' -> ' + detail}`);
    return pass;
  };

  try {
    if (!order_id || !proposal_id) {
      return res.status(400).json({ error: 'order_id and proposal_id required' });
    }

    const before = await getOrder(order_id);
    if (!check('order status APPROVED before capture', before.status === 'APPROVED', `got ${before.status}`)) {
      return res.status(409).json({ assertions, raw: before });
    }

    await captureOrder(order_id, 'capture_' + proposal_id);

    const after = await getOrder(order_id);
    check('order status COMPLETED after capture', after.status === 'COMPLETED', `got ${after.status}`);

    const pu = after.purchase_units?.[0] || {};
    const capture = pu.payments?.captures?.[0];
    const summary = {
      order_id: after.id,
      status: after.status,
      amount: pu.amount?.value ?? null,
      currency: pu.amount?.currency_code ?? null,
      payee_email: pu.payee?.email_address ?? null,
      invoice_id: pu.invoice_id ?? capture?.invoice_id ?? null,
      custom_id: pu.custom_id ?? capture?.custom_id ?? null,
      capture_id: capture?.id ?? null,
    };

    console.log('\n=== SUMMARY ===');
    for (const [k, v] of Object.entries(summary)) console.log(`${k}: ${v}`);
    console.log('\n=== RAW getOrder (final) ===');
    console.log(JSON.stringify(after, null, 2));

    res.json({ summary, assertions, raw: after });
  } catch (err) {
    logError(err);
    res.status(500).json({ error: err.message, debug_id: err.debugId ?? null, assertions });
  }
});

app.listen(PORT, () => {
  console.log(`Spike server ready. Open: http://localhost:${PORT}/spike.html`);
});