// examples/merchant-agent.js
// Node 20, no dependencies: a small merchant-side caller for the local MandateGuard gateway.
import { createHash } from 'node:crypto';

const base = (process.env.MG_API_BASE || 'http://localhost:3000').replace(/\/$/, '');
const apiKey = process.env.MG_API_KEY;
const productId = process.argv[2] || 'p_ok_1';
const headers = { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) };

async function call(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${data?.error?.code || response.status}: ${data?.error?.message || 'Gateway request failed'}`);
  return data;
}

try {
  const catalogue = await call('/api/catalogue');
  const product = catalogue.products.find((item) => item.product_id === productId);
  if (!product) throw new Error(`Demo-store product not found: ${productId}`);
  const merchant = catalogue.merchants.find((item) => item.merchant_id === product.merchant_id);
  if (!merchant) throw new Error(`Merchant not found for product: ${productId}`);
  const slug = product.merchant_id.toLowerCase().replace(/^m_/, '').replace(/[^a-z0-9-]/g, '') || 'catalogue';
  const domain = product.domain || `${slug}.localhost`;
  const url = product.url || `http://${domain}:3000/demo-store/${encodeURIComponent(product.product_id)}.html`;
  const observation = {
    observation_id: product.product_id, url, domain, source: 'curated', title: product.title,
    price_cents: product.price_cents, currency: product.currency, seller: merchant.name,
    sold_by_merchant: true, availability: 'in stock', image_url: product.image_url || null,
    category_hint: product.category, bundle_signal: product.is_bundle, hidden_text_found: false,
    text: product.description, captured_at: new Date().toISOString(),
    content_hash: createHash('sha256').update(product.description).digest('hex'),
  };
  // Omitting mandate_id/profile_id makes the API apply the owner's confirmed default profile.
  const result = await call('/v1/evaluate', { observation });
  console.log(`Decision: ${result.decision}`);
  if (result.decision === 'ALLOW' && result.checkout_mode === 'gateway') {
    const created = await call('/v1/proposals', { evaluation_id: result.evaluation_id });
    console.log(`Proposal: ${created.proposal.proposal_id}`);
    console.log(`Console: ${created.console_url}`);
  } else {
    for (const reason of result.reasons || []) console.log(`- ${reason.message || reason.code}`);
    for (const alternative of result.alternatives || []) {
      console.log(`Alternative: ${alternative.observation.title} — ${alternative.observation.url}`);
    }
    if (result.checkout_mode === 'handoff') console.log(`Open listing: ${result.handoff_url}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
