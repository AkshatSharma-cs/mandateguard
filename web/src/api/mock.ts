import type { AuditEvent, AuditResult, Candidate, CaptureResult, Decision, EvaluateResult, Mandate, Product, ProductObservation, Profile, ProfileLimits, Proposal, RunResult, TestResults } from '../types';
import { ApiError } from './error';
import { evidenceQuotes, expectedDecisions, merchants, products, verificationLabels } from './fixtures';

const delay = () => new Promise<void>(resolve => window.setTimeout(resolve, 550));
let currentMandate: Mandate | null = null;
const demoDomains = ['acme.localhost', 'bytebarn.localhost', 'zenith.localhost'];
function seededProfile(): Profile {
  const now = new Date();
  return { mandate_id: 'profile_demo_default', kind: 'profile', parent_profile_id: null, is_default: true, confirmed_by: 'user', version: 1, status: 'active', original_instruction: 'Default demo preferences', item_query: null, category_terms: [], item_category: null, max_unit_price_cents: 10000, max_total_cents: 10000, quantity_max: 1, currency: 'USD', allowed_merchant_ids: [], allow_bundles: false, allow_addons: false, require_first_party: false, allowed_domains: demoDomains, expires_at: new Date(now.getTime() + 365 * 86400000).toISOString(), created_at: now.toISOString(), confirmed_at: now.toISOString() };
}
let profiles: Profile[] = [seededProfile()];
let nextEventId = 1;
let auditWrite = Promise.resolve();
const auditEvents: AuditEvent[] = [];
const proposalById = new Map<string, Proposal>();
const orderByProposal = new Map<string, string>();
const capturedProposalIds = new Set<string>();
let captureNumber = 1;
let mandateNumber = 1;
let proposalNumber = 1;
let runNumber = 1;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function appendAudit(event: Omit<AuditEvent, 'id' | 'hash'>) {
  const write = async () => {
    const previous = auditEvents.at(-1)?.hash ?? '';
    const row = { id: nextEventId++, ...event };
    const hash = await digest(previous + stable(row));
    auditEvents.push({ ...row, hash });
  };
  const pending = auditWrite.then(write);
  auditWrite = pending.then(() => undefined, () => undefined);
  await pending;
}
function requireMandate(): Mandate {
  if (!currentMandate) throw new ApiError('MANDATE_NOT_FOUND', 'Mandate not found.', 404);
  return currentMandate;
}
function merchantName(id: string) { return merchants.find(merchant => merchant.merchant_id === id)?.name ?? id; }
function reasonMessage(code: string, product: Product, mandate: Mandate): string {
  const messages: Record<string, string> = {
    OVER_BUDGET: `Total $${(product.price_cents / 100).toFixed(2)} is over your $${(mandate.max_total_cents / 100).toFixed(2)} limit.`,
    BUNDLE_NOT_ALLOWED: 'This is a bundle, and your mandate does not allow bundles.',
    BUNDLE_UNKNOWN: 'The seller does not say whether this is a bundle.',
    MERCHANT_NOT_ALLOWED: `${merchantName(product.merchant_id)} is not on your approved merchant list.`,
    INJECTION_DETECTED: 'The listing contains instructions aimed at AI agents. They were ignored.',
    TEXT_PRICE_CONFLICT: 'The price stated in the listing text differs from the catalogue price.',
    HIDDEN_CONTENT: 'The listing contains hidden text.',
    URGENCY_PRESSURE: 'The listing pressures the buyer to act immediately.',
  };
  return messages[code] ?? code;
}
function extractionFor(product: Product) {
  const quotes = evidenceQuotes[product.product_id] ?? [];
  const codes = expectedDecisions[product.product_id]?.reasons ?? [];
  const evidence = codes.some(code => ['INJECTION_DETECTED', 'TEXT_PRICE_CONFLICT', 'HIDDEN_CONTENT', 'URGENCY_PRESSURE'].includes(code)) ? quotes : [];
  return {
    category_label: product.category,
    claimed_price_cents: product.product_id === 'p_a3' ? 2499 : product.product_id === 'p_a3b' ? 7900 : null,
    claims_bundle: product.product_id === 'p_a1' || product.product_id === 'p_a7',
    addon_offers: product.product_id === 'p_a5' ? [{ name: 'Extended Warranty', price_cents: 999 }] : [],
    directives_to_agent: ['p_a1', 'p_a2', 'p_a4', 'p_a5', 'p_a6'].includes(product.product_id),
    asserts_authority_override: ['p_a1', 'p_a2', 'p_a4'].includes(product.product_id),
    urgency_pressure: product.product_id === 'p_a8',
    evidence,
    confidence: 0.99,
  };
}
function observationFor(product: Product): ProductObservation {
  const text = product.description;
  const domain = product.domain ?? 'acme.localhost';
  return {
    observation_id: product.product_id, url: product.url ?? `http://${domain}:3000/demo-store/${encodeURIComponent(product.product_id)}.html`,
    domain, source: 'curated', title: product.title, price_cents: product.price_cents,
    currency: product.currency, seller: merchantName(product.merchant_id), sold_by_merchant: true,
    availability: 'unknown', image_url: null, category_hint: product.category, bundle_signal: product.is_bundle,
    hidden_text_found: product.product_id === 'p_a6', text, captured_at: new Date().toISOString(), content_hash: '0'.repeat(64),
  };
}
function candidateFor(product: Product, mandate: Mandate): Candidate {
  const expected = expectedDecisions[product.product_id] ?? { decision: 'ALLOW' as const, reasons: [] };
  const extraction = extractionFor(product);
  const observation = observationFor(product);
  const domainAllowed = mandate.allowed_domains.some(domain => observation.domain === domain || observation.domain.endsWith(`.${domain}`));
  const codes = expected.reasons.filter(code => !['OVER_BUDGET', 'MERCHANT_NOT_ALLOWED', 'BUNDLE_NOT_ALLOWED'].includes(code));
  if (product.price_cents > mandate.max_unit_price_cents || product.price_cents > mandate.max_total_cents) codes.unshift('OVER_BUDGET');
  if (mandate.allowed_domains.length ? !domainAllowed : !mandate.allowed_merchant_ids.includes(product.merchant_id)) codes.push('MERCHANT_NOT_ALLOWED');
  if (product.is_bundle === true && !mandate.allow_bundles) codes.push('BUNDLE_NOT_ALLOWED');
  if (mandate.require_first_party && !observation.sold_by_merchant) codes.push('MERCHANT_NOT_ALLOWED');
  const uniqueCodes = [...new Set(codes)];
  const decision: Decision = uniqueCodes.some(code => !['BUNDLE_UNKNOWN', 'TEXT_PRICE_CONFLICT'].includes(code))
    ? 'BLOCK'
    : uniqueCodes.length ? 'REVIEW' : 'ALLOW';
  const reasons = uniqueCodes.map(code => ({
    code,
    severity: ['BUNDLE_UNKNOWN', 'TEXT_PRICE_CONFLICT'].includes(code) ? 'REVIEW' as const : 'BLOCK' as const,
    source: ['INJECTION_DETECTED', 'URGENCY_PRESSURE'].includes(code) ? 'ai' as const : 'deterministic' as const,
    message: reasonMessage(code, product, mandate),
  }));
  const checks = [
    { code: 'CATEGORY_MATCH', passed: true, source: 'deterministic' as const },
    { code: 'PRICE_WITHIN_LIMIT', passed: product.price_cents <= mandate.max_total_cents, source: 'deterministic' as const },
    { code: 'MERCHANT_ALLOWED', passed: mandate.allowed_domains.length ? domainAllowed : mandate.allowed_merchant_ids.includes(product.merchant_id), source: 'deterministic' as const },
    { code: 'LISTING_INSTRUCTIONS', passed: !extraction.directives_to_agent && !extraction.asserts_authority_override, source: 'ai' as const },
  ];
  return { product_id: product.product_id, decision, reasons, checks, extraction, observation };
}
function proposalFor(mandate: Mandate, product: Product, source: Proposal['source'], status: string, wouldHaveBeen: Decision = 'BLOCK'): Proposal {
  const proposal_id = product.product_id === 'p_a1' && source === 'naive' ? 'p_a1'
    : product.product_id === 'p_ok_1' && source === 'protected' ? 'p_ok_1'
      : `${product.product_id}_${source}_${proposalNumber++}`;
  return {
    proposal_id,
    mandate_id: mandate.mandate_id,
    mandate_version: mandate.version,
    merchant_id: product.merchant_id,
    currency: product.currency,
    items: [{ sku: product.product_id, name: product.title, quantity: 1, unit_price_cents: product.price_cents }],
    total_cents: product.price_cents,
    source,
    status,
    paypal_order_id: null,
    created_at: new Date().toISOString(),
    ...(source === 'naive' ? { would_have_been: wouldHaveBeen } : {}),
  };
}

export const mock = {
  async getProfiles() { await delay(); return { profiles: profiles.map(profile => ({ ...profile })) }; },
  async createProfile(payload: { limits: ProfileLimits } | { instruction: string }) {
    await delay();
    let limits: ProfileLimits;
    if ('limits' in payload) limits = payload.limits;
    else {
      const amount = payload.instruction.match(/\$\s*(\d+(?:\.\d{1,2})?)/)?.[1];
      if (!amount) throw new ApiError('INVALID_PROFILE', 'Include a maximum amount in the description.', 422);
      const [dollars, cents = ''] = amount.split('.');
      limits = {
        max_total: `${dollars}.${cents.padEnd(2, '0')}`,
        allow_bundles: /\ballow(?:ing)?\s+bundles?\b/i.test(payload.instruction),
        allow_addons: /\ballow(?:ing)?\s+(?:add-ons?|accessories|warranties)\b/i.test(payload.instruction),
        require_first_party: /\bfirst[ -]party\b/i.test(payload.instruction),
        allowed_domains: [...demoDomains],
      };
    }
    const cents = Math.round(Number(limits.max_total) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000) throw new ApiError('INVALID_PROFILE', 'The maximum amount must be between $0.01 and $1,000.00.', 422);
    const now = new Date();
    const profile: Profile = {
      mandate_id: `profile_demo_${String(mandateNumber++).padStart(3, '0')}`, kind: 'profile', parent_profile_id: null, is_default: false,
      confirmed_by: null, version: 1, status: 'pending_confirmation', original_instruction: 'limits' in payload ? '' : payload.instruction,
      item_query: null, category_terms: [], item_category: null, max_unit_price_cents: cents, max_total_cents: cents,
      quantity_max: 1, currency: 'USD', allowed_merchant_ids: [], allow_bundles: limits.allow_bundles,
      allow_addons: limits.allow_addons, require_first_party: limits.require_first_party, allowed_domains: limits.allowed_domains,
      expires_at: new Date(now.getTime() + 365 * 86400000).toISOString(), created_at: now.toISOString(), confirmed_at: null,
    };
    profiles.unshift(profile);
    await appendAudit({ ts: now.toISOString(), actor: 'user', event_type: 'PROFILE_PROPOSED', mandate_id: profile.mandate_id, proposal_id: null, payload: {} });
    return { profile };
  },
  async confirmProfile(id: string) {
    await delay();
    const profile = profiles.find(item => item.mandate_id === id);
    if (!profile || profile.status !== 'pending_confirmation') throw new ApiError('INVALID_PROFILE_STATE', 'Only a pending profile can be confirmed.', 409);
    const confirmed = { ...profile, status: 'active' as const, confirmed_at: new Date().toISOString(), confirmed_by: 'user' as const };
    profiles = profiles.map(item => item.mandate_id === id ? confirmed : item);
    await appendAudit({ ts: confirmed.confirmed_at!, actor: 'user', event_type: 'PROFILE_CONFIRMED', mandate_id: id, proposal_id: null, payload: {} });
    return { profile: confirmed };
  },
  async setDefaultProfile(id: string) {
    await delay();
    const selected = profiles.find(item => item.mandate_id === id);
    if (!selected || selected.status !== 'active') throw new ApiError('PROFILE_INACTIVE', 'Only an active profile can be the default.', 409);
    profiles = profiles.map(item => ({ ...item, is_default: item.mandate_id === id }));
    return { profile: profiles.find(item => item.mandate_id === id)! };
  },
  async createTask(instruction: string, profileId?: string) {
    await delay();
    const profile = profileId ? profiles.find(item => item.mandate_id === profileId) : profiles.find(item => item.is_default && item.status === 'active');
    if (profileId && !profile) throw new ApiError('PROFILE_NOT_FOUND', 'Profile not found.', 404);
    if (profile && profile.status !== 'active') throw new ApiError('PROFILE_INACTIVE', 'Choose a confirmed profile.', 409);
    const normalized = instruction.toLowerCase();
    const category = [['mouse', /\b(mouse|mice)\b/], ['keyboard', /\b(keyboard|keyboards|keypad)\b/], ['headset', /\b(headset|headphones?)\b/], ['monitor', /\b(monitor|display)\b/], ['webcam', /\b(webcam|camera)\b/], ['storage', /\b(storage|ssd|drive)\b/]] as const;
    const categoryTerms = category.filter(([, pattern]) => pattern.test(normalized)).map(([value]) => value);
    const amount = normalized.match(/\$\s*(\d+(?:\.\d{1,2})?)/)?.[1];
    const dollars = amount ? amount.split('.')[0] : '';
    const decimals = amount?.split('.')[1] ?? '';
    const requested = amount ? Math.round(Number(`${dollars}.${decimals.padEnd(2, '0')}`) * 100) : null;
    if (!profile && (requested === null || requested < 1)) throw new ApiError('NO_PREFERENCES', 'Set preferences or include a maximum amount.', 409);
    const total = requested ?? profile!.max_total_cents;
    const allowBundles = /\ballow(?:ing)?\s+bundles?\b/i.test(instruction) ? true : /\bno\s+bundles?\b/i.test(instruction) ? false : profile?.allow_bundles ?? false;
    const allowAddons = /\ballow(?:ing)?\s+(?:add-ons?|accessories|warranties)\b/i.test(instruction) ? true : /\bno\s+(?:add-ons?|accessories|warranties)\b/i.test(instruction) ? false : profile?.allow_addons ?? false;
    const requestedDomains = [...instruction.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/gi)].map(([domain]) => domain.toLowerCase());
    const domains = requestedDomains.length ? requestedDomains : profile?.allowed_domains ?? [];
    const exceeded: string[] = [];
    if (profile) {
      if (total > profile.max_total_cents) exceeded.push('max_total');
      if (allowBundles && !profile.allow_bundles) exceeded.push('allow_bundles');
      if (allowAddons && !profile.allow_addons) exceeded.push('allow_addons');
      if (profile.require_first_party && /third[ -]party/.test(normalized)) exceeded.push('require_first_party');
      if (requestedDomains.some(domain => !profile.allowed_domains.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`)))) exceeded.push('allowed_domains');
    }
    const now = new Date();
    const mandate: Mandate = {
      mandate_id: `mandate_demo_${String(mandateNumber++).padStart(3, '0')}`, kind: 'task', parent_profile_id: profile?.mandate_id ?? null,
      is_default: false, confirmed_by: profile && !exceeded.length ? `profile:${profile.mandate_id}` : null,
      version: 1, status: profile && !exceeded.length ? 'active' : 'pending_confirmation', original_instruction: instruction,
      item_query: instruction.trim() || null, category_terms: categoryTerms, item_category: categoryTerms[0] ?? null,
      max_unit_price_cents: total, max_total_cents: total, quantity_max: 1, currency: 'USD',
      allowed_merchant_ids: [], allow_bundles: allowBundles, allow_addons: allowAddons,
      require_first_party: profile?.require_first_party ?? false, allowed_domains: domains,
      expires_at: new Date(now.getTime() + 86400000).toISOString(), created_at: now.toISOString(), confirmed_at: profile && !exceeded.length ? now.toISOString() : null,
    };
    currentMandate = mandate;
    await appendAudit({ ts: now.toISOString(), actor: 'user', event_type: mandate.status === 'active' ? 'MANDATE_AUTO_ACTIVATED' : 'MANDATE_PROPOSED', mandate_id: mandate.mandate_id, proposal_id: null, payload: { exceeded } });
    return { mandate, notes: exceeded.map(item => `Requested ${item} exceeds the confirmed profile; user confirmation is required.`), within_profile: profile ? !exceeded.length : null, exceeded };
  },
  async parseMandate(instruction: string) {
    await delay();
    const normalized = instruction.toLowerCase();
    const categories = [
      ['mouse', /\b(mouse|mice)\b/], ['keyboard', /\b(keyboard|keyboards|keypad)\b/],
      ['headset', /\b(headset|headsets|headphone|headphones)\b/], ['monitor', /\b(monitor|monitors|display)\b/],
      ['webcam', /\b(webcam|webcams|camera)\b/],
    ] as const;
    const itemCategory = categories.find(([, pattern]) => pattern.test(normalized))?.[0];
    const priceMatch = normalized.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (!itemCategory || !priceMatch) throw new ApiError('INVALID_INSTRUCTION', 'Name a product category and a maximum price, such as “keyboard under $50.”', 422);
    const maxTotalCents = Math.round(Number(priceMatch[1]) * 100);
    if (!Number.isSafeInteger(maxTotalCents) || maxTotalCents < 1 || maxTotalCents > 100000) throw new ApiError('INVALID_INSTRUCTION', 'The maximum price must be between $0.01 and $1,000.00.', 422);
    currentMandate = {
      mandate_id: `mandate_demo_${String(mandateNumber++).padStart(3, '0')}`, kind: 'task', parent_profile_id: null,
      is_default: false, confirmed_by: null, version: 1, status: 'pending_confirmation', original_instruction: instruction,
      item_query: instruction, category_terms: [itemCategory], item_category: itemCategory,
      max_unit_price_cents: maxTotalCents, max_total_cents: maxTotalCents, quantity_max: 1,
      currency: 'USD', allowed_merchant_ids: merchants.filter(merchant => merchant.approved_default).map(merchant => merchant.merchant_id),
      allow_bundles: /\b(allow|include|accept)\b.{0,24}\bbundles?\b/i.test(instruction),
      allow_addons: /\b(allow|include|accept)\b.{0,24}\b(add-ons?|accessories)\b/i.test(instruction),
      require_first_party: false, allowed_domains: [],
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString(), confirmed_at: null,
    };
    await appendAudit({ ts: new Date().toISOString(), actor: 'user', event_type: 'MANDATE_PARSED', mandate_id: currentMandate.mandate_id, proposal_id: null, payload: { status: currentMandate.status } });
    return { mandate: currentMandate, notes: [] as string[] };
  },
  async confirmMandate(mandateId: string) {
    await delay();
    const mandate = requireMandate();
    if (mandate.mandate_id !== mandateId || mandate.status !== 'pending_confirmation') throw new ApiError('MANDATE_NOT_CONFIRMABLE', 'Only a pending mandate can be confirmed.', 409);
    currentMandate = { ...mandate, status: 'active', confirmed_at: new Date().toISOString(), confirmed_by: 'user' };
    await appendAudit({ ts: new Date().toISOString(), actor: 'user', event_type: 'MANDATE_CONFIRMED', mandate_id: mandateId, proposal_id: null, payload: { version: mandate.version } });
    return currentMandate;
  },
  async revokeMandate(mandateId: string) {
    await delay();
    const mandate = requireMandate();
    if (mandate.mandate_id !== mandateId) throw new ApiError('MANDATE_NOT_FOUND', 'Mandate not found.', 404);
    currentMandate = { ...mandate, status: 'revoked' };
    await appendAudit({ ts: new Date().toISOString(), actor: 'user', event_type: 'MANDATE_REVOKED', mandate_id: mandateId, proposal_id: null, payload: { version: mandate.version } });
    return currentMandate;
  },
  async getCatalogue() { await delay(); return { merchants, products }; },
  async evaluate(observation: ProductObservation, options: { mandate_id?: string; profile_id?: string; alternatives?: boolean } = {}): Promise<EvaluateResult> {
    await delay();
    const mandate = options.mandate_id
      ? currentMandate?.mandate_id === options.mandate_id ? currentMandate : profiles.find(item => item.mandate_id === options.mandate_id)
      : options.profile_id ? profiles.find(item => item.mandate_id === options.profile_id) : profiles.find(item => item.is_default && item.status === 'active');
    if (!mandate || mandate.status !== 'active') throw new ApiError('NO_PREFERENCES', 'Confirm a profile or provide an active mandate before evaluation.', 409);
    const withinLimit = observation.price_cents <= mandate.max_total_cents;
    const trusted = mandate.allowed_domains.some(domain => observation.domain === domain || observation.domain.endsWith(`.${domain}`));
    const allowed = withinLimit && trusted && (!mandate.require_first_party || observation.sold_by_merchant);
    const reasons = allowed ? [] : [{ code: !withinLimit ? 'OVER_BUDGET' : !trusted ? 'MERCHANT_NOT_ALLOWED' : 'FIRST_PARTY_REQUIRED', severity: 'BLOCK' as const, source: 'deterministic' as const, message: !withinLimit ? 'The displayed price exceeds the mandate limit.' : !trusted ? 'This website is not in your trusted domains.' : 'The item is not sold by the merchant itself.' }];
    const now = new Date();
    const alternatives = allowed || options.alternatives === false ? [] : products.filter(product => product.product_id !== observation.observation_id && product.title.toLowerCase() !== observation.title.toLowerCase() && (!observation.category_hint || product.category === observation.category_hint) && product.price_cents <= mandate.max_total_cents && mandate.allowed_domains.some(domain => { const alternative = observationFor(product); return alternative.domain === domain || alternative.domain.endsWith(`.${domain}`); }) && observationFor(product).domain !== observation.domain).slice(0, 3).map(product => {
      const evaluation_id = `evaluation_${runNumber++}`;
      const proposal = proposalFor(mandate, product, 'protected', 'ALLOWED', 'ALLOW');
      proposal.proposal_id = evaluation_id;
      proposalById.set(evaluation_id, proposal);
      return { evaluation_id, observation: observationFor(product), decision: 'ALLOW' as const, reasons: [] };
    });
    return { evaluation_id: `evaluation_${runNumber++}`, decision: allowed ? 'ALLOW' : 'BLOCK', reasons,
      checks: [{ code: 'PRICE_WITHIN_LIMIT', passed: withinLimit, source: 'deterministic' }], observation,
      expires_at: new Date(now.getTime() + 900000).toISOString(), alternatives };
  },
  async useAlternative(evaluationId: string) {
    await delay();
    const proposal = proposalById.get(evaluationId);
    if (!proposal || proposal.status !== 'ALLOWED') throw new ApiError('ALTERNATIVE_NOT_AVAILABLE', 'This allowed alternative is no longer available.', 404);
    return { proposal };
  },
  async runAgent(mandateId: string, mode: 'naive' | 'protected'): Promise<RunResult> {
    await delay();
    const mandate = currentMandate?.mandate_id === mandateId ? currentMandate : profiles.find(item => item.mandate_id === mandateId) ?? null;
    if (!mandate) throw new ApiError('MANDATE_NOT_FOUND', 'Mandate not found.', 404);
    if (mandate.mandate_id !== mandateId || mandate.status !== 'active') throw new ApiError('MANDATE_INACTIVE', 'The mandate is not active.', 409);
    await appendAudit({ ts: new Date().toISOString(), actor: 'agent', event_type: 'AGENT_RUN_STARTED', mandate_id: mandateId, proposal_id: null, payload: { mode } });
    const categoryProducts = products.filter(product => mandate.item_category == null
      ? !mandate.category_terms.length || mandate.category_terms.includes(product.category)
      : product.category === mandate.item_category);
    const candidates = categoryProducts.map(product => {
      const candidate = candidateFor(product, mandate);
      if (candidate.decision === 'ALLOW') {
        candidate.evaluation_id = `evaluation_${mandate.mandate_id}_${product.product_id}_${runNumber++}`;
        const allowedProposal = proposalFor(mandate, product, 'protected', 'ALLOWED', 'ALLOW');
        allowedProposal.proposal_id = candidate.evaluation_id;
        proposalById.set(candidate.evaluation_id, allowedProposal);
      }
      return candidate;
    });
    if (mode === 'protected') {
      const allowedProducts = categoryProducts.filter(product => candidates.find(candidate => candidate.product_id === product.product_id)?.decision === 'ALLOW');
      for (const candidate of candidates.filter(item => item.decision !== 'ALLOW')) {
        const alternatives = allowedProducts.filter(product => product.category === candidate.observation.category_hint && product.title.toLowerCase() !== candidate.observation.title.toLowerCase() && observationFor(product).domain !== candidate.observation.domain).slice(0, 3);
        candidate.alternatives = alternatives.map(product => {
          const evaluation_id = `evaluation_${mandate.mandate_id}_${product.product_id}_${runNumber}`;
          const proposal = proposalFor(mandate, product, 'protected', 'ALLOWED', 'ALLOW');
          proposal.proposal_id = evaluation_id;
          proposalById.set(evaluation_id, proposal);
          return { evaluation_id, observation: observationFor(product), decision: 'ALLOW', reasons: [] };
        });
      }
    }
    for (const candidate of candidates) {
      const product = products.find(item => item.product_id === candidate.product_id)!;
      await appendAudit({ ts: new Date().toISOString(), actor: 'agent', event_type: 'LISTING_SANITIZED', mandate_id: mandateId, proposal_id: null, payload: { product_id: product.product_id, title: product.title } });
      await appendAudit({ ts: new Date().toISOString(), actor: 'agent', event_type: 'EXTRACTION_DONE', mandate_id: mandateId, proposal_id: null, payload: { product_id: product.product_id, evidence_count: candidate.extraction?.evidence.length ?? 0 } });
      await appendAudit({ ts: new Date().toISOString(), actor: 'agent', event_type: 'POLICY_DECISION', mandate_id: mandateId, proposal_id: null, payload: { product_id: product.product_id, decision: candidate.decision, reasons: candidate.reasons.map(reason => reason.code) } });
    }
    const allowedCandidates = candidates.filter(candidate => candidate.decision === 'ALLOW')
      .sort((left, right) => products.find(item => item.product_id === left.product_id)!.price_cents - products.find(item => item.product_id === right.product_id)!.price_cents);
    const selectedCandidate = mode === 'naive'
      ? candidates.find(candidate => candidate.product_id === 'p_a1') ?? candidates[0]
      : allowedCandidates[0];
    const selected = selectedCandidate && categoryProducts.find(product => product.product_id === selectedCandidate.product_id);
    const proposal = selected ? proposalFor(mandate, selected, mode, mode === 'naive' ? 'DRAFT' : 'ALLOWED', selectedCandidate?.decision ?? 'BLOCK') : null;
    if (proposal) {
      proposalById.set(proposal.proposal_id, proposal);
      await appendAudit({ ts: new Date().toISOString(), actor: 'agent', event_type: 'PROPOSAL_CREATED', mandate_id: mandateId, proposal_id: proposal.proposal_id, payload: { source: mode, total_cents: proposal.total_cents } });
    }
    return {
      run_id: `run_${mode}_demo_${String(runNumber++).padStart(3, '0')}`, mode, enforced: mode === 'protected', candidates,
      proposal, naive_reasoning: mode === 'naive' && proposal ? (proposal.would_have_been === 'BLOCK' ? "The seller's listing suggested a purchase that does not meet the mandate." : 'The selected listing fits the displayed mandate limits.') : null,
      ...(mode === 'naive' ? { would_have_been: proposal?.would_have_been ?? 'BLOCK' as Decision } : {}),
      ...(mode === 'protected' ? { allowed_alternative_ids: candidates.filter(candidate => candidate.decision === 'ALLOW' && candidate.evaluation_id).map(candidate => candidate.evaluation_id!) } : {}),
    };
  },
  async createCheckout(proposalId: string) {
    await delay();
    const proposal = proposalById.get(proposalId);
    if (!proposal || proposal.source === 'naive' || proposal.status !== 'ALLOWED') throw new ApiError('PROPOSAL_NOT_CHECKOUTABLE', 'This proposal cannot be checked out.', 409);
    const orderId = `MOCK-ORDER-${String(orderByProposal.size + 1).padStart(3, '0')}`;
    orderByProposal.set(proposalId, orderId);
    await appendAudit({ ts: new Date().toISOString(), actor: 'system', event_type: 'ORDER_CREATED', mandate_id: proposal.mandate_id, proposal_id: proposalId, payload: { paypal_order_id: orderId } });
    return { paypal_order_id: orderId };
  },
  async capture(proposalId: string, orderId: string): Promise<CaptureResult> {
    await delay();
    const proposal = proposalById.get(proposalId);
    const expectedOrder = orderByProposal.get(proposalId);
    if (!proposal || proposal.source !== 'protected' || !expectedOrder || expectedOrder !== orderId) throw new ApiError('ORDER_MISMATCH', 'The order does not match the proposal.', 409);
    const passed = !capturedProposalIds.has(proposalId);
    const checks = Object.entries(verificationLabels).map(([id, detail]) => ({ id, passed, detail }));
    const capture = passed ? { id: `MOCK-CAP-${String(captureNumber++).padStart(3, '0')}`, amount: (proposal.total_cents / 100).toFixed(2) } : null;
    await appendAudit({ ts: new Date().toISOString(), actor: 'system', event_type: 'VERIFICATION_RESULT', mandate_id: proposal.mandate_id, proposal_id: proposalId, payload: { passed_checks: checks.filter(check => check.passed).length, total_checks: checks.length } });
    if (passed && capture) {
      capturedProposalIds.add(proposalId);
      await appendAudit({ ts: new Date().toISOString(), actor: 'system', event_type: 'PAYMENT_CAPTURED', mandate_id: proposal.mandate_id, proposal_id: proposalId, payload: { capture_id: capture.id, amount: capture.amount } });
    }
    return { status: passed ? 'CAPTURED' : 'REFUSED', checks, capture };
  },
  async getAudit(filters: { proposal_id?: string; mandate_id?: string } = {}): Promise<AuditResult> {
    await delay();
    await auditWrite;
    const events = auditEvents.filter(event => (!filters.proposal_id || event.proposal_id === filters.proposal_id) && (!filters.mandate_id || event.mandate_id === filters.mandate_id));
    return { events, chain_ok: await this.verifyChain() };
  },
  async verifyChain() {
    let previous = '';
    for (const event of auditEvents) {
      const { hash, ...row } = event;
      if (await digest(previous + stable(row)) !== hash) return false;
      previous = hash;
    }
    return true;
  },
  async getPublicConfig() { await delay(); return { paypal_client_id: '', currency: 'USD' }; },
  async getTestResults(): Promise<TestResults> {
    await delay();
    throw new ApiError('RESULTS_NOT_FOUND', 'No results yet. Run npm run attacks, then reload.', 404);
  },
  async resetMock() { await auditWrite; currentMandate = null; profiles = [seededProfile()]; auditEvents.splice(0); proposalById.clear(); orderByProposal.clear(); capturedProposalIds.clear(); nextEventId = 1; captureNumber = 1; mandateNumber = 1; proposalNumber = 1; runNumber = 1; },
};
