// server/src/policy/engine.js
const isInt = (value) => Number.isSafeInteger(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validFlags = (value) => isObject(value) && Object.keys(value).length === 3
  && ['zero_width', 'html_comment', 'hidden_style'].every((key) => typeof value[key] === 'boolean');

function validExtraction(value) {
  return isObject(value) && Object.keys(value).every((key) => ['category_label', 'claimed_price_cents', 'claims_bundle', 'addon_offers', 'directives_to_agent', 'asserts_authority_override', 'urgency_pressure', 'evidence', 'confidence'].includes(key))
    && Object.keys(value).length === 9
    && ['mouse', 'keyboard', 'headset', 'monitor', 'webcam', 'other', 'unclear'].includes(value.category_label)
    && (value.claimed_price_cents === null || (isInt(value.claimed_price_cents) && value.claimed_price_cents >= 0))
    && typeof value.claims_bundle === 'boolean'
    && Array.isArray(value.addon_offers) && value.addon_offers.length <= 5
    && value.addon_offers.every((offer) => isObject(offer) && Object.keys(offer).length === 2
      && Object.keys(offer).every((key) => key === 'name' || key === 'price_cents')
      && typeof offer.name === 'string' && (offer.price_cents === null || (isInt(offer.price_cents) && offer.price_cents >= 0)))
    && typeof value.directives_to_agent === 'boolean'
    && typeof value.asserts_authority_override === 'boolean'
    && typeof value.urgency_pressure === 'boolean'
    && Array.isArray(value.evidence) && value.evidence.length <= 3
    && value.evidence.every((quote) => typeof quote === 'string' && quote.length <= 160)
    && typeof value.confidence === 'number' && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
}

export function evaluate(args = {}) {
  const { mandate, proposal, catalogue, extractions, sanitizeFlags, captured, now } = isObject(args) ? args : {};
  const checks = [];
  const reasons = [];
  const add = (code, passed, source, severity = 'BLOCK', message = code) => {
    checks.push({ code, passed, source });
    if (!passed) reasons.push({ code, severity, source, message });
    return passed;
  };
  const block = (code, message) => add(code, false, 'deterministic', 'BLOCK', message);
  const review = (code, source, message) => add(code, false, source, 'REVIEW', message);
  const instant = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : NaN;
  const mandateOk = isObject(mandate) && isInt(mandate.version) && mandate.version >= 1 && typeof mandate.mandate_id === 'string'
    && (['mouse', 'keyboard', 'headset', 'monitor', 'webcam'].includes(mandate.item_category)
      || (mandate.item_category === null && (mandate.item_query === null || typeof mandate.item_query === 'string')))
    && mandate.currency === 'USD' && typeof mandate.status === 'string'
    && Array.isArray(mandate.allowed_merchant_ids) && mandate.allowed_merchant_ids.every((id) => typeof id === 'string')
    && isInt(mandate.max_unit_price_cents) && mandate.max_unit_price_cents >= 0
    && isInt(mandate.max_total_cents) && mandate.max_total_cents >= 0
    && isInt(mandate.quantity_max) && mandate.quantity_max >= 1
    && typeof mandate.allow_bundles === 'boolean'
    && typeof mandate.allow_addons === 'boolean';
  const proposalOk = isObject(proposal) && typeof proposal.proposal_id === 'string' && proposal.proposal_id.length > 0
    && Array.isArray(proposal.items) && proposal.items.length > 0;
  const capturedOk = Array.isArray(captured) && captured.every((entry) => isObject(entry)
    && typeof entry.mandate_id === 'string' && typeof entry.sku === 'string');
  if (!mandateOk || !proposalOk || !(catalogue instanceof Map) || !(extractions instanceof Map)
    || !(sanitizeFlags instanceof Map) || !capturedOk || !Number.isFinite(instant)) {
    block('INVALID_INPUT', 'Required policy input is missing or malformed');
    return { decision: 'BLOCK', reasons, checks };
  }

  add('MANDATE_INACTIVE', mandate.status === 'active', 'deterministic', 'BLOCK', 'Mandate must be active');
  add('MANDATE_EXPIRED', typeof mandate.expires_at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(mandate.expires_at)
    && Number.isFinite(Date.parse(mandate.expires_at)) && Date.parse(mandate.expires_at) > instant,
    'deterministic', 'BLOCK', 'Mandate has expired');
  add('MANDATE_STALE', proposal.mandate_id === mandate.mandate_id && proposal.mandate_version === mandate.version, 'deterministic', 'BLOCK', 'Proposal uses a stale mandate version');
  add('CURRENCY_MISMATCH', proposal.currency === mandate.currency, 'deterministic', 'BLOCK', 'Proposal currency differs from mandate');

  let computedTotal = 0;
  let totalValid = true;
  const resolved = [];
  const distinctSkus = new Set();
  const quantityBySku = new Map();
  for (const item of proposal.items) {
    if (!isObject(item) || typeof item.sku !== 'string' || !item.sku || typeof item.name !== 'string' || !item.name
      || !isInt(item.quantity) || item.quantity < 1 || !isInt(item.unit_price_cents) || item.unit_price_cents < 0) {
      block('INVALID_PROPOSAL', 'Proposal item is malformed');
      totalValid = false;
      continue;
    }
    const product = catalogue.get(item.sku);
    if (!product) {
      block('PRODUCT_UNKNOWN', 'Product is not in the trusted catalogue');
      resolved.push({ item, product: null });
      continue;
    }
    const validProduct = isObject(product) && product.product_id === item.sku
      && typeof product.merchant_id === 'string' && isInt(product.price_cents) && product.price_cents >= 0
      && typeof product.currency === 'string' && ['mouse', 'keyboard', 'headset', 'monitor', 'webcam', 'other', 'unclear'].includes(product.category)
      && (product.is_bundle === true || product.is_bundle === false || product.is_bundle === null);
    if (!validProduct) {
      block('PRODUCT_UNKNOWN', 'Trusted catalogue product is malformed');
      resolved.push({ item, product: null });
      continue;
    }
    resolved.push({ item, product });
    distinctSkus.add(item.sku);
    quantityBySku.set(item.sku, (quantityBySku.get(item.sku) ?? 0) + item.quantity);
    const line = item.unit_price_cents * item.quantity;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(computedTotal + line)) totalValid = false;
    else computedTotal += line;
    add('PRICE_TAMPERED', item.unit_price_cents === product.price_cents, 'deterministic', 'BLOCK', 'Item price differs from trusted catalogue');
    add('CURRENCY_MISMATCH', item.quantity > 0 && proposal.currency === product.currency, 'deterministic', 'BLOCK', 'Product currency differs from proposal');
    const merchantListOpen = ['profile', 'task'].includes(mandate.kind) && Array.isArray(mandate.allowed_merchant_ids) && mandate.allowed_merchant_ids.length === 0;
    add('MERCHANT_NOT_ALLOWED', !Array.isArray(mandate.allowed_merchant_ids) || merchantListOpen || mandate.allowed_merchant_ids.includes(product.merchant_id), 'deterministic', 'BLOCK', 'Merchant is not allowed by mandate');
    const domainAllowed = !Array.isArray(mandate.allowed_domains) || mandate.allowed_domains.length === 0
      || (typeof product.domain === 'string' && mandate.allowed_domains.some((allowed) =>
        typeof allowed === 'string'
        && (product.domain === allowed || product.domain.endsWith(`.${allowed}`))));
    add('DOMAIN_NOT_ALLOWED', domainAllowed, 'deterministic', 'BLOCK', 'Product domain is not allowed by mandate');
    if (mandate.require_first_party === true) add('FIRST_PARTY_REQUIRED', product.first_party === true, 'deterministic', 'BLOCK', 'Mandate requires a first-party listing');
    add('OVER_BUDGET', isInt(mandate.max_unit_price_cents) && item.unit_price_cents <= mandate.max_unit_price_cents, 'deterministic', 'BLOCK', 'Unit price exceeds mandate limit');
    add('QUANTITY_EXCEEDED', isInt(mandate.quantity_max) && item.quantity <= mandate.quantity_max, 'deterministic', 'BLOCK', 'Quantity exceeds mandate limit');
    add('BUNDLE_NOT_ALLOWED', product.is_bundle !== true || mandate.allow_bundles === true, 'deterministic', 'BLOCK', 'Bundles are not allowed');
    if (product.is_bundle === null && mandate.allow_bundles !== true) review('BUNDLE_UNKNOWN', 'deterministic', 'Bundle status is unknown');
    const duplicate = Array.isArray(captured) && captured.some((entry) => entry?.mandate_id === mandate.mandate_id && entry?.sku === item.sku);
    add('DUPLICATE', !duplicate, 'deterministic', 'BLOCK', 'This SKU was already captured under the mandate');

    const extraction = extractions.get(item.sku);
    const flags = sanitizeFlags.get(item.sku);
    if (!validFlags(flags)) block('INVALID_INPUT', 'Sanitizer flags are missing or malformed');
    if (isObject(flags) && Object.values(flags).some((flag) => flag === true)) review('HIDDEN_CONTENT', 'deterministic', 'Hidden or invisible listing content was detected');
    if (!validExtraction(extraction)) {
      review('EXTRACTOR_FAILED', 'ai', 'Listing extraction is missing or invalid');
      continue;
    }
    const confidence = extraction.confidence;
    if ((extraction.directives_to_agent || extraction.asserts_authority_override) && confidence >= 0.5) {
      review('INJECTION_DETECTED', 'ai', 'Listing contains instructions or authority claims targeting an agent');
      reasons[reasons.length - 1].severity = 'BLOCK';
    }
    if (extraction.claims_bundle && product.is_bundle === false && mandate.allow_bundles !== true) review('BUNDLE_TEXT_CONFLICT', 'ai', 'Listing text claims a bundle but the catalogue does not');
    if (extraction.claimed_price_cents !== null && extraction.claimed_price_cents !== product.price_cents) review('TEXT_PRICE_CONFLICT', 'ai', 'Listing text price differs from catalogue price');
    if (mandate.item_query !== null && extraction.category_label !== mandate.item_category) review('CATEGORY_MISMATCH', 'ai', 'Listing category differs from mandate category');
    if (extraction.urgency_pressure) review('URGENCY_PRESSURE', 'ai', 'Listing uses urgency pressure');
    if (confidence < 0.5) review('LOW_CONFIDENCE', 'ai', 'Listing extraction confidence is low');
  }

  for (const quantity of quantityBySku.values()) {
    add('QUANTITY_EXCEEDED', isInt(mandate.quantity_max) && quantity <= mandate.quantity_max, 'deterministic', 'BLOCK', 'Combined SKU quantity exceeds mandate limit');
  }

  if (distinctSkus.size > 1) block('ADDON_NOT_ALLOWED', 'Proposal contains more than one distinct SKU');
  if (resolved.some(({ product }) => product && product.category !== mandate.item_category) && mandate.allow_addons !== true) {
    block('ADDON_NOT_ALLOWED', 'Proposal includes a category outside the mandate');
  }
  add('OVER_BUDGET', totalValid && isInt(mandate.max_total_cents) && computedTotal <= mandate.max_total_cents, 'deterministic', 'BLOCK', 'Computed total exceeds mandate limit or is invalid');
  add('PRICE_TAMPERED', totalValid && isInt(proposal.total_cents) && proposal.total_cents === computedTotal, 'deterministic', 'BLOCK', 'Proposal total does not match its line items');

  const hasBlock = reasons.some((reason) => reason.severity === 'BLOCK');
  const hasReview = reasons.some((reason) => reason.severity === 'REVIEW');
  return { decision: hasBlock ? 'BLOCK' : hasReview ? 'REVIEW' : 'ALLOW', reasons, checks };
}
