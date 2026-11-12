import { getProducts } from '../catalogue/index.js';

const defaultDemoDomains = () => [...new Set(getProducts()
  .filter((product) => product.source === undefined || product.source === 'curated')
  .map((product) => {
    const slug = String(product.merchant_id ?? 'catalogue').toLowerCase().replace(/^m_/, '').replace(/[^a-z0-9-]/g, '') || 'catalogue';
    return String(product.domain ?? `${slug}.localhost`).toLowerCase();
  })
  .filter((domain) => domain.endsWith('.localhost')))];

export function getDemoStoreDomains(value = process.env.DEMO_STORE_DOMAINS) {
  const configured = typeof value === 'string' && value.trim()
    ? value.split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean)
    : defaultDemoDomains();
  return new Set(configured);
}

export function checkoutBoundary(observation, { demoDomains = getDemoStoreDomains() } = {}) {
  const domain = String(observation?.domain ?? '').toLowerCase();
  const source = observation?.source;
  const gateway = source === 'curated' && [...demoDomains].some((allowed) =>
    domain === allowed || domain.endsWith(`.${allowed}`));
  return gateway
    ? { checkout_mode: 'gateway', handoff_url: null }
    : { checkout_mode: 'handoff', handoff_url: observation?.url ?? null };
}

export function isGatewayProposal(proposal) {
  if (proposal?.sandbox_listing?.source === 'channel3'
    || (proposal?.sandbox_demo_payment === true && proposal?.evidence?.marketplace_snapshot?.source === 'channel3')) return false;
  if (proposal?.checkout_mode === 'gateway') return true;
  return checkoutBoundary(proposal?.sandbox_listing ?? proposal?.observation ?? {}, {
    demoDomains: getDemoStoreDomains(),
  }).checkout_mode === 'gateway';
}

export function checkoutBoundaryError(observation) {
  const domain = String(observation?.domain ?? 'this store');
  const error = new Error(`MandateGuard does not control this store's checkout. Open the product at ${domain}.`);
  error.status = 409;
  error.code = 'CHECKOUT_NOT_CONTROLLED';
  error.handoff_url = observation?.handoff_url ?? observation?.url ?? null;
  return error;
}
