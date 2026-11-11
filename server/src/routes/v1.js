// server/src/routes/v1.js
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asyncHandler } from './mandates.js';
import { db as defaultDb, getMandate as defaultGetMandate, getProposal as defaultGetProposal, getEvaluation as defaultGetEvaluation,
  listMandates as defaultListMandates, listCapturedSkus as defaultListCapturedSkus, saveMandate as defaultSaveMandate,
  saveProposal as defaultSaveProposal, saveEvaluation as defaultSaveEvaluation } from '../db.js';
import { append as defaultAppend } from '../audit.js';
import { getProducts as defaultGetProducts, searchProducts as defaultSearchProducts } from '../catalogue/index.js';
import { extractListing as defaultExtractListing } from '../llm/extractor.js';
import { evaluate as defaultEvaluate } from '../policy/engine.js';
import { buildUnprofiledTask, parseTaskInstruction, profileLimitsSchema } from '../mandates/v3.js';
import { createProfileService as makeProfileService, ProfileError } from '../mandate/profiles.js';
import { crossCheckInstructionAmount } from '../llm/mandateParser.js';

export function createV1Router(overrides = {}) {
const router = Router();
const database = overrides.database ?? defaultDb;
const getMandate = overrides.getMandate ?? ((id) => defaultGetMandate(id, database));
const getProposal = overrides.getProposal ?? ((id) => defaultGetProposal(id, database));
const getEvaluation = overrides.getEvaluation ?? ((id) => defaultGetEvaluation(id, database));
const listMandates = overrides.listMandates ?? ((options) => defaultListMandates(options, database));
const listCapturedSkus = overrides.listCapturedSkus ?? ((id) => defaultListCapturedSkus(id, database));
const saveMandate = overrides.saveMandate ?? ((mandate) => defaultSaveMandate(mandate, database));
const saveProposal = overrides.saveProposal ?? ((proposal) => defaultSaveProposal(proposal, database));
const saveEvaluation = overrides.saveEvaluation ?? ((evaluation) => defaultSaveEvaluation(evaluation, database));
const append = overrides.append ?? defaultAppend;
const getProducts = overrides.getProducts ?? defaultGetProducts;
const searchProducts = overrides.searchProducts ?? defaultSearchProducts;
const extractListing = overrides.extractListing ?? defaultExtractListing;
const evaluate = overrides.evaluate ?? defaultEvaluate;
const profileService = overrides.profileService ?? makeProfileService({ database, append, getMandate, listMandates, saveMandate });
const idSchema = z.object({ id: z.string().min(1).max(128) }).strict();
const emptySchema = z.object({}).strict();
const profileBodySchema = z.object({
  limits: profileLimitsSchema.optional(),
  instruction: z.string().trim().min(1).max(10000).optional(),
}).strict().refine((value) => Number(Boolean(value.limits)) + Number(Boolean(value.instruction)) === 1);
const taskBodySchema = z.object({ instruction: z.string().trim().max(10000).optional().default(''), profile_id: z.string().min(1).max(128).optional() }).strict();
const productObservationSchema = z.object({
  observation_id: z.string().min(1).max(128),
  url: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:'),
  domain: z.string().min(1).max(253),
  source: z.enum(['curated', 'channel3', 'page']),
  title: z.string().trim().min(1).max(500),
  price_cents: z.number().int().nonnegative().max(100000000),
  currency: z.string().length(3),
  seller: z.string().trim().min(1).max(256),
  sold_by_merchant: z.boolean(),
  availability: z.string().trim().min(1).max(80),
  image_url: z.string().url().max(2048).nullable(),
  category_hint: z.string().max(100).nullable(),
  bundle_signal: z.boolean().nullable(),
  hidden_text_found: z.boolean(),
  text: z.string().max(4000),
  captured_at: z.string().datetime(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/i),
}).strict().refine((observation) => new URL(observation.url).hostname.toLowerCase() === observation.domain.toLowerCase());
const evaluationBodySchema = z.object({
  mandate_id: z.string().min(1).max(128).optional(),
  profile_id: z.string().min(1).max(128).optional(),
  observation: productObservationSchema,
  alternatives: z.boolean().default(true),
}).strict();

function fail(status, code, message) {
  const error = new Error(message); error.status = status; error.code = code; throw error;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function domainMatches(domain, allowed) { return domain === allowed || domain.endsWith(`.${allowed}`); }
function getDefaultProfile() {
  const now = Date.now();
  return listMandates({ status: 'active' }).find((item) => item.kind === 'profile' && item.is_default
    && Number.isFinite(Date.parse(item.expires_at)) && Date.parse(item.expires_at) > now) ?? null;
}
function getProfile(id) {
  const profile = getMandate(id);
  return profile?.kind === 'profile' && profile.owner_id === 'local-user' ? profile : null;
}
function getActiveMandate(id) {
  const mandate = getMandate(id);
  const expiry = Date.parse(mandate?.expires_at);
  if (!mandate || mandate.status !== 'active' || !Number.isFinite(expiry) || expiry <= Date.now()) return null;
  return mandate;
}

router.post('/profiles', asyncHandler(async (req, res) => {
  const parsed = profileBodySchema.safeParse(req.body);
  if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'Provide either profile limits or an instruction.');
  let profile;
  try {
    profile = await profileService.createProfile(parsed.data.limits
      ? { limits: parsed.data.limits }
      : { instruction: parsed.data.instruction }, { now: new Date(), owner_id: 'local-user' });
  } catch (cause) { return fail(cause?.status ?? (cause?.code === 'PARSE_ERROR' ? 422 : 503), cause?.code ?? 'INVALID_PROFILE', cause?.message ?? 'Profile limits could not be parsed.'); }
  return res.status(201).json({ profile });
}));

router.post('/profiles/:id/confirm', asyncHandler(async (req, res) => {
  const params = idSchema.safeParse(req.params);
  if (!params.success || !emptySchema.safeParse(req.body ?? {}).success) return fail(400, 'VALIDATION_ERROR', 'Invalid profile confirmation request.');
  try { return res.json({ profile: profileService.confirmProfile(params.data.id, { owner_id: 'local-user' }) }); }
  catch (error) { if (error instanceof ProfileError) return fail(error.status, error.code, error.message); throw error; }
}));

router.get('/profiles', asyncHandler(async (req, res) => {
  if (!emptySchema.safeParse(req.query).success) return fail(400, 'VALIDATION_ERROR', 'Invalid profile query.');
  return res.json({ profiles: profileService.listProfiles({ owner_id: 'local-user' }) });
}));

router.post('/profiles/:id/default', asyncHandler(async (req, res) => {
  const params = idSchema.safeParse(req.params);
  if (!params.success || !emptySchema.safeParse(req.body ?? {}).success) return fail(400, 'VALIDATION_ERROR', 'Invalid default profile request.');
  try { return res.json({ profile: profileService.setDefault(params.data.id, { owner_id: 'local-user' }) }); }
  catch (error) { if (error instanceof ProfileError) return fail(error.status, error.code, error.message); throw error; }
}));

router.post('/mandates', asyncHandler(async (req, res) => {
  const parsed = taskBodySchema.safeParse(req.body);
  if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'Provide an instruction and an optional active profile id.');
  let profile = parsed.data.profile_id ? getProfile(parsed.data.profile_id) : getDefaultProfile();
  if (parsed.data.profile_id && !profile) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found.' } });
  if (profile && (profile.status !== 'active' || !Number.isFinite(Date.parse(profile.expires_at)) || Date.parse(profile.expires_at) <= Date.now())) {
    return res.status(409).json({ error: { code: 'PROFILE_INACTIVE', message: 'Choose a confirmed, unexpired profile.' } });
  }
  let modelParsed;
  let parseNotes = [];
  let parsedFrom = null;
  let amountMismatch = false;
  try {
    modelParsed = parsed.data.instruction ? await parseTaskInstruction(parsed.data.instruction) : {
      item_query: null, category_terms: [], max_total: null, allow_bundles: null,
      allow_addons: null, require_first_party: null, allowed_domains: null,
    };
    if (parsed.data.instruction) {
      const checked = crossCheckInstructionAmount(parsed.data.instruction,
        { max_total: modelParsed.max_total ?? '0.00' },
        { profile_max_total_cents: profile?.max_total_cents });
      parseNotes = checked.notes;
      parsedFrom = checked.parsed_from;
      amountMismatch = checked.mismatch;
      modelParsed = { ...modelParsed, max_total: checked.parsed.max_total };
    }
  }
  catch (cause) {
    if (cause?.code === 'PARSE_ERROR') return fail(422, 'PARSE_FAILED', cause.message);
    return fail(503, 'LLM_UNAVAILABLE', 'The mandate parser is unavailable. Check the LLM model and API key settings, then retry.');
  }
  let mandate;
  let notes = [];
  let exceeded = [];
  try {
    if (profile) {
      const derived = profileService.createDerivedTaskMandate(profile, modelParsed, { now: new Date(), owner_id: 'local-user', instruction: parsed.data.instruction, force_confirmation: amountMismatch });
      mandate = derived.mandate;
      exceeded = derived.exceeded;
      notes = derived.notes;
      if (parsedFrom) { mandate.parsed_from = parsedFrom; saveMandate(mandate); }
      notes = [...parseNotes, ...notes];
    } else {
      mandate = buildUnprofiledTask(modelParsed, { now: new Date(), owner_id: 'local-user', instruction: parsed.data.instruction });
      saveMandate(mandate);
      append({ actor: 'user', event_type: 'MANDATE_PROPOSED', mandate_id: mandate.mandate_id, payload: { parent_profile_id: null, exceeded: [] } });
    }
  } catch (cause) { return fail(422, 'INVALID_INSTRUCTION', cause.message); }
  if (!profile && parseNotes.length) notes = parseNotes;
  if (!profile && parsedFrom) { mandate.parsed_from = parsedFrom; saveMandate(mandate); }
  return res.status(201).json({ mandate, notes, parsed_from: parsedFrom, within_profile: profile ? exceeded.length === 0 && !amountMismatch : null, exceeded });
}));

router.post('/mandates/:id/confirm', asyncHandler(async (req, res) => {
  const params = idSchema.safeParse(req.params);
  if (!params.success || !emptySchema.safeParse(req.body ?? {}).success) return fail(400, 'VALIDATION_ERROR', 'Invalid mandate confirmation request.');
  const mandate = getMandate(params.data.id);
  if (!mandate || mandate.kind !== 'task') return res.status(404).json({ error: { code: 'MANDATE_NOT_FOUND', message: 'Task mandate not found.' } });
  if (mandate.status !== 'pending_confirmation') return res.status(409).json({ error: { code: 'INVALID_MANDATE_STATE', message: 'Only a pending task mandate can be confirmed.' } });
  const confirmed_at = new Date().toISOString();
  const active = { ...mandate, status: 'active', confirmed_at, confirmed_by: 'user' };
  saveMandate(active);
  append({ actor: 'user', event_type: 'MANDATE_CONFIRMED', mandate_id: active.mandate_id,
    payload: { parent_profile_id: active.parent_profile_id, confirmed_by: 'user' } });
  return res.json({ mandate: active });
}));

function makeObservation(input, mandate, extraction, extractionFlags, sourceProduct = null) {
  const domain = new URL(input.url).hostname.toLowerCase();
  const product_id = sourceProduct?.product_id ?? input.observation_id;
  const trustedSource = sourceProduct ? (sourceProduct.source ?? 'curated') : 'page';
  const observation = {
    ...input, domain, source: trustedSource,
    sold_by_merchant: sourceProduct ? sourceProduct.first_party === true : false,
    hidden_text_found: input.hidden_text_found || Object.values(extractionFlags ?? {}).some(Boolean),
  };
  const category = extraction?.category_label ?? input.category_hint ?? mandate.item_category ?? 'unclear';
  const product = {
    product_id, merchant_id: sourceProduct?.merchant_id ?? `external:${domain}`,
    price_cents: input.price_cents, currency: input.currency,
    category, is_bundle: input.bundle_signal ?? null, domain: sourceProduct?.domain ?? domain,
    first_party: sourceProduct?.first_party === true,
  };
  return { product_id, product, observation };
}

async function evaluateObservation(mandate, input, evaluation_id = randomUUID(), sourceProduct = null, deadline = Number.POSITIVE_INFINITY, extractionCache = new Map(), deferProposal = false) {
  let extractionPromise = extractionCache.get(input.content_hash);
  if (!extractionPromise) {
    extractionPromise = Promise.resolve().then(() => extractListing({ title: input.title, description: input.text }));
    extractionCache.set(input.content_hash, extractionPromise);
  }
  const extractionResult = await extractionPromise;
  const extraction = extractionResult.ok ? extractionResult.extraction : null;
  const { product_id, product, observation } = makeObservation(input, mandate, extraction, extractionResult.flags, sourceProduct);
  const proposal = {
    proposal_id: evaluation_id, mandate_id: mandate.mandate_id, mandate_version: mandate.version,
    merchant_id: product.merchant_id, currency: product.currency,
    items: [{ sku: product_id, name: product_id, quantity: 1, unit_price_cents: product.price_cents }],
    total_cents: product.price_cents, source: 'protected', status: 'DRAFT', paypal_order_id: null, created_at: new Date().toISOString(),
  };
  const decision = evaluate({
    // A standing profile has no task category. Give the single-item policy check its observed category so the legacy add-on guard does not interpret a profile as a missing category mandate.
    mandate: mandate.item_query === null && mandate.item_category === null ? { ...mandate, item_category: product.category } : mandate,
    proposal, catalogue: new Map([[product_id, product]]),
    extractions: new Map([[product_id, extraction]]),
    sanitizeFlags: new Map([[product_id, extractionResult.flags ?? { zero_width: false, html_comment: false, hidden_style: false }]]),
    captured: listCapturedSkus(mandate.mandate_id).map((sku) => ({ mandate_id: mandate.mandate_id, sku })), now: new Date(),
  });
  const persist = decision.decision === 'ALLOW' && sourceProduct && Date.now() <= deadline;
  let evaluation = null;
  if (persist) {
    const fullProduct = sourceProduct;
    proposal.status = 'ALLOWED';
    proposal.evidence = {
      extractions: { [product_id]: extraction },
      sanitize_flags: { [product_id]: extractionResult.flags },
      catalogue_hash: createHash('sha256').update(canonical([fullProduct])).digest('hex'),
      decision, evaluated_at: proposal.created_at,
    };
    evaluation = { evaluation_id, mandate_id: mandate.mandate_id, mandate_version: mandate.version,
      decision: decision.decision, observation, proposal, created_at: proposal.created_at,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
    saveEvaluation(evaluation);
    if (!deferProposal) saveProposal(proposal);
  }
  return { evaluation_id, decision: decision.decision, reasons: decision.reasons, checks: decision.checks,
    observation, proposal: persist && !deferProposal ? proposal : null, extraction, evaluation };
}

router.post('/evaluate', asyncHandler(async (req, res) => {
  const parsed = evaluationBodySchema.safeParse(req.body);
  if (!parsed.success || (parsed.data?.mandate_id && parsed.data?.profile_id)) return fail(400, 'VALIDATION_ERROR', 'Provide one mandate or profile id and a valid observation.');
  let mandate;
  if (parsed.data.mandate_id) mandate = getActiveMandate(parsed.data.mandate_id);
  else if (parsed.data.profile_id) {
    mandate = getActiveMandate(parsed.data.profile_id);
    if (mandate?.kind !== 'profile') mandate = null;
  }
  else mandate = getDefaultProfile();
  if (!mandate) return res.status(409).json({ error: { code: 'NO_PREFERENCES', message: 'Confirm a profile or provide an active mandate before evaluation.' } });
  if (mandate.status !== 'active' || !Number.isFinite(Date.parse(mandate.expires_at)) || Date.parse(mandate.expires_at) <= Date.now()) return res.status(409).json({ error: { code: 'MANDATE_INACTIVE', message: 'The selected mandate is not active.' } });

  const extractionCache = new Map();
  const main = await evaluateObservation(mandate, parsed.data.observation, randomUUID(), null, Number.POSITIVE_INFINITY, extractionCache);
  let alternatives = [];
  if (parsed.data.alternatives && main.decision !== 'ALLOW') {
    const deadline = Date.now() + 12000;
    const words = parsed.data.observation.title.trim().split(/\s+/).slice(0, 6).join(' ');
    const query = mandate.item_query ?? main.extraction?.category_label ?? words;
    const task = (async () => {
      const found = await searchProducts(query, { limit: 12, allowed_domains: mandate.allowed_domains ?? [] });
      const sourceDomain = new URL(parsed.data.observation.url).hostname.toLowerCase();
      const title = parsed.data.observation.title.trim().toLocaleLowerCase();
      const eligible = found.filter((product) => product.title.trim().toLocaleLowerCase() !== title
        && (!product.domain || !domainMatches(sourceDomain, product.domain)));
      const evaluated = [];
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < eligible.length && Date.now() < deadline) {
          const product = eligible[nextIndex++];
          const url = product.url ?? `https://${product.domain ?? 'catalogue.local'}/products/${encodeURIComponent(product.product_id)}`;
          const domain = String(product.domain ?? new URL(url).hostname).toLowerCase();
          const observation = {
            observation_id: product.product_id, url, domain, source: product.source ?? 'curated', title: product.title,
            price_cents: product.price_cents, currency: product.currency, seller: product.merchant_name ?? product.merchant_id,
            sold_by_merchant: product.first_party === true, availability: product.availability ?? 'unknown',
            image_url: product.image_url ?? null, category_hint: product.category,
            bundle_signal: product.is_bundle, hidden_text_found: false, text: product.description,
            captured_at: new Date().toISOString(), content_hash: createHash('sha256').update(product.description).digest('hex'),
          };
          try {
            const value = await evaluateObservation(mandate, observation, randomUUID(), product, deadline, extractionCache, true);
            if (Date.now() <= deadline) evaluated.push({ status: 'fulfilled', value });
          }
          catch (reason) { evaluated.push({ status: 'rejected', reason }); }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, eligible.length) }, worker));
      return evaluated.filter((entry) => entry.status === 'fulfilled' && entry.value.decision === 'ALLOW')
        .slice(0, 3).map((entry) => ({ evaluation_id: entry.value.evaluation_id, observation: entry.value.observation, decision: 'ALLOW', reasons: [] }));
    })();
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve([]), Math.max(0, deadline - Date.now())); });
    try { alternatives = await Promise.race([task.catch(() => []), timeout]); }
    finally { clearTimeout(timer); }
  }
  append({ actor: 'agent', event_type: 'V1_EVALUATION', mandate_id: mandate.mandate_id, proposal_id: main.proposal?.proposal_id ?? null,
    payload: { decision: main.decision, alternatives_count: alternatives.length } });
  const { extraction, evaluation, ...response } = main;
  return res.json({ ...response, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), alternatives });
}));

router.post('/search', asyncHandler(async (req, res) => {
  const body = z.object({ query: z.string().trim().min(1).max(300), observation: productObservationSchema.optional() }).strict().safeParse(req.body);
  if (!body.success) return fail(400, 'VALIDATION_ERROR', 'Provide a product search query.');
  const mandate = getDefaultProfile();
  if (!mandate) return res.status(409).json({ error: { code: 'NO_PREFERENCES', message: 'Confirm a profile before searching for alternatives.' } });
  const deadline = Date.now() + 12000;
  const cache = new Map();
  try {
    const products = await searchProducts(body.data.query, { limit: 12, allowed_domains: mandate.allowed_domains ?? [] });
    const originalDomain = body.data.observation?.domain.toLowerCase();
    const originalTitle = body.data.observation?.title.trim().toLocaleLowerCase();
    const alternatives = [];
    let next = 0;
    const worker = async () => {
      while (next < products.length && alternatives.length < 3 && Date.now() < deadline) {
        const product = products[next++];
        try {
          const url = product.url ?? `https://${product.domain ?? 'catalogue.local'}/products/${encodeURIComponent(product.product_id)}`;
        const domain = String(product.domain ?? new URL(url).hostname).toLowerCase();
          if (product.title.trim().toLocaleLowerCase() === originalTitle || (originalDomain && (domainMatches(originalDomain, domain) || domainMatches(domain, originalDomain)))) continue;
          const text = `${product.title}\n${product.description}`.slice(0, 4000);
          const observation = { observation_id: product.product_id, url, domain, source: product.source ?? 'curated',
            title: product.title, price_cents: product.price_cents, currency: product.currency, seller: product.merchant_name ?? product.merchant_id,
            sold_by_merchant: product.first_party === true, availability: product.availability ?? 'unknown', image_url: product.image_url ?? null,
            category_hint: product.category ?? null, bundle_signal: product.is_bundle, hidden_text_found: false,
            text, captured_at: new Date().toISOString(), content_hash: createHash('sha256').update(text).digest('hex') };
          const result = await evaluateObservation(mandate, observation, randomUUID(), product, deadline, cache, true);
          if (result.decision === 'ALLOW' && result.evaluation && Date.now() <= deadline) alternatives.push({
            evaluation_id: result.evaluation_id, observation: result.observation, decision: 'ALLOW', reasons: [],
          });
        } catch { /* Search failures must not affect another candidate. */ }
      }
    };
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(3, products.length) }, worker)),
      new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
    ]);
    return res.json({ alternatives: alternatives.slice(0, 3) });
  } catch {
    return res.json({ alternatives: [] });
  }
}));

router.post('/proposals', asyncHandler(async (req, res) => {
  const body = z.object({ evaluation_id: z.string().min(1).max(128) }).strict().safeParse(req.body);
  if (!body.success) return fail(400, 'VALIDATION_ERROR', 'Provide a valid evaluation_id.');
  const evaluation = getEvaluation(body.data.evaluation_id);
  if (!evaluation || evaluation.decision !== 'ALLOW' || !evaluation.proposal) return res.status(404).json({ error: { code: 'EVALUATION_NOT_ALLOWED', message: 'An allowed, saved evaluation is required to create a proposal.' } });
  if (Date.parse(evaluation.expires_at) <= Date.now()) return res.status(409).json({ error: { code: 'EVALUATION_EXPIRED', message: 'The evaluation has expired.' } });
  const mandate = getActiveMandate(evaluation.mandate_id);
  if (!mandate || mandate.version !== evaluation.mandate_version) return res.status(409).json({ error: { code: 'MANDATE_STALE', message: 'The mandate is no longer active at the evaluated version.' } });
  const existing = getProposal(evaluation.evaluation_id);
  const proposal = existing ?? { ...evaluation.proposal, proposal_id: randomUUID(), status: 'ALLOWED', created_at: new Date().toISOString() };
  saveProposal(proposal);
  append({ actor: 'agent', event_type: 'PROPOSAL_CREATED', mandate_id: proposal.mandate_id, proposal_id: proposal.proposal_id,
    payload: { source: 'protected', evaluation_id: evaluation.evaluation_id, total_cents: proposal.total_cents } });
  return res.status(existing ? 200 : 201).json({ proposal });
}));

router.post('/evaluations/:id/proposal', asyncHandler(async (req, res) => {
  const params = idSchema.safeParse(req.params);
  if (!params.success || !emptySchema.safeParse(req.body ?? {}).success) return fail(400, 'VALIDATION_ERROR', 'Invalid alternative selection.');
  const existing = getProposal(params.data.id);
  const evaluation = getEvaluation(params.data.id);
  const proposal = existing ?? (evaluation?.decision === 'ALLOW' ? evaluation.proposal : null);
  if (!proposal || proposal.source !== 'protected' || proposal.status !== 'ALLOWED') {
    return res.status(404).json({ error: { code: 'ALTERNATIVE_NOT_AVAILABLE', message: 'This allowed alternative is no longer available.' } });
  }
  return res.json({ proposal });
}));

return router;
}

const router = createV1Router();
export default router;
