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
function pageRows(body) {
  if (Array.isArray(body)) return body;
  // Channel3's HTTP search response is a paginated Page whose products live
  // in `data`. Accept the common SDK/wrapper forms as well for proxy setups.
  const candidates = [body?.data, body?.items, body?.products, body?.results,
    body?.data?.items, body?.data?.products, body?.data?.results];
  const rows = candidates.find(Array.isArray);
  if (!rows) throw new Error('Channel3 returned an unexpected search response');
  return rows;
}
function priceInCents(value) {
  if (value && typeof value === 'object') {
    return priceInCents(value.amount ?? value.value ?? value.price ?? value.minor_units);
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    value = Number(normalized);
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}
function normalizeCategory(value, query) {
  const text = `${value ?? ''} ${query ?? ''}`.toLocaleLowerCase();
  for (const category of ['mouse', 'keyboard', 'headset', 'monitor', 'webcam']) {
    if (new RegExp(`\\b${category}s?\\b`).test(text)) return category;
  }
  return 'other';
}
function withSource(product, source = 'curated') {
  const merchantSlug = String(product.merchant_id ?? 'catalogue').toLowerCase().replace(/^m_/, '').replace(/[^a-z0-9-]/g, '') || 'catalogue';
  const domain = String(product.domain ?? `${merchantSlug}.localhost`).toLowerCase();
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
  async function channel3(query, limit, signal, allowedDomains = [], maxPriceCents = null) {
    if (!settings.CHANNEL3_API_KEY) return null;
    const filters = {};
    if (allowedDomains.length) filters.website_ids = allowedDomains;
    if (Number.isSafeInteger(maxPriceCents) && maxPriceCents > 0) filters.price = { max_price: maxPriceCents / 100 };
    const response = await fetchImpl(`${settings.CHANNEL3_API_URL}/v1/search`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': settings.CHANNEL3_API_KEY },
      body: JSON.stringify({ query, limit, config: { country: settings.CHANNEL3_REGION }, ...(Object.keys(filters).length ? { filters } : {}) }),
      signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error(`Channel3 returned HTTP ${response.status}`);
    const body = await response.json();
    const rows = pageRows(body);
    const merchantList = new Map(merchants().map((entry) => [entry.name.toLowerCase(), entry.merchant_id]));
    const results = [];
    rows.forEach((entry, index) => {
      const offers = Array.isArray(entry.offers) && entry.offers.length ? entry.offers : [entry.offer ?? entry];
      offers.forEach((offer, offerIndex) => {
        // Channel3 ProductOffer uses `price: { price, currency }`; some
        // integrations expose amount/value or an explicit cents field.
        const rawCents = offer.price_cents ?? entry.price_cents;
        const rawPrice = offer.price ?? entry.price;
        const price_cents = Number.isSafeInteger(rawCents) ? rawCents : priceInCents(rawPrice);
        const url = offer.url ?? entry.url ?? entry.product_url;
        if (!entry.title || !Number.isSafeInteger(price_cents) || price_cents <= 0 || !url) return;
        let parsedUrl; try { parsedUrl = new URL(url); } catch { return; }
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) return;
        const domain = registrableDomain(String(offer.domain ?? parsedUrl.hostname));
        if (!domain) return;
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
  async function searchProducts(query, { limit = 12, item_query = query, category_terms = [], allowed_domains = [], max_price_cents = null, signal } = {}) {
    const safeLimit = Math.min(12, Math.max(1, Number(limit) || 12));
    const queryTerms = new Set([...tokens(query), ...tokens(item_query), ...category_terms.flatMap((term) => [...tokens(term)])]);
    if (!queryTerms.size) return [];
    const localProducts = settings.INCLUDE_DEMO_LISTINGS ? catalogueProducts().map((product) => withSource(product)) : [];
    let live = null;
    try { live = await channel3(query, safeLimit, signal, allowed_domains, max_price_cents); }
    catch (error) {
      if (signal?.aborted) throw error;
      // Keep diagnostics useful without ever logging request bodies or credentials.
      const status = /HTTP (\d{3})/.exec(error?.message ?? '')?.[1];
      console.warn(`[discovery] Channel3 search failed${status ? ` (HTTP ${status})` : ''}; using curated fallback if enabled`);
      live = null;
    }
    const provider = live ? 'channel3' : 'curated';
    lastProvider = provider;
    const base = live ?? localProducts;
    const scored = base.map((product) => ({ product, score: live ? rank(product, queryTerms) : demoRank(product, queryTerms) }))
      // Channel3 already performs indexed relevance search (including semantic
      // matches); a local exact-token gate incorrectly discarded valid results.
      .filter((entry) => entry.product.source === 'channel3' || entry.score > 0)
      .sort((a, b) => b.score - a.score || a.product.price_cents - b.product.price_cents)
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
