import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function fingerprint(products) {
  return createHash('sha256').update(canonical(products)).digest('hex');
}

export function trustedMarketplaceProduct(product) {
  return {
    product_id: product.product_id,
    merchant_id: product.merchant_id,
    price_cents: product.price_cents,
    currency: product.currency,
    category: product.category,
    is_bundle: product.is_bundle,
    domain: product.domain,
    first_party: product.first_party === true,
  };
}

export function paymentEvidenceFor(product, catalogueProduct = product) {
  if (product.source === 'curated') return { evidence: { catalogue_hash: fingerprint([catalogueProduct]) }, proposal: {} };

  if (!['channel3', 'page'].includes(product.source)) throw new Error('External payment evidence requires a known listing source');
  const source = product.source;
  const snapshot = trustedMarketplaceProduct(product);
  const url = new URL(product.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Channel3 listing URL must use HTTP or HTTPS');
  return {
    evidence: {
      catalogue_hash: fingerprint([snapshot]),
      marketplace_snapshot: { source, product: snapshot },
    },
    proposal: {
      sandbox_demo_payment: true,
      sandbox_listing: {
        source, title: String(product.title), url: url.toString(),
        domain: String(product.domain), merchant_name: String(product.merchant_name ?? product.merchant_id),
      },
    },
  };
}

export function validateMarketplaceSnapshot(proposal) {
  if (proposal?.sandbox_demo_payment !== true || !['channel3', 'page'].includes(proposal?.evidence?.marketplace_snapshot?.source)) return null;
  const product = proposal.evidence.marketplace_snapshot.product;
  if (!product || typeof product !== 'object'
    || typeof product.product_id !== 'string' || typeof product.merchant_id !== 'string'
    || !Number.isSafeInteger(product.price_cents) || product.price_cents <= 0
    || typeof product.currency !== 'string' || !/^[A-Z]{3}$/.test(product.currency)
    || typeof product.category !== 'string' || !(product.is_bundle === null || typeof product.is_bundle === 'boolean')
    || typeof product.domain !== 'string' || typeof product.first_party !== 'boolean') return null;
  if (!Array.isArray(proposal.items) || proposal.items.length !== 1) return null;
  const [item] = proposal.items;
  if (item.sku !== product.product_id || item.unit_price_cents !== product.price_cents
    || item.quantity !== 1 || proposal.currency !== product.currency || proposal.merchant_id !== product.merchant_id
    || proposal.total_cents !== product.price_cents) return null;
  if (proposal.evidence.catalogue_hash !== fingerprint([product])) return null;
  return product;
}
