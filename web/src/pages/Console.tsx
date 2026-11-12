import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import * as Dialog from '@radix-ui/react-dialog';

import { AlertCircle, Ban, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Copy, ExternalLink, Info, TriangleAlert, X } from 'lucide-react';

import { AnimatePresence, motion } from 'motion/react';

import { Button, EmptyState, KeyValueList, Money, Mono, Panel, Skeleton, StatusPill, Tag, Textarea } from '../components/ui';

import PayPalCheckout from '../components/PayPalCheckout';

import { useStore } from '../state/store';

import { api } from '../api/client';

import { merchants as fixtureMerchants, products as fixtureProducts, verificationLabels } from '../api/fixtures';

import type { AuditEvent, Candidate, CompareLink, Product, ProductObservation, Receipt, RunResult } from '../types';

import { expoOut, useReducedMotionVariants } from '../lib/motion';

import './console.css';



const reasonText: Record<string, (product: Product, mandateLimit: number) => string> = {

  OVER_BUDGET: (product, limit) => `Total ${formatMoney(product.price_cents)} is over your ${formatMoney(limit)} limit.`,

  BUNDLE_NOT_ALLOWED: () => 'This is a bundle, and your mandate does not allow bundles.',

  BUNDLE_UNKNOWN: () => 'The seller does not say whether this is a bundle.',

  BUNDLE_TEXT_CONFLICT: () => 'The listing describes a bundle, but the catalogue does not.',

  MERCHANT_NOT_ALLOWED: product => `${fixtureMerchants.find(item => item.merchant_id === product.merchant_id)?.name ?? product.merchant_id} is not on your approved merchant list.`,

  INJECTION_DETECTED: () => 'The listing contains instructions aimed at AI agents. They were ignored.',

  TEXT_PRICE_CONFLICT: () => 'The price stated in the listing text differs from the catalogue price.',

  HIDDEN_CONTENT: () => 'The listing contains hidden text.',

  URGENCY_PRESSURE: () => 'The listing pressures the buyer to act immediately.',

  ADDON_NOT_ALLOWED: () => 'The proposal includes items you did not ask for.',

  CATEGORY_MISMATCH: () => 'This product does not match the category you asked for.',

  EXTRACTOR_FAILED: () => 'The listing could not be analyzed, so it was held for review.',

  LOW_CONFIDENCE: () => 'The analysis was not confident enough to approve this listing.',

  PRICE_TAMPERED: () => 'The proposed price does not match the catalogue.',

  PRODUCT_UNKNOWN: () => 'This product is not in the catalogue.',

  QUANTITY_EXCEEDED: () => 'The quantity is above your limit.',

  DUPLICATE: () => 'This item was already purchased under this mandate.',

  MANDATE_INACTIVE: () => 'The mandate is not active.',

  MANDATE_EXPIRED: () => 'The mandate has expired.',

  MANDATE_STALE: () => 'The mandate changed after this proposal was created.',

  CURRENCY_MISMATCH: () => 'The currency does not match your mandate.',

};

const eventLabels: Record<string, string> = {

  AGENT_RUN_STARTED: 'Agent run started', LISTING_SANITIZED: 'Listing sanitized', EXTRACTION_DONE: 'Listing analyzed',

  POLICY_DECISION: 'Policy decision', PROPOSAL_CREATED: 'Proposal created', MANDATE_CONFIRMED: 'Mandate confirmed',

  ORDER_CREATED: 'PayPal order created', VERIFICATION_RESULT: 'Pre-capture verification', PAYMENT_CAPTURED: 'Payment captured',

};

const checkLabels: Record<string, string> = verificationLabels;

function formatMoney(cents: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }



function ProductLink({ title, url, domain }: { title: string; url?: string; domain: string }) {

  return <span className="console-product-link">{url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${title} on ${domain} in a new tab`}>{title}<ExternalLink size={16} aria-hidden="true" /></a>}<Tag>{domain}</Tag></span>;

}



function runObservationFor(run: RunResult | null, productId: string): ProductObservation | undefined {

  return run?.candidates.find(candidate => candidate.product_id === productId)?.observation;

}



export default function ConsolePage() {

  const store = useStore();

  const motionPrefs = useReducedMotionVariants();

  const [instruction, setInstruction] = useState('');

  const [hasDefaultProfile, setHasDefaultProfile] = useState(false);

  const [revokeOpen, setRevokeOpen] = useState(false);

  const [buyEvaluation, setBuyEvaluation] = useState<Candidate | null>(null);

  const [auditOpen, setAuditOpen] = useState(false);

  const [auditJsonCopied, setAuditJsonCopied] = useState(false);

  const mandate = store.mandate;



  useEffect(() => { void api.getProfiles().then(result => setHasDefaultProfile(result.profiles.some(profile => profile.is_default && profile.status === 'active'))).catch(() => setHasDefaultProfile(false)); }, []);



  async function createMandate(event: FormEvent) {

    event.preventDefault();

    await store.parseMandate(instruction);

  }

  async function confirm() { await store.confirmMandate(); }

  async function revoke() { if (await store.revokeMandate()) setRevokeOpen(false); }

  async function replaceMandate() {

    if (await store.revokeMandate()) {

      setInstruction('');

      store.discardMandate();

    }

  }

  async function run() { await store.runBoth(); }

  async function copyEvents() {

    try { await navigator.clipboard?.writeText(JSON.stringify(store.auditEvents, null, 2)); setAuditJsonCopied(true); window.setTimeout(() => setAuditJsonCopied(false), 1200); }

    catch { setAuditJsonCopied(false); }

  }



  return <div className="console-page">

    <div className="container">

      <header className="console-heading"><div><h1>Console</h1><p>Review proposals, enforce your mandate, and complete purchases safely.</p></div><a className="preferences-shortcut" href="#/preferences">Preferences</a></header>

      <div className="console-grid">

        <Panel className="console-panel mandate-panel" title="Mandate" headingLevel={2}>

          {!mandate ? <form onSubmit={event => void createMandate(event)}>

            <Textarea id="mandate-instruction" label="What are you shopping for?" rows={3} value={instruction} onChange={event => setInstruction(event.target.value)} disabled={store.loading.parse} />

            {hasDefaultProfile && <p className="profile-usage"><Tag variant="brand">Using your preferences</Tag> <a href="#/preferences">Preferences</a></p>}

            <button type="button" className="console-example" onClick={() => setInstruction('Find a wireless keyboard under $50. Only approved merchants. No bundles.')}>Find a wireless keyboard under $50. Only approved merchants. No bundles.</button>

            <Button type="submit" size="md" disabled={!instruction.trim() || store.loading.parse}>{store.loading.parse ? 'Creatingâ€¦' : 'Create mandate'}</Button>

            <AnimatePresence initial={false}>{store.errors.parse && <InlineError key="parse-error" message={store.errors.parse.message} retry={() => void store.parseMandate(instruction)} onClose={() => store.clearError('parse')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>

          </form> : <MandateDetails />}

          {store.loading.catalogue && <div className="catalogue-loading"><Skeleton width="100%" /><Skeleton width="72%" /></div>}

          <AnimatePresence initial={false}>{store.errors.catalogue && <InlineError key="catalogue-error" message={store.errors.catalogue.message} retry={() => void store.loadCatalogue()} onClose={() => store.clearError('catalogue')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>

        </Panel>

        <Panel className="console-panel agent-panel" title="Agent run" headingLevel={2} action={<div className="agent-panel-actions"><Button className="console-audit-trigger" variant="outline" size="md" onClick={() => setAuditOpen(true)}><ClipboardList size={16} aria-hidden="true" />Audit trail</Button><Button size="md" onClick={() => void run()} disabled={mandate?.status !== 'active' || store.loading.run}>{store.loading.run ? 'Runningâ€¦' : 'Run both'}</Button></div>}>

          <AnimatePresence initial={false}>{store.errors.run && <InlineError key="run-error" message={store.errors.run.message} retry={() => void run()} onClose={() => store.clearError('run')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>

          {store.loading.run && <div className="run-inline-status" role="status"><span>Searching for products that match your request…</span><span>Analyzing listings</span><span>Checking against mandate</span><span>Finalizing results…</span><small>This may take a few seconds.</small></div>}

          {store.loading.run && <RunSkeleton />}

          {!store.loading.run && store.runs.protected && <p className="agent-result-summary">{store.runs.protected.candidates.length} listings checked: {store.runs.protected.candidates.filter(item => item.decision === 'ALLOW').length} allowed, {store.runs.protected.candidates.filter(item => item.decision === 'REVIEW').length} need review, {store.runs.protected.candidates.filter(item => item.decision === 'BLOCK').length} blocked</p>}

          {!store.loading.run && !store.runs.naive && !store.runs.protected && <EmptyState sentence="Confirm a mandate, then run both agents." />}

          {!store.loading.run && store.runs.naive && store.runs.protected && <div className="agent-columns" aria-live="polite">

            <NaiveRun run={store.runs.naive} onRun={() => void run()} />

            <ProtectedRunV7 run={store.runs.protected} onCheckout={store.openCheckout} onBuyNow={setBuyEvaluation} paid={store.captureResult?.status === 'CAPTURED'} />

          </div>}

        </Panel>

      </div>

    </div>



    <Dialog.Root open={auditOpen} onOpenChange={setAuditOpen}>

      <Dialog.Portal forceMount><AnimatePresence initial={false}>{auditOpen && <>

        <Dialog.Overlay forceMount asChild><motion.div className="console-dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut }} /></Dialog.Overlay>

        <Dialog.Content forceMount asChild><motion.div className="console-drawer audit-sheet" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 40 }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 40 }} transition={{ duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut }}>

          <Dialog.Title className="drawer-title">Audit trail</Dialog.Title><Dialog.Close asChild><button className="drawer-close" aria-label="Close audit trail"><X size={20} /></button></Dialog.Close>

          <AuditContent copyEvents={() => void copyEvents()} copied={auditJsonCopied} />

        </motion.div></Dialog.Content>

      </>}</AnimatePresence></Dialog.Portal>

    </Dialog.Root>



    <CheckoutDrawer />



    <Dialog.Root open={Boolean(buyEvaluation)} onOpenChange={open => { if (!open) setBuyEvaluation(null); }}>

      <Dialog.Portal><Dialog.Overlay className="console-dialog-overlay" /><Dialog.Content className="revoke-dialog">

        <Dialog.Title className="text-h3">Pay with PayPal sandbox</Dialog.Title>

        {buyEvaluation && <><Dialog.Description>{buyEvaluation.observation.checkout_mode === 'gateway'

          ? 'This is a sandbox order on the MandateGuard demo store. No real purchase or shipment happens.'

          : `MandateGuard will create a PayPal sandbox order for this product. This is a simulation: nothing is purchased from ${buyEvaluation.observation.domain} and no real money moves.`}</Dialog.Description>

          <KeyValueList rows={[{ label: 'Product', value: <ProductLink title={buyEvaluation.observation.title} url={buyEvaluation.observation.url} domain={buyEvaluation.observation.domain} /> }, { label: 'Store', value: <Tag>{buyEvaluation.observation.domain}</Tag> }, { label: 'Price', value: <Money cents={buyEvaluation.observation.price_cents ?? 0} currency={buyEvaluation.observation.currency} /> }, { label: 'Mandate', value: mandate?.item_query ?? mandate?.original_instruction ?? 'Your limits' }]} />

          <div className="dialog-actions"><Button variant="outline" onClick={() => setBuyEvaluation(null)}>Cancel</Button><Button onClick={() => { const id = buyEvaluation.evaluation_id; setBuyEvaluation(null); if (id) void store.useAlternative(id); }}>Continue to PayPal</Button></div></>}

      </Dialog.Content></Dialog.Portal>

    </Dialog.Root>



    <Dialog.Root open={revokeOpen} onOpenChange={setRevokeOpen}>

      <Dialog.Portal><Dialog.Overlay className="console-dialog-overlay" /><Dialog.Content className="revoke-dialog">

        <Dialog.Title className="text-h3">Revoke mandate?</Dialog.Title><Dialog.Description>This mandate will no longer be available for protected agent runs.</Dialog.Description>

        <div className="dialog-actions"><Button variant="secondary" onClick={() => setRevokeOpen(false)}>Cancel</Button><Button variant="danger-outline" disabled={store.loading.revoke} onClick={() => void revoke()}>{store.loading.revoke ? 'Revokingâ€¦' : 'Revoke'}</Button></div>

      </Dialog.Content></Dialog.Portal>

    </Dialog.Root>

  </div>;



  function MandateDetails() {

    const current = mandate!;

    const merchantNames = current.allowed_merchant_ids.map(id => store.catalogue?.merchants.find(merchant => merchant.merchant_id === id)?.name ?? id);

    return <>

      {current.kind === 'profile' ? <p className="profile-usage"><Tag variant="brand">Using your preferences</Tag></p> : <blockquote className="mandate-instruction">{current.original_instruction}</blockquote>}

      {current.kind === 'task' && <p className="task-category">Category: {current.item_category ?? current.item_query ?? 'Task'}</p>}
      <h3 className="mandate-group-title">Limits</h3>
      <KeyValueList rows={[{ label: 'Max total', value: <Money cents={current.max_total_cents} currency={current.currency} /> }, { label: 'Expires', value: <span className="nowrap-value">{new Date(current.expires_at).toLocaleString()}</span> }]} />
      <h3 className="mandate-group-title">Rules</h3>
      <div className="mandate-rule-chips"><Tag>{current.allow_bundles ? 'Bundles allowed' : 'No bundles'}</Tag><Tag>{current.allow_addons ? 'Add-ons allowed' : 'No add-ons'}</Tag><Tag>{current.require_first_party ? 'Sold by merchant: on' : 'Sold by merchant: off'}</Tag></div>
      <div className="mandate-approved-sites"><strong>{current.allowed_domains.length ? 'Approved websites' : 'Approved merchants'}</strong><DomainValues domains={current.allowed_domains.length ? current.allowed_domains : merchantNames} /></div>

      <MandateStatus status={current.status} />

      {current.status === 'active' && current.confirmed_by?.startsWith('profile:') && <p className="profile-usage">Active: within your preferences</p>}

      {current.status === 'pending_confirmation' && <>{store.exceeded.length > 0 && <div className="profile-exceeded"><strong>This goes beyond your preferences</strong><ul>{store.exceeded.map(item => <li key={item}>{item.replaceAll('_', ' ')}</li>)}</ul></div>}<div className="mandate-actions"><Button size="md" disabled={store.loading.confirm} onClick={() => void confirm()}>{store.loading.confirm ? 'Confirmingâ€¦' : 'Confirm mandate'}</Button><Button size="md" variant="secondary" onClick={store.discardMandate}>Discard</Button></div><p className="mandate-pending-note">Nothing is purchased until you confirm.</p></>}

      {current.status === 'active' && <><p className="confirmed-time">Confirmed {current.confirmed_at ? new Date(current.confirmed_at).toLocaleString() : ''}</p><div className="mandate-actions"><Button size="md" variant="danger-outline" onClick={() => setRevokeOpen(true)}>Revoke</Button><Button size="md" variant="outline" disabled={store.loading.revoke} onClick={() => void replaceMandate()}>Replace mandate</Button></div></>}

      {current.status === 'revoked' && <Button size="md" variant="outline" onClick={() => { store.discardMandate(); setInstruction(''); }}>Start a new mandate</Button>}

      {(['confirm', 'revoke'] as const).map(action => <AnimatePresence key={action} initial={false}>{store.errors[action] && <InlineError key={`${action}-error`} message={store.errors[action]!.message} retry={() => void (action === 'confirm' ? confirm() : revoke())} onClose={() => store.clearError(action)} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>)}

    </>;

  }

}

function DomainValues({ domains }: { domains: string[] }) {
  if (!domains.length) return <span className="nowrap-value">None</span>;
  return <div className="mandate-domain-values">{domains.slice(0, 4).map(domain => <Tag key={domain}>{domain}</Tag>)}{domains.length > 4 && <details className="domain-popover"><summary>+{domains.length - 4} more</summary><div>{domains.map(domain => <Tag key={domain}>{domain}</Tag>)}</div></details>}</div>;
}



function MandateStatus({ status }: { status: 'pending_confirmation' | 'active' | 'revoked' }) {

  const map = {

    pending_confirmation: { text: 'Pending confirmation', icon: TriangleAlert, cls: 'mandate-state-pending' },

    active: { text: 'Active', icon: Check, cls: 'mandate-state-active' },

    revoked: { text: 'Revoked', icon: Ban, cls: 'mandate-state-revoked' },

  }[status];

  const Icon = map.icon;

  return <span className={`mandate-state ${map.cls}`}><Icon size={16} aria-hidden="true" />{map.text}</span>;

}



function InlineError({ message, retry, onClose, reduced }: { message: string; retry: () => void; onClose: () => void; reduced: boolean }) {

  return <motion.div className="console-error" role="alert" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} transition={{ duration: reduced ? 0.15 : 0.3, ease: expoOut }}><AlertCircle size={18} /><span>{message}</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button><button className="error-close" aria-label="Dismiss error" onClick={onClose}><X size={16} /></button></motion.div>;

}



function RunSkeleton() { return <div className="agent-columns"><div><Skeleton width="48%" height={24} /><Skeleton width="100%" height={48} /><Skeleton width="84%" height={48} /></div><div><Skeleton width="48%" height={24} /><Skeleton width="100%" height={48} /><Skeleton width="84%" height={48} /></div></div>; }



function NaiveRun({ run, onRun }: { run: RunResult; onRun: () => void }) {

  const store = useStore();
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  const proposal = run.proposal;

  const catalogProducts = store.catalogue?.products ?? fixtureProducts;

  const catalogProduct = proposal?.items[0] ? catalogProducts.find(product => product.product_id === proposal.items[0].sku) : undefined;

  const candidate = run.candidates.find(item => item.product_id === proposal?.items[0]?.sku);
  const violations = run.naive_violations ?? run.violations ?? candidate?.reasons.filter(reason => reason.source === 'deterministic').map(({ code, message }) => ({ code, message })) ?? [];
  const chosen = proposal?.items[0];
  const chosenProduct = chosen ? catalogProducts.find(item => item.product_id === chosen.sku) : undefined;
  const chosenTitle = chosenProduct?.title ?? candidate?.observation.title ?? chosen?.name ?? 'Product';
  const chosenDomain = candidate?.observation.domain ?? chosenProduct?.domain ?? 'store';
  const chosenUrl = candidate?.observation.url ?? chosenProduct?.url;

  if (!proposal || run.naive_reasoning === 'The unprotected agent did not choose a listing.') return <section className="agent-column naive-column"><h3 className="agent-column-title">Without MandateGuard</h3><p>The unprotected agent did not choose a listing.</p><button type="button" className="text-action" onClick={onRun}>Run again</button></section>;

  return <section className="agent-column naive-column">

    <h3 className="agent-column-title">Without MandateGuard</h3><p className="agent-caption">Unprotected agent. The policy engine only observes.</p>

    <article className="naive-choice-card"><strong>The unprotected agent chose</strong><div className="naive-choice-product">{chosenUrl ? <ProductLink title={chosenTitle} url={chosenUrl} domain={chosenDomain} /> : <strong>{chosenTitle}</strong>}<Tag>{chosenDomain}</Tag><span><Money cents={chosen?.unit_price_cents ?? proposal.total_cents} currency={proposal.currency} /></span></div>{run.naive_reasoning && <><blockquote className={`reasoning-quote ${reasoningExpanded ? 'reasoning-expanded' : ''}`}>{run.naive_reasoning}</blockquote>{run.naive_reasoning.length > 160 && <button className="text-action" type="button" onClick={() => setReasoningExpanded(value => !value)}>{reasoningExpanded ? 'Read less' : 'Read more'}</button>}</>}
    {violations.length ? <div className="unauthorized-notice"><strong>Would break your limits</strong><ul>{violations.map(reason => <li key={`${reason.code}-${reason.message}`}>{reason.message || reasonMessage(reason.code, catalogProduct, 3000)}</li>)}</ul></div> : <div className="neutral-notice">This choice would have been allowed.</div>}
    <Tag>Simulated, not executed</Tag></article>

  </section>;

}



function ProtectedRunV7({ run, onCheckout, onBuyNow, paid }: { run: RunResult; onCheckout: () => void; onBuyNow: (candidate: Candidate) => void; paid: boolean }) {
  const [filter, setFilter] = useState<'All' | 'ALLOW' | 'REVIEW' | 'BLOCK'>('All');
  const [sort, setSort] = useState<'match' | 'low' | 'high'>('match');
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [limit, setLimit] = useState(10);
  const candidates = useMemo(() => {
    const order = { ALLOW: 0, REVIEW: 1, BLOCK: 2 };
    return run.candidates.filter(item => filter === 'All' || item.decision === filter).sort((a, b) => sort === 'low'
      ? (a.observation.price_cents ?? Infinity) - (b.observation.price_cents ?? Infinity)
      : sort === 'high' ? (b.observation.price_cents ?? -1) - (a.observation.price_cents ?? -1) : order[a.decision] - order[b.decision]);
  }, [run.candidates, filter, sort]);
  const visible = candidates.slice(0, limit);
  const selected = visible.find(item => item.product_id === sheetId) ?? null;
  const move = (step: number) => { if (!selected || !visible.length) return; const i = visible.findIndex(item => item.product_id === selected.product_id); setSheetId(visible[(i + step + visible.length) % visible.length].product_id); };
  const allowed = run.candidates.filter(item => item.decision === 'ALLOW');
  const featured = allowed.slice(0, 3).filter(item => filter === 'All' || item.decision === filter);
  const rest = visible.filter(item => !featured.some(feature => feature.product_id === item.product_id));
  const counts = { ALLOW: allowed.length, REVIEW: run.candidates.filter(item => item.decision === 'REVIEW').length, BLOCK: run.candidates.filter(item => item.decision === 'BLOCK').length };
  const proposal = run.proposal;
  const proposalCandidate = proposal?.items[0] ? run.candidates.find(item => item.product_id === proposal.items[0].sku) : undefined;
  const why = (decision: Candidate['decision']) => decision === 'ALLOW' ? 'Why allowed' : decision === 'BLOCK' ? 'Why blocked' : 'Why needs review';
  return <section className="agent-column protected-column">
    <h3 className="agent-column-title">With MandateGuard</h3>
    <div className="result-info-strip"><Info size={16} aria-hidden="true" /><span>Buy now pays with the PayPal sandbox. For stores MandateGuard does not host, it simulates the purchase.</span></div>
    {run.candidates.length === 0 ? <EmptyState sentence={run.discovery_provider === 'channel3' ? 'No live marketplace listings matched this search.' : 'No live marketplace listings were returned. Check Channel3 setup or try another search.'} /> : <>
      <div className="candidate-controls"><div className="filter-chips" aria-label="Filter listings">{(['All', 'ALLOW', 'REVIEW', 'BLOCK'] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(10); }}>{value === 'All' ? `All (${run.candidates.length})` : `${value === 'ALLOW' ? 'Allowed' : value === 'REVIEW' ? 'Needs review' : 'Blocked'} (${counts[value]})`}</button>)}</div><label>Sort listings<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="match">Best match</option><option value="low">Price low to high</option><option value="high">Price high to low</option></select></label></div>
      {featured.length > 0 && <div className="featured-listings">{featured.map(item => <article className="featured-listing" key={item.product_id}><button type="button" className="candidate-title" title={item.observation.title} onClick={() => setSheetId(item.product_id)}>{item.observation.title}</button><span className="candidate-domain">{item.observation.domain}</span><span className="candidate-price"><Money cents={item.observation.price_cents ?? 0} currency={item.observation.currency} /></span><p>Matches your preferences</p><div><Button size="sm" disabled={paid && proposal?.items[0]?.sku === item.product_id} onClick={() => onBuyNow(item)}>{paid && proposal?.items[0]?.sku === item.product_id ? 'Paid' : 'Buy now'}</Button><button type="button" className="text-action" onClick={() => setSheetId(item.product_id)}>Why allowed</button><OpenListingIcon candidate={item} /></div></article>)}</div>}
      <h4 className="more-options-heading">More options</h4><div className="candidate-rows">{rest.map(item => <CandidateRow key={item.product_id} candidate={item} label={why(item.decision)} onOpen={() => setSheetId(item.product_id)} onBuy={() => onBuyNow(item)} paid={paid && proposal?.items[0]?.sku === item.product_id} />)}</div>
      {candidates.length > limit && <Button variant="outline" size="sm" onClick={() => setLimit(value => value + 10)}>Show 10 more</Button>}
    </>}
    {proposal?.checkout_mode === 'gateway' && <div className="proposal-bar"><div className="proposal-description">{proposalCandidate ? <ProductLink title={proposalCandidate.observation.title} url={proposalCandidate.observation.url} domain={proposalCandidate.observation.domain} /> : <strong>{proposal.items.map(item => item.name).join(', ')}</strong>}<span><Money cents={proposal.total_cents} currency={proposal.currency} /></span></div><StatusPill status="ALLOW" /><Button size="md" disabled={paid || proposal.source === 'naive'} onClick={onCheckout}>{paid ? 'Paid' : 'Review and pay'}</Button></div>}
    {!proposal && run.candidates.length > 0 && <EmptyState sentence="No listing passed your mandate. Nothing will be purchased." />}
    <CompareOnOtherStores links={run.compare_links ?? []} />
    <RulesSheetV7 candidate={selected} candidates={visible} onMove={move} onBuyNow={onBuyNow} onClose={() => setSheetId(null)} onAlternatives={() => { setFilter('All'); setLimit(Math.max(10, run.candidates.length)); setSheetId(null); window.setTimeout(() => (document.querySelector('.featured-listings') ?? document.querySelector('.candidate-rows'))?.scrollIntoView({ behavior: 'auto', block: 'start' }), 0); }} />
  </section>;
}

function CandidateRow({ candidate, label, onOpen, onBuy, paid }: { candidate: Candidate; label: string; onOpen: () => void; onBuy: () => void; paid: boolean }) {
  const Icon = candidate.decision === 'ALLOW' ? CheckCircle2 : candidate.decision === 'REVIEW' ? TriangleAlert : Ban;
  const source = candidate.observation.source === 'channel3' ? 'Live product' : candidate.observation.source === 'curated' ? 'Demo store' : 'Product page';
  return <article className={`candidate-row decision-${candidate.decision.toLowerCase()}`}><Icon size={20} aria-hidden="true" /><div className="candidate-row-main"><button className="candidate-title" type="button" title={candidate.observation.title} onClick={onOpen}>{candidate.observation.title}</button><span>{candidate.observation.domain} · {source}</span></div><Money cents={candidate.observation.price_cents ?? 0} currency={candidate.observation.currency} /><div className="candidate-row-actions">{candidate.decision === 'ALLOW' && <Button size="sm" disabled={paid} onClick={onBuy}>{paid ? 'Paid' : 'Buy now'}</Button>}<OpenListingIcon candidate={candidate} /><button className="text-action" type="button" onClick={onOpen}>{label}</button></div></article>;
}

function OpenListingIcon({ candidate }: { candidate: Candidate }) {
  return <a className="open-listing-icon" href={candidate.observation.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${candidate.observation.title} at ${candidate.observation.domain} in a new tab`} onClick={() => { if (candidate.evaluation_id) void api.handoff(candidate.evaluation_id).catch(() => undefined); }}><ExternalLink size={16} aria-hidden="true" /></a>;
}

function CompareOnOtherStores({ links }: { links: CompareLink[] }) {

  if (links.length === 0) return null;

  return <section className="compare-stores">

    <div><h4>Compare on other stores</h4><p>Opens search results on each store.</p></div>

    <div className="compare-store-links">{links.map(link => <a className="button button-outline button-sm" key={`${link.store}-${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Search ${link.query} on ${link.store}`}>{link.store}</a>)}</div>

  </section>;

}



function RulesSheetV7({ candidate, candidates, onMove, onBuyNow, onClose, onAlternatives }: { candidate: Candidate | null; candidates: Candidate[]; onMove: (step: number) => void; onBuyNow: (candidate: Candidate) => void; onClose: () => void; onAlternatives: () => void }) {
  const motionPrefs = useReducedMotionVariants();
  useEffect(() => {
    if (!candidate) return;
    const handle = (event: KeyboardEvent) => { if (event.key === 'ArrowLeft') onMove(-1); if (event.key === 'ArrowRight') onMove(1); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [candidate, onMove]);
  if (!candidate) return null;
  const extraction = candidate.extraction;
  const flagged = candidate.flags ?? { injection: Boolean(extraction?.directives_to_agent || extraction?.asserts_authority_override), hidden_text: Boolean(candidate.observation.hidden_text_found), urgency: Boolean(extraction?.urgency_pressure), price_conflict: Boolean(extraction?.claimed_price_cents != null && extraction.claimed_price_cents !== candidate.observation.price_cents) };
  const issue = candidate.reasons.find(reason => reason.severity === 'BLOCK' || reason.severity === 'REVIEW');
  const verdict = candidate.decision === 'ALLOW' ? 'This listing is within every limit you set.' : issue?.message ?? (candidate.decision === 'BLOCK' ? 'This listing breaks a limit you set.' : 'This listing needs review before purchase.');
  const checkCopy: Record<string, { group: string; pass: string; fail: string }> = {
    OVER_BUDGET: { group: 'Your limits', pass: 'Within your price limit', fail: 'Over your price limit' }, PRICE_TAMPERED: { group: 'Your limits', pass: 'Catalogue price is unchanged', fail: 'Proposed price differs from catalogue' },
    QUANTITY_EXCEEDED: { group: 'Your limits', pass: 'Quantity is within your limit', fail: 'Quantity exceeds your limit' }, BUNDLE_NOT_ALLOWED: { group: 'Your limits', pass: 'Not a bundle, or bundles are allowed', fail: 'Bundles are not allowed' }, BUNDLE_UNKNOWN: { group: 'Your limits', pass: 'Bundle status is known', fail: 'Bundle status is unknown' }, ADDON_NOT_ALLOWED: { group: 'Your limits', pass: 'No extra items', fail: 'Extra items are not allowed' }, MANDATE_INACTIVE: { group: 'Your limits', pass: 'Your mandate is active and current', fail: 'Your mandate is not active' }, MANDATE_EXPIRED: { group: 'Your limits', pass: 'Your mandate is active and current', fail: 'Your mandate has expired' }, MANDATE_STALE: { group: 'Your limits', pass: 'Your mandate is active and current', fail: 'Your mandate changed after this proposal' }, CURRENCY_MISMATCH: { group: 'Your limits', pass: 'Priced in USD', fail: 'Currency does not match your mandate' },
    MERCHANT_NOT_ALLOWED: { group: 'The store', pass: 'Store is on your approved list', fail: 'Store is not on your approved list' }, DOMAIN_NOT_ALLOWED: { group: 'The store', pass: 'Store address is allowed', fail: 'Store address is not on your approved list' }, FIRST_PARTY_REQUIRED: { group: 'The store', pass: 'Sold by the store itself', fail: 'Not sold by the store itself' }, OUT_OF_STOCK: { group: 'The store', pass: 'In stock', fail: 'Not in stock' },
    INVALID_INPUT: { group: 'The listing', pass: 'Product data is valid', fail: 'Product data is invalid' }, EXTRACTOR_FAILED: { group: 'The listing', pass: 'Listing was analyzed', fail: 'Listing could not be analyzed' }, LOW_CONFIDENCE: { group: 'The listing', pass: 'Analysis confidence is sufficient', fail: 'Analysis confidence is low' }, CATEGORY_MISMATCH: { group: 'The listing', pass: 'Matches what you asked for', fail: 'Does not match what you asked for' }, TEXT_PRICE_CONFLICT: { group: 'The listing', pass: 'Price matches the listing text', fail: 'Price conflicts with the listing text' }, INJECTION_DETECTED: { group: 'The listing', pass: 'No instructions aimed at AI agents', fail: 'Instructions aimed at AI agents were found' }, HIDDEN_CONTENT: { group: 'The listing', pass: 'No hidden text', fail: 'Hidden text was found' }, URGENCY_PRESSURE: { group: 'The listing', pass: 'No pressure tactics', fail: 'Listing pressures immediate action' }, DUPLICATE: { group: 'Your limits', pass: 'Item has not already been purchased', fail: 'Item was already purchased under this mandate' },
  };
  const checks = new Map<string, { passed: boolean; source: string }>();
  for (const check of candidate.checks ?? []) { const prior = checks.get(check.code); checks.set(check.code, { passed: prior ? prior.passed && check.passed : check.passed, source: check.source }); }
  const mandateCodes = new Set(['MANDATE_INACTIVE', 'MANDATE_EXPIRED', 'MANDATE_STALE']);
  const rows = [...checks.entries()].filter(([code]) => !mandateCodes.has(code)).map(([code, check]) => ({ code, ...check, ...(checkCopy[code] ?? { group: 'The listing', pass: code.replaceAll('_', ' ').toLowerCase(), fail: candidate.reasons.find(reason => reason.code === code)?.message ?? code.replaceAll('_', ' ').toLowerCase() }) }));
  const mandateState = [...checks.entries()].filter(([code]) => mandateCodes.has(code));
  if (mandateState.length) {
    const failed = mandateState.find(([, check]) => !check.passed);
    const failedCode = failed?.[0];
    rows.push({ code: failedCode ?? 'MANDATE_STATE', passed: !failed, source: 'deterministic', group: 'Your limits',
      pass: 'Your mandate is active and current', fail: failedCode ? checkCopy[failedCode].fail : 'Your mandate is not active' });
  }
  const grouped = ['Your limits', 'The store', 'The listing'].map(group => ({ group, rows: rows.filter(row => row.group === group).sort((a, b) => Number(a.passed) - Number(b.passed)) })).filter(group => group.rows.length);
  const alternatives = candidate.alternatives?.filter(item => item.decision === 'ALLOW') ?? [];
  const transition = { duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut };
  const title = `Why this was ${candidate.decision === 'ALLOW' ? 'allowed' : candidate.decision === 'BLOCK' ? 'blocked' : 'needs review'}`;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Portal forceMount><AnimatePresence initial={false}>
    <Dialog.Overlay forceMount asChild><motion.div className="console-dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} /></Dialog.Overlay>
    <Dialog.Content forceMount asChild><motion.div className="console-drawer rules-sheet rules-sheet-v7" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: '100%' }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: '100%' }} transition={transition}>
      <div className="details-sheet-header"><Dialog.Title className="drawer-title">{title}</Dialog.Title><div><button type="button" aria-label="Previous listing" onClick={() => onMove(-1)} disabled={candidates.length < 2}><ChevronLeft /></button><button type="button" aria-label="Next listing" onClick={() => onMove(1)} disabled={candidates.length < 2}><ChevronRight /></button></div></div>
      <Dialog.Close asChild><button className="drawer-close" aria-label="Close listing details"><X size={20} /></button></Dialog.Close>
      <AnimatePresence mode="wait" initial={false}><motion.div key={candidate.product_id} className="details-sheet-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.2, ease: expoOut }}>
      <div className={`details-verdict decision-${candidate.decision.toLowerCase()}`}><StatusPill status={candidate.decision} /><p>{verdict}</p></div>
      <section className="details-product"><h3><a href={candidate.observation.url} target="_blank" rel="noopener noreferrer">{candidate.observation.title}<ExternalLink size={16} aria-hidden="true" /></a></h3><Tag>{candidate.observation.domain}</Tag><strong><Money cents={candidate.observation.price_cents ?? 0} currency={candidate.observation.currency} /></strong><p>{candidate.observation.source === 'channel3' ? 'Live product' : candidate.observation.source === 'curated' ? 'Demo store' : 'Product page'}</p></section>
      <section className="details-checks"><h3>Rules checked</h3>{grouped.map(group => <div key={group.group}><h4>{group.group}</h4><div className="details-check-grid">{group.rows.map(row => { const severity = candidate.reasons.find(reason => reason.code === row.code)?.severity; return <div key={row.code} className={`details-check ${row.passed ? 'details-check-passed' : severity === 'BLOCK' ? 'details-check-failed-block' : 'details-check-failed'}`}><span className="details-check-copy">{row.passed ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}<span>{row.passed ? row.pass : row.fail}{!row.passed && <code>{row.code}</code>}</span></span></div>; })}</div></div>)}</section>
      <section className="details-listing"><h3>What the listing said</h3>{flagged.injection || flagged.hidden_text || flagged.urgency || flagged.price_conflict ? <>{extraction?.evidence?.length ? <>{extraction.evidence.map((quote, i) => <blockquote className="evidence-quote mono" key={`${i}-${quote}`}>{quote}</blockquote>)}<Tag variant="sandbox">Untrusted</Tag><p>Seller text is treated as untrusted data. These instructions were not followed.</p></> : <p>No quoted evidence was returned for the flagged listing text.</p>}</> : <p>No instructions aimed at AI agents were found in this listing.</p>}</section>
      <footer className="details-sheet-footer">{candidate.decision === 'ALLOW' && candidate.checkout_mode === 'gateway' && <Button onClick={() => onBuyNow(candidate)}>Buy now</Button>}<a className="button button-outline button-sm" href={candidate.observation.url} target="_blank" rel="noopener noreferrer" onClick={() => candidate.evaluation_id && void api.handoff(candidate.evaluation_id).catch(() => undefined)}>Open at {candidate.observation.domain}</a>{alternatives.length > 0 && <Button variant="outline" size="sm" onClick={onAlternatives}>See allowed alternatives</Button>}</footer>
      </motion.div></AnimatePresence>
    </motion.div></Dialog.Content>
  </AnimatePresence></Dialog.Portal></Dialog.Root>;
}

function reasonMessage(code: string, product: Product | undefined, limit: number, fallback?: string) {

  if (!product) return fallback ?? code;

  return reasonText[code]?.(product, limit) ?? fallback ?? code;

}



function AuditContent({ copyEvents, copied }: { copyEvents: () => void; copied: boolean }) {

  const store = useStore();

  const motionPrefs = useReducedMotionVariants();

  const listRef = useRef<HTMLDivElement>(null);

  const pinnedToBottom = useRef(true);

  const knownIds = useRef(new Set<number>());

  const initialized = useRef(false);

  const [newIds, setNewIds] = useState<Set<number>>(new Set());

  useEffect(() => {

    if (store.loading.audit) return;

    const events = [...store.auditEvents].sort((a, b) => a.id - b.id);

    if (!initialized.current) { events.forEach(event => knownIds.current.add(event.id)); initialized.current = true; return; }

    const fresh = events.filter(event => !knownIds.current.has(event.id));

    events.forEach(event => knownIds.current.add(event.id));

    if (!fresh.length) return;

    setNewIds(previous => new Set([...previous, ...fresh.map(event => event.id)]));

    const timer = window.setTimeout(() => setNewIds(previous => new Set([...previous].filter(id => !fresh.some(event => event.id === id)))), 1500);

    return () => window.clearTimeout(timer);

  }, [store.auditEvents, store.loading.audit]);

  useEffect(() => { if (pinnedToBottom.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [store.auditEvents]);

  const events = [...store.auditEvents].sort((a, b) => a.id - b.id);

  return <>

    <div className="audit-heading"><h2 className="audit-title">Audit trail</h2></div>

    <AnimatePresence initial={false}>{store.errors.audit && <InlineError key="audit-error" message={store.errors.audit.message} retry={() => void store.refreshAudit().catch(() => undefined)} onClose={() => store.clearError('audit')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>

    {store.loading.audit && <Skeleton width="100%" height={48} label="Loading audit trail" />}

    <div ref={listRef} className="audit-events" onScroll={event => { const el = event.currentTarget; pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32; }} aria-live="polite">

      {!store.loading.audit && events.length === 0 ? <EmptyState sentence="Events appear here as the agent acts." /> : events.map(event => <AuditRow event={event} key={event.id} highlighted={newIds.has(event.id)} reduced={motionPrefs.prefersReducedMotion} />)}

    </div>

    <div className="audit-footer"><p className={store.chainOk ? 'chain-state chain-valid' : store.chainOk === false ? 'chain-state chain-invalid' : 'chain-state'}>{store.chainOk ? <Check size={16} /> : <AlertCircle size={16} />}{store.chainOk ? 'Hash chain verified' : store.chainOk === false ? 'Chain broken' : 'Verifying hash chain'}</p><Button size="sm" variant="outline" onClick={copyEvents}><Copy size={16} />{copied ? 'Copied' : 'Copy as JSON'}</Button></div>

  </>;

}



function AuditRow({ event, highlighted, reduced }: { event: AuditEvent; highlighted: boolean; reduced: boolean }) {

  const store = useStore();

  const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};

  const productId = typeof payload.product_id === 'string' ? payload.product_id : '';

  const detailProduct = (store.catalogue?.products ?? fixtureProducts).find(product => product.product_id === productId);

  const detailCandidate = store.runs.protected?.candidates.find(candidate => candidate.product_id === productId);

  const checks = Array.isArray(payload.checks) ? payload.checks as { passed?: boolean }[] : [];

  const detail = detailCandidate?.observation.title ?? detailProduct?.title

    ?? (event.event_type === 'VERIFICATION_RESULT' && checks.length ? `${checks.filter(check => check.passed).length} of ${checks.length} checks passed`

      : typeof payload.decision === 'string' ? payload.decision

        : typeof payload.source === 'string' ? `${payload.source} proposal`

          : typeof payload.total_cents === 'number' ? `Total ${formatMoney(payload.total_cents)}`

            : event.proposal_id ? `Proposal ${event.proposal_id.slice(0, 8)}` : event.mandate_id ? `Mandate ${event.mandate_id.slice(0, 8)}` : '');

  const label = eventLabels[event.event_type] ?? event.event_type.toLowerCase().replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());

  return <motion.article className="audit-event" initial={false} animate={highlighted ? reduced ? { opacity: [0, 1] } : { backgroundColor: ['var(--color-review-bg)', 'transparent'] } : {}} transition={reduced ? { duration: 0.15 } : { backgroundColor: { duration: 1.5 } }}><div className="audit-event-heading"><time className="audit-time mono">{new Date(event.ts).toLocaleTimeString('en-US', { hour12: false })}</time><strong>{label}</strong></div><p className="audit-event-detail">{detail}</p><div className="audit-meta"><Tag>{event.actor}</Tag><span className="audit-hash mono" aria-label={`Event hash ${event.hash}`}>{event.hash.slice(0, 8)}</span></div></motion.article>;

}



function CheckoutDrawer() {

  const store = useStore();

  const motionPrefs = useReducedMotionVariants();

  const proposal = store.proposal;

  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {

    if (store.captureResult?.status !== 'CAPTURED' || !proposal) { setReceipt(null); return; }

    let live = true;

    void api.getReceipt(proposal.proposal_id).then(value => { if (live) setReceipt(value); }).catch(() => undefined);

    return () => { live = false; };

  }, [store.captureResult?.status, proposal?.proposal_id]);

  const product = proposal?.items[0] ? (store.catalogue?.products ?? fixtureProducts).find(item => item.product_id === proposal.items[0].sku) : undefined;

  const proposalCandidate = proposal?.items[0] ? store.runs.protected?.candidates.find(candidate => candidate.product_id === proposal.items[0].sku) : undefined;

  const liveListing = proposal?.sandbox_listing ?? (proposalCandidate?.observation.source === 'channel3' ? {

    source: 'channel3' as const, title: proposalCandidate.observation.title, url: proposalCandidate.observation.url,

    domain: proposalCandidate.observation.domain, merchant_name: proposalCandidate.observation.seller,

  } : undefined);

  const sandboxDemoPayment = proposal?.sandbox_demo_payment === true;

  const merchant = proposal ? (store.catalogue?.merchants ?? fixtureMerchants).find(item => item.merchant_id === proposal.merchant_id) : undefined;

  const drawerTransition = { duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut };

  return <Dialog.Root open={store.drawerOpen} onOpenChange={open => open ? store.openCheckout() : store.closeCheckout()}>

    <Dialog.Portal forceMount><AnimatePresence initial={false}>{store.drawerOpen && <>

      <Dialog.Overlay forceMount asChild><motion.div className="console-dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={drawerTransition} /></Dialog.Overlay>

      <Dialog.Content forceMount asChild><motion.div className="console-drawer checkout-drawer" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: '100%' }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: '100%' }} transition={drawerTransition}>

      <Dialog.Title className="drawer-title">PayPal sandbox checkout</Dialog.Title><Dialog.Close asChild><button className="drawer-close" aria-label="Close checkout"><X size={20} /></button></Dialog.Close>

      {proposal && <KeyValueList rows={[

        { label: 'Item', value: product ? <ProductLink title={product.title} url={runObservationFor(store.runs.protected, product.product_id)?.url ?? product.url} domain={runObservationFor(store.runs.protected, product.product_id)?.domain ?? product.domain ?? 'demo storefront'} /> : liveListing ? <ProductLink title={liveListing.title} url={liveListing.url} domain={liveListing.domain} /> : proposal.items[0]?.name },

        { label: 'Merchant', value: liveListing?.merchant_name ?? merchant?.name ?? proposal.merchant_id },

        { label: 'Quantity', value: proposal.items.reduce((sum, item) => sum + item.quantity, 0) },

        { label: 'Total', value: <Money cents={proposal.total_cents} currency={proposal.currency} /> },

        { label: 'Mandate version', value: proposal.mandate_version },

      ]} />}

        {proposal?.payment_mode === 'sandbox_simulation' && <div className="sandbox-demo-notice" role="note"><p>{proposal.disclosure ?? `PayPal sandbox simulation. MandateGuard created a sandbox order for this product. Nothing is purchased from ${liveListing?.domain ?? 'the store'} and no real money moves.`}</p></div>}

        {proposal?.checkout_mode === 'gateway' && <div className="sandbox-demo-notice" role="note"><p>This is a sandbox order on the MandateGuard demo store. No real purchase or shipment happens.</p></div>}

        {proposal && <p className="checkout-copy">PayPal approval is your confirmation. The server re-checks everything before capture.</p>}

        {proposal?.payment_mode === 'sandbox_simulation' && liveListing?.url && <a className="button button-outline button-md sandbox-retailer-link" href={liveListing.url} target="_blank" rel="noopener noreferrer">Open retailer listing<ExternalLink size={16} aria-hidden="true" /></a>}

      <AnimatePresence initial={false}>{store.errors.checkout && <InlineError key="checkout-error" message={store.errors.checkout.message} retry={() => void store.createCheckout()} onClose={() => store.clearError('checkout')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>

      <AnimatePresence initial={false}>{store.errors.capture && <InlineError key="capture-error" message={store.errors.capture.message} retry={() => proposal?.paypal_order_id && void store.capture(proposal.paypal_order_id)} onClose={() => store.clearError('capture')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>

        {proposal?.source === 'protected' && <PayPalCheckout proposalId={proposal.proposal_id} disabled={store.captureResult?.status === 'CAPTURED'} busy={store.loading.checkout || store.loading.capture} onCreateOrder={store.createCheckout} onCapture={store.capture} />}

      {receipt ? <ReceiptDisplay receipt={receipt} done={store.closeCheckout} /> : store.captureResult && <CaptureDisplay result={store.captureResult} orderId={proposal?.paypal_order_id ?? ''} sandboxDemo={sandboxDemoPayment} />}

      </motion.div></Dialog.Content>

    </>}</AnimatePresence></Dialog.Portal>

  </Dialog.Root>;

}



function ReceiptDisplay({ receipt, done }: { receipt: Receipt; done: () => void }) {

  const download = () => {

    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });

    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `mandateguard-receipt-${receipt.proposal_id}.json`; anchor.click(); URL.revokeObjectURL(url);

  };

  return <section className="capture-result capture-ok" aria-live="polite">

    <div className="capture-title"><CheckCircle2 size={20} />Sandbox receipt</div>

    <Tag variant={receipt.simulated ? 'sandbox' : 'brand'}>{receipt.simulated ? 'Simulation' : 'Demo store'}</Tag>

    <p className="sandbox-demo-notice">Payment captured. {receipt.disclosure}</p>

    <KeyValueList rows={[{ label: 'Product', value: <ProductLink title={receipt.product.title} url={receipt.product.url} domain={receipt.product.domain} /> }, { label: 'Price', value: <Money cents={receipt.product.price_cents} currency={receipt.product.currency} /> }, { label: 'Store', value: receipt.product.domain }, { label: 'PayPal order id', value: <Mono copyable>{receipt.paypal.order_id}</Mono> }, { label: 'Capture id', value: <Mono copyable>{receipt.paypal.capture_id ?? 'Unavailable'}</Mono> }]} />

    <details><summary>Show verification</summary><div className="verification-table-wrap"><table className="verification-table"><tbody>{receipt.checks.map(check => <tr key={check.id}><td><Mono>{check.id}</Mono></td><td>{check.passed ? 'Passed' : 'Failed'}</td><td>{check.detail}</td></tr>)}</tbody></table></div></details>

    <p>{receipt.audit.chain_ok ? 'Audit trail verified' : 'Chain broken'}</p>

    <div className="dialog-actions"><Button variant="outline" onClick={download}>Download receipt (JSON)</Button><Button onClick={done}>Done</Button></div>

    <a href={`#/audit?proposal_id=${encodeURIComponent(receipt.proposal_id)}`}>Open in audit trail</a>

  </section>;

}



function CaptureDisplay({ result, orderId, sandboxDemo = false }: { result: NonNullable<ReturnType<typeof useStore>['captureResult']>; orderId: string; sandboxDemo?: boolean }) {

  const captured = result.status === 'CAPTURED';

  return <section className={`capture-result ${captured ? 'capture-ok' : 'capture-failed'}`} aria-live="polite">

    <div className="capture-title">{captured ? <><CheckCircle2 size={20} />{sandboxDemo ? 'Sandbox payment captured' : 'Payment captured'}</> : <><Ban size={20} />{sandboxDemo ? 'Sandbox payment was not captured' : 'Payment was not captured'}</>}</div>

    {captured && result.capture && <KeyValueList rows={[

      { label: 'PayPal order id', value: <Mono copyable>{orderId}</Mono> },

      { label: 'Capture id', value: <Mono copyable>{result.capture.id}</Mono> },

      { label: 'Amount', value: <Money cents={Math.round(Number(result.capture.amount) * 100)} /> },

    ]} />}

    <div className="verification-table-wrap"><table className="verification-table"><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>{result.checks.map(check => <tr key={check.id}><td><Mono>{check.id}</Mono><small>{checkLabels[check.id] ?? check.id}</small></td><td>{check.passed ? <span className="check-passed"><Check size={16} />Passed</span> : <span className="check-failed"><X size={16} />Failed</span>}</td><td>{check.detail}</td></tr>)}</tbody></table></div>

  </section>;

}
