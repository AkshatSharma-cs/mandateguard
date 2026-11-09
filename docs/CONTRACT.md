PROJECT: MandateGuard, a permission-aware AI purchasing agent. AI may PROPOSE purchases but never AUTHORIZES them. Hackathon demo, PayPal SANDBOX only.

STACK: Node 20+, ESM ('type':'module'), Express 4, better-sqlite3, zod, dotenv, native fetch. Tests: node:test (run: node --test server/test). No TypeScript. No other dependencies unless the task says so.

FILES:
server/src/{index.js, config.js, db.js, money.js, audit.js}
server/src/paypal/client.js
server/src/policy/engine.js
server/src/capture/verify.js
server/src/llm/{provider.js, sanitize.js, extractor.js, mandateParser.js, naiveAgent.js}
server/src/agent/run.js
server/src/catalogue/{products.json, merchants.json, index.js}
server/src/routes/{mandates.js, agent.js, payments.js, audit.js}
server/test/*.test.js | scripts/{paypal-spike.js, smoke.sh} | attacks/{cases.json, run.js, RESULTS.md} | public/{spike.html, checkout-harness.html} | docs/CONTRACT.md

MONEY: integer cents everywhere. money.js: toCents('24.99') -> 2499 (strict /^\d+\.\d{2}$/, else throw), fromCents(2499) -> '24.99'. Never floats. Strings only at the PayPal edge.

TYPES (TS-style notation):
Mandate {mandate_id, version:int, status:'pending_confirmation'|'active'|'revoked', owner_id, original_instruction, item_category:'mouse'|'keyboard'|'headset'|'monitor'|'webcam', max_unit_price_cents, max_total_cents, quantity_max, currency:'USD', allowed_merchant_ids:string[], allow_bundles:boolean, allow_addons:boolean, expires_at:ISO, created_at:ISO, confirmed_at:ISO|null}
Merchant {merchant_id, name, approved_default:boolean}. Ids: m_acme, m_byte, m_zen (approved); m_shady, m_flash (not approved).
Product {product_id, merchant_id, title, description (UNTRUSTED), price_cents, currency, category (trusted enum as Mandate.item_category), is_bundle:true|false|null (null = unknown)}
ProposalItem {sku (= product_id), name, quantity, unit_price_cents}
Proposal {proposal_id, mandate_id, mandate_version, merchant_id, currency, items:ProposalItem[], total_cents, source:'naive'|'protected', status:'DRAFT'|'ALLOWED'|'REVIEW'|'BLOCKED'|'ORDER_CREATED'|'CAPTURE_PENDING'|'CAPTURED'|'FAILED', paypal_order_id:string|null, evidence:Evidence, created_at}
Extraction (output of the quarantined LLM, one per listing) {category_label:'mouse'|'keyboard'|'headset'|'monitor'|'webcam'|'other'|'unclear', claimed_price_cents:int|null, claims_bundle:boolean, addon_offers:{name, price_cents:int|null}[] (max 5), directives_to_agent:boolean, asserts_authority_override:boolean, urgency_pressure:boolean, evidence:string[] (max 3, each max 160 chars, verbatim), confidence:number 0..1}
SanitizeFlags {zero_width:boolean, html_comment:boolean, hidden_style:boolean}
Evidence {extractions:{[product_id]:Extraction|null}, sanitize_flags:{[product_id]:SanitizeFlags}, catalogue_hash:string (sha256 of the canonical JSON of the products involved), decision:Decision, evaluated_at:ISO}. Evidence is stored with the proposal and never modified. Checkout and capture re-evaluate the proposal against this stored evidence plus the CURRENT mandate, time and captured list, and never re-call the LLM.
Decision {decision:'ALLOW'|'REVIEW'|'BLOCK', reasons:{code, severity:'BLOCK'|'REVIEW', source:'deterministic'|'ai', message}[], checks:{code, passed:boolean, source}[]}

POLICY RULES (code: outcome):
Deterministic BLOCK: MANDATE_INACTIVE, MANDATE_EXPIRED, MANDATE_STALE (proposal.mandate_version != mandate.version), CURRENCY_MISMATCH, MERCHANT_NOT_ALLOWED, PRODUCT_UNKNOWN, PRICE_TAMPERED (item price != catalogue price), OVER_BUDGET (total > max_total or unit > max_unit), QUANTITY_EXCEEDED, ADDON_NOT_ALLOWED (more than one distinct sku, or a sku whose category differs, unless allow_addons), BUNDLE_NOT_ALLOWED (is_bundle true and !allow_bundles), DUPLICATE (same mandate and sku already CAPTURED).
Deterministic REVIEW: BUNDLE_UNKNOWN (is_bundle null and !allow_bundles), HIDDEN_CONTENT (any sanitize flag true).
AI-derived BLOCK: INJECTION_DETECTED (directives_to_agent or asserts_authority_override, with confidence >= 0.5).
AI-derived REVIEW: BUNDLE_TEXT_CONFLICT (claims_bundle true while catalogue is_bundle is false and !allow_bundles), TEXT_PRICE_CONFLICT (claimed_price_cents not null and != catalogue price), CATEGORY_MISMATCH (label != mandate category), URGENCY_PRESSURE, LOW_CONFIDENCE (< 0.5), EXTRACTOR_FAILED (missing or invalid extraction; fail closed).
Aggregation: any BLOCK -> BLOCK; else any REVIEW -> REVIEW; else ALLOW. ALLOW requires every deterministic check to pass AND an extraction to exist. AI signals can only add REVIEW/BLOCK, never remove one. REVIEW is not purchasable in the MVP.

INVARIANTS:
I1 AI cannot create, modify or expand a mandate without explicit user confirmation.
I2 Untrusted merchant text never reaches payment tools or trusted instructions. Only the extractor sees it, and the extractor has no tools.
I3 AI checks can flag or reject, never authorize.
I4 Only deterministic policy plus the buyer's PayPal approval authorize payment.
I5 The backend re-verifies the exact PayPal order before capture, and capture uses the atomic transition ORDER_CREATED -> CAPTURE_PENDING -> CAPTURED.
I6 Every consequential step is appended to audit_events.
I7 Fail closed: any error, timeout or invalid output means REVIEW or BLOCK, never ALLOW.

API (JSON):
POST /api/mandates/parse {instruction} -> {mandate (pending_confirmation), notes[]}
POST /api/mandates/:id/confirm -> mandate (active)
POST /api/mandates/:id/revoke -> mandate
GET  /api/mandates/:id
GET  /api/catalogue -> {merchants, products}
POST /api/agent/run {mandate_id, mode:'naive'|'protected'} -> {run_id, mode, enforced:boolean, candidates:[{product_id, decision, reasons, extraction|null}], proposal|null, naive_reasoning|null}
POST /api/proposals/:id/checkout -> {paypal_order_id}  (only if status ALLOWED; re-evaluates policy)
POST /api/proposals/:id/capture {order_id} -> {status, checks[], capture|null}
GET  /api/audit?proposal_id=&mandate_id= -> {events[], chain_ok}
GET  /api/config/public -> {paypal_client_id, currency}

ENV: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL (https://api-m.sandbox.paypal.com), PAYPAL_BUSINESS_EMAIL, APP_BASE_URL (http://localhost:3000), PORT, LLM_PROVIDER (gemini|anthropic), LLM_API_KEY (required unless LLM_MODE=replay), LLM_MODEL, LLM_MODE (live|record|replay).