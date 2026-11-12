// extension/content/extract.js
(() => {
  const visible = node => {
    if (!node) return false;
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.fontSize !== '0px'
      && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
      && node.getAttribute('aria-hidden') !== 'true';
  };
  const textOf = nodes => nodes.filter(visible).map(node => node.innerText || node.textContent || '').join('\n').replace(/\s+/g, ' ').trim();
  const cents = value => {
    const match = String(value ?? '').replace(/,/g, '').match(/(?:^|[^\d])(\d+)(?:\.(\d{1,2}))?/);
    return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
  };
  function extract() {
    const page = location.href, domain = location.hostname;
    let title = '', price = null, currency = 'USD', seller = '';
    const products = [];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const walk = value => { if (!value) return; if (Array.isArray(value)) return value.forEach(walk); if (typeof value !== 'object') return;
          if (value['@type'] === 'Product' || (Array.isArray(value['@type']) && value['@type'].includes('Product'))) products.push(value);
          if (value['@graph']) walk(value['@graph']); };
        walk(JSON.parse(script.textContent || ''));
      } catch { /* Ignore malformed structured data. */ }
    }
    const product = products[0];
    if (product) { title = product.name || ''; seller = product.brand?.name || product.brand || product.offers?.seller?.name || ''; const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers; price = cents(offer?.price ?? offer?.lowPrice); currency = offer?.priceCurrency || currency; }
    const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content || '';
    if (!title) title = meta('og:title');
    if (price == null) price = cents(meta('product:price:amount') || meta('og:price:amount'));
    currency = meta('product:price:currency') || meta('og:price:currency') || currency;
    if (!title) { const heading = document.querySelector('[itemprop="name"], h1'); title = (heading?.innerText || heading?.textContent || '').trim() || document.title; }
    if (price == null) price = cents(document.querySelector('[itemprop="price"]')?.getAttribute('content') || document.querySelector('[data-price]')?.getAttribute('data-price') || '');
    const featureNodes = [...document.querySelectorAll('#feature-bullets li, [data-feature], .a-unordered-list .a-list-item, [itemprop="description"], #productDescription, main p')].slice(0, 80);
    const hidden_text_found = featureNodes.some(node => !visible(node) && Boolean((node.innerText || node.textContent || '').trim()));
    const text = textOf(featureNodes).slice(0, 4000);
    const bundle_signal = /\b(bundle|pack of|set of|combo)\b/i.test(title);
    return { observation_id: `page-${location.hostname}-${Date.now()}`, url: page, domain, title: String(title).trim().slice(0, 500), price_cents: price, currency: String(currency).toUpperCase(), seller: String(seller || domain).slice(0, 256), sold_by_merchant: false, availability: 'unknown', image_url: null, category_hint: null, bundle_signal, hidden_text_found, text, captured_at: new Date().toISOString() };
  }
  Object.defineProperty(window, '__mgExtract', { value: extract, configurable: false });
  if (typeof module !== 'undefined' && module) module.exports = extract;
})();
