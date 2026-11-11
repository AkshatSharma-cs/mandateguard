export type Category = 'mouse' | 'keyboard' | 'headset' | 'monitor' | 'webcam';
export type DecisionName = 'ALLOW' | 'REVIEW' | 'BLOCK';
export type MandateStatus = 'pending_confirmation' | 'active' | 'revoked' | 'expired';
export interface Merchant { merchant_id: string; name: string; approved_default: boolean }
export interface Product { product_id: string; merchant_id: string; title: string; description: string; price_cents: number; currency: string; category: Category; is_bundle: boolean | null }
export interface Mandate {
  mandate_id: string; version: number; status: MandateStatus; owner_id: string; original_instruction: string;
  item_category: Category; max_unit_price_cents: number; max_total_cents: number; quantity_max: number; currency: 'USD';
  allowed_merchant_ids: string[]; allow_bundles: boolean; allow_addons: boolean; expires_at: string; created_at: string; confirmed_at: string | null;
}
export interface ParseResult { mandate: Mandate; notes: string[] }
export interface Extraction { category_label: Category | 'other' | 'unclear'; claimed_price_cents: number | null; claims_bundle: boolean; addon_offers: { name: string; price_cents: number | null }[]; directives_to_agent: boolean; asserts_authority_override: boolean; urgency_pressure: boolean; evidence: string[]; confidence: number }
export interface Reason { code: string; severity: 'BLOCK' | 'REVIEW'; source: 'deterministic' | 'ai'; message: string }
export interface Check { code: string; passed: boolean; source: 'deterministic' | 'ai' }
export interface Decision { decision: DecisionName; reasons: Reason[]; checks: Check[] }
export interface Candidate { product_id: string; decision: DecisionName; reasons: Reason[]; checks?: Check[]; extraction: Extraction | null }
export interface ProposalItem { sku: string; name: string; quantity: number; unit_price_cents: number }
export interface Proposal {
  proposal_id: string; mandate_id: string; mandate_version: number; merchant_id: string; currency: string; items: ProposalItem[];
  total_cents: number; source: 'naive' | 'protected'; status: string; paypal_order_id: string | null;
  evidence?: { extractions?: Record<string, Extraction | null>; sanitize_flags?: Record<string, { zero_width: boolean; html_comment: boolean; hidden_style: boolean }>; catalogue_hash?: string; decision?: Decision; evaluated_at?: string };
  would_have_been?: Decision;
}
export interface AgentRun { run_id: string; mode: 'naive' | 'protected'; enforced: boolean; candidates: Candidate[]; proposal: Proposal | null; naive_reasoning: string | null }
export interface AuditEvent { id: number; ts: string; actor: string; event_type: string; mandate_id: string | null; proposal_id: string | null; payload: unknown; prev_hash: string | null; hash: string }
export interface AuditResult { events: AuditEvent[]; chain_ok: boolean }
export interface PublicConfig { paypal_client_id: string; currency: string }
export interface Health { status: string }
export interface VerifyCheck { id: string; passed: boolean; detail: string }
export interface CaptureResult { status: string; checks: Array<VerifyCheck | Check>; capture: unknown | null }
