// server/src/catalogue/discovery.js
import config from '../config.js';
import { getMerchants, getProducts } from './index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDomain } from 'tldts';

const tokens = (value) => new Set(String(value ?? '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((part) => part.length > 1));
// trusted_domains.json is editable configuration for source labeling, not a safety guarantee.
const trustedDomains = new Set(JSON.parse(readFileSync(fileURLToPath(new URL('./trusted_domains.json', import.meta.url)), 'utf8')));
function registrableDomain(value) {
  const host = String(value ?? '').toLowerCase().replace(/^www\./, '');
  return getDomain(host) ?? host;
}
function marketplacePriority(product) {
  if (product.first_party === true) return 2;
  return trustedDomains.has(registrableDomain(product.domain)) ? 1 : 0;
}
function rank(product, queryTerms) {
  const haystack = tokens(`${product.title} ${product.category} ${product.brand ?? ''} ${product.description}`);
  return [...queryTerms].reduce((score, term) => score + (haystack.has(term) ? 1 : 0), 0);
}
function demoRank(product, queryTerms) {
  const haystack = tokens(`${product.title} ${product.category_hint ?? product.category ?? ''}`);
  return [...queryTerms].reduce((score, term) => score + (haystack.has(term) ? 1 : 0), 0);
}
function normalizeCategory(value, query) {
  const text = `${value ?? ''} ${query ?? ''}`.toLocaleLowerCase();
  for (const category of ['mouse', 'keyboard', 'headset', 'monitor', 'webcam']) {
    if (new RegExp(`\\b${category}s?\\b`).test(text)) return category;
  }
  return 'other';
}
function withSource(product, source = 'curated') {
  const domain = String(product.domain ?? 'catalogue.local').toLowerCase();
  return { ...product, source, domain,
    url: product.url ?? `http://${domain}:3000/demo-store/${encodeURIComponent(product.product_id)}.html`,
    marketplace_priority: marketplacePriority({ ...product, domain }) };
}
function diverse(products, limit) {
  const counts = new Map(); const selected = [];
  for (const product of products) {
    const domain = registrableDomain(product.domain) || 'unknown';
    if ((counts.get(domain) ?? 0) >= 3) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1); selected.push(product);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function createDiscovery({ fetchImpl = (...args) => fetch(...args), settings = config,
  catalogueProducts = getProducts, merchants = getMerchants } = {}) {
  let lastProvider = settings.CHANNEL3_API_KEY ? 'channel3' : 'curated';
  async function channel3(query, limit, signal, allowedDomains = []) {
    if (!settings.CHANNEL3_API_KEY) return null;
    const filters = allowedDomains.length ? { website_ids: allowedDomains } : undefined;
    const response = await fetchImpl(`${settings.CHANNEL3_API_URL}/v1/search`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': settings.CHANNEL3_API_KEY },
      body: JSON.stringify({ query, limit, config: { country: settings.CHANNEL3_REGION }, ...(filters ? { filters } : {}) }),
      signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`Channel3 returned HTTP ${response.status}`);
    const body = await response.json();
    const rows = Array.isArray(body) ? body : (body.data ?? body.products ?? body.results ?? []);
    const merchantList = new Map(merchants().map((entry) => [entry.name.toLowerCase(), entry.merchant_id]));
    const results = [];
    rows.forEach((entry, index) => {
      const offers = Array.isArray(entry.offers) && entry.offers.length ? entry.offers : [entry.offer ?? entry];
      offers.forEach((offer, offerIndex) => {
        // Channel3's ProductOffer price is commonly an object such as
        // { price: 24.99, currency: "USD" }; accept the explicit cents form too.
        const rawPrice = offer.price_cents ?? offer.price?.amount ?? offer.price?.value ?? offer.price?.price
          ?? offer.price ?? entry.price_cents ?? entry.price?.amount ?? entry.price?.value ?? entry.price?.price
          ?? entry.price;
        const parsedPrice = typeof rawPrice === 'string'
          ? Number(rawPrice.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.'))
          : Number(rawPrice);
        const price_cents = Number.isInteger(offer.price_cents) ? offer.price_cents : Math.round(parsedPrice * 100);
        const url = offer.url ?? entry.url ?? entry.product_url;
        if (!entry.title || !Number.isSafeInteger(price_cents) || price_cents <= 0 || !url) return;
        let parsedUrl; try { parsedUrl = new URL(url); } catch { return; }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) return;
        const domain = String(offer.domain ?? parsedUrl.hostname).toLowerCase();
        const sellerValue = offer.merchant?.name ?? offer.merchant ?? offer.seller?.name ?? offer.seller ?? offer.name ?? domain;
        const seller = String(sellerValue);
        const merchant_id = String(offer.merchant_id ?? entry.merchant_id ?? merchantList.get(seller.toLowerCase()) ?? `store:${registrableDomain(domain)}`);
        const product = withSource({ product_id: `${String(entry.id ?? entry.product_id ?? `channel3-${index}`)}@${registrableDomain(domain) || offerIndex}`,
          merchant_id, merchant_name: seller, title: String(entry.title), description: String(entry.description ?? ''),
          brand: String(entry.brand ?? ''), price_cents, currency: String(offer.currency ?? offer.price?.currency ?? entry.currency ?? 'USD'),
          category: normalizeCategory(entry.category ?? entry.category_hint, query),
          is_bundle: typeof entry.is_bundle === 'boolean' ? entry.is_bundle : null, url: parsedUrl.toString(), domain,
          first_party: offer.first_party === true || entry.first_party === true, availability: offer.availability ?? 'unknown',
          image_url: entry.image_url ?? null }, 'channel3');
        product.marketplace_priority = marketplacePriority(product);
        results.push(product);
      });
    });
    return results;
  }
  async function searchProducts(query, { limit = 12, item_query = query, category_terms = [], allowed_domains = [], signal } = {}) {
    const safeLimit = Math.min(12, Math.max(1, Number(limit) || 12));
    const queryTerms = new Set([...tokens(query), ...tokens(item_query), ...category_terms.flatMap((term) => [...tokens(term)])]);
    if (!queryTerms.size) return [];
    const localProducts = settings.INCLUDE_DEMO_LISTINGS ? catalogueProducts().map((product) => withSource(product)) : [];
    let live = null;
    try { live = await channel3(query, 12, signal, allowed_domains); } catch (error) { if (signal?.aborted) throw error; live = null; }
    const provider = live ? 'channel3' : 'curated';
    lastProvider = provider;
    const base = live ?? localProducts;
    const scored = base.map((product) => ({ product, score: rank(product, queryTerms) }))
      .filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.product.price_cents - b.product.price_cents)
      .map(({ product }) => product);
    let combined = scored;
    if (settings.INCLUDE_DEMO_LISTINGS) {
      const demo = localProducts.map((product) => ({ product, score: demoRank(product, queryTerms) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.product.price_cents - b.product.price_cents)
        .slice(0, 6).map(({ product }) => product);
      const ids = new Set(combined.map((product) => `${product.domain}:${product.title.toLowerCase()}`));
      combined = [...combined, ...demo.filter((product) => !ids.has(`${product.domain}:${product.title.toLowerCase()}`))];
    }
    const reranked = combined.map((product) => ({ product, score: rank(product, queryTerms) }))
      .sort((a, b) => b.product.marketplace_priority - a.product.marketplace_priority || b.score - a.score || a.product.price_cents - b.product.price_cents)
      .map(({ product }) => product);
    return diverse(reranked, safeLimit).map((product) => ({ ...product, discovery_provider: provider }));
  }
  function getDiscoveryStatus() {
    return { provider: lastProvider, demo_listings: settings.INCLUDE_DEMO_LISTINGS, region: settings.CHANNEL3_REGION };
  }
  return Object.freeze({ searchProducts, getDiscoveryStatus });
}

const discovery = createDiscovery();
export const searchProducts = discovery.searchProducts;
export const getDiscoveryStatus = discovery.getDiscoveryStatus;
