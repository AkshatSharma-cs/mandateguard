import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Ban, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardList, Copy, ExternalLink, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button, EmptyState, KeyValueList, Money, Mono, Panel, Skeleton, SourceTag, StatusPill, Tag, Textarea } from '../components/ui';
import PayPalCheckout from '../components/PayPalCheckout';
import { useStore } from '../state/store';
import { api } from '../api/client';
import { merchants as fixtureMerchants, products as fixtureProducts, verificationLabels } from '../api/fixtures';
import type { Alternative, AuditEvent, Candidate, Product, ProductObservation, RunResult } from '../types';
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

function ListingSource({ source }: { source: ProductObservation['source'] }) {
  return <Tag variant={source === 'channel3' ? 'brand' : 'neutral'}>{source === 'channel3' ? 'Live' : source === 'curated' ? 'Demo store' : 'Page'}</Tag>;
}

function runObservationFor(run: RunResult | null, productId: string): ProductObservation | undefined {
  return run?.candidates.find(candidate => candidate.product_id === productId)?.observation;
}

export default function ConsolePage() {
  const store = useStore();
  const motionPrefs = useReducedMotionVariants();
  const [instruction, setInstruction] = useState('');
  const [hasDefaultProfile, setHasDefaultProfile] = useState(false);
  const [expandedId, setExpandedId] = useState('');
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditJsonCopied, setAuditJsonCopied] = useState(false);
  const mandate = store.mandate;

  useEffect(() => {
    const firstInjection = store.runs.protected?.candidates.find(candidate => candidate.decision === 'BLOCK' && candidate.reasons.some(reason => reason.code === 'INJECTION_DETECTED'));
    if (firstInjection) setExpandedId(firstInjection.product_id);
  }, [store.runs.protected?.run_id]);
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
      <header className="console-heading"><h1>Console</h1><Tag variant="sandbox">Sandbox</Tag><a className="preferences-shortcut" href="#/preferences">Preferences</a></header>
      <div className="console-grid">
        <Panel className="console-panel mandate-panel" title="Mandate" headingLevel={2}>
          {!mandate ? <form onSubmit={event => void createMandate(event)}>
            <Textarea id="mandate-instruction" label="What are you shopping for?" rows={3} value={instruction} onChange={event => setInstruction(event.target.value)} disabled={store.loading.parse} />
            {hasDefaultProfile && <p className="profile-usage"><Tag variant="brand">Using your preferences</Tag> <a href="#/preferences">Preferences</a></p>}
            <button type="button" className="console-example" onClick={() => setInstruction('Find a wireless keyboard under $50. Only approved merchants. No bundles.')}>Find a wireless keyboard under $50. Only approved merchants. No bundles.</button>
            <Button type="submit" size="md" disabled={!instruction.trim() || store.loading.parse}>{store.loading.parse ? 'Creating…' : 'Create mandate'}</Button>
            <AnimatePresence initial={false}>{store.errors.parse && <InlineError key="parse-error" message={store.errors.parse.message} retry={() => void store.parseMandate(instruction)} onClose={() => store.clearError('parse')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>
          </form> : <MandateDetails />}
          {store.loading.catalogue && <div className="catalogue-loading"><Skeleton width="100%" /><Skeleton width="72%" /></div>}
          <AnimatePresence initial={false}>{store.errors.catalogue && <InlineError key="catalogue-error" message={store.errors.catalogue.message} retry={() => void store.loadCatalogue()} onClose={() => store.clearError('catalogue')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>
        </Panel>

        <Panel className="console-panel agent-panel" title="Agent run" headingLevel={2} action={<div className="agent-panel-actions"><Button className="console-audit-trigger" variant="outline" size="md" onClick={() => setAuditOpen(true)}><ClipboardList size={16} aria-hidden="true" />Audit trail</Button><Button size="md" onClick={() => void run()} disabled={mandate?.status !== 'active' || store.loading.run}>{store.loading.run ? 'Running…' : 'Run both'}</Button></div>}>
          <AnimatePresence initial={false}>{store.errors.run && <InlineError key="run-error" message={store.errors.run.message} retry={() => void run()} onClose={() => store.clearError('run')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>
          {store.loading.run && <RunSkeleton />}
          {!store.loading.run && !store.runs.naive && !store.runs.protected && <EmptyState sentence="Confirm a mandate, then run both agents." />}
          {!store.loading.run && store.runs.naive && store.runs.protected && <div className="agent-columns" aria-live="polite">
            <ProtectedRun run={store.runs.protected} expandedId={expandedId} onExpand={id => setExpandedId(current => current === id ? '' : id)} onCheckout={store.openCheckout} paid={store.captureResult?.status === 'CAPTURED'} />
            <NaiveRun run={store.runs.naive} />
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

    <Dialog.Root open={revokeOpen} onOpenChange={setRevokeOpen}>
      <Dialog.Portal><Dialog.Overlay className="console-dialog-overlay" /><Dialog.Content className="revoke-dialog">
        <Dialog.Title className="text-h3">Revoke mandate?</Dialog.Title><Dialog.Description>This mandate will no longer be available for protected agent runs.</Dialog.Description>
        <div className="dialog-actions"><Button variant="secondary" onClick={() => setRevokeOpen(false)}>Cancel</Button><Button variant="danger-outline" disabled={store.loading.revoke} onClick={() => void revoke()}>{store.loading.revoke ? 'Revoking…' : 'Revoke'}</Button></div>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;

  function MandateDetails() {
    const current = mandate!;
    const merchantNames = current.allowed_merchant_ids.map(id => store.catalogue?.merchants.find(merchant => merchant.merchant_id === id)?.name ?? id);
    return <>
      {current.kind === 'profile' ? <p className="profile-usage"><Tag variant="brand">Using your preferences</Tag></p> : <blockquote className="mandate-instruction">{current.original_instruction}</blockquote>}
      <KeyValueList rows={[
        ...(current.kind === 'task' ? [{ label: 'Category', value: current.item_category ?? current.item_query ?? 'Task' }] : []),
        { label: 'Max total', value: <Money cents={current.max_total_cents} currency={current.currency} /> },
        { label: current.allowed_domains.length ? 'Approved websites' : 'Approved merchants', value: current.allowed_domains.join(', ') || merchantNames.join(', ') || 'None' },
        { label: 'Bundles allowed', value: current.allow_bundles ? 'Yes' : 'No' },
        { label: 'Add-ons allowed', value: current.allow_addons ? 'Yes' : 'No' },
        { label: 'Require sold by the merchant itself', value: current.require_first_party ? 'Yes' : 'No' },
        { label: 'Expires', value: new Date(current.expires_at).toLocaleString() },
      ]} />
      <MandateStatus status={current.status} />
      {current.status === 'active' && current.confirmed_by?.startsWith('profile:') && <p className="profile-usage">Active: within your preferences</p>}
      {current.status === 'pending_confirmation' && <>{store.exceeded.length > 0 && <div className="profile-exceeded"><strong>This goes beyond your preferences</strong><ul>{store.exceeded.map(item => <li key={item}>{item.replaceAll('_', ' ')}</li>)}</ul></div>}<div className="mandate-actions"><Button size="md" disabled={store.loading.confirm} onClick={() => void confirm()}>{store.loading.confirm ? 'Confirming…' : 'Confirm mandate'}</Button><Button size="md" variant="secondary" onClick={store.discardMandate}>Discard</Button></div><p className="mandate-pending-note">Nothing is purchased until you confirm.</p></>}
      {current.status === 'active' && <><p className="confirmed-time">Confirmed {current.confirmed_at ? new Date(current.confirmed_at).toLocaleString() : ''}</p><div className="mandate-actions"><Button size="md" variant="danger-outline" onClick={() => setRevokeOpen(true)}>Revoke</Button><Button size="md" variant="outline" disabled={store.loading.revoke} onClick={() => void replaceMandate()}>Replace mandate</Button></div></>}
      {current.status === 'revoked' && <Button size="md" variant="outline" onClick={() => { store.discardMandate(); setInstruction(''); }}>Start a new mandate</Button>}
      {(['confirm', 'revoke'] as const).map(action => <AnimatePresence key={action} initial={false}>{store.errors[action] && <InlineError key={`${action}-error`} message={store.errors[action]!.message} retry={() => void (action === 'confirm' ? confirm() : revoke())} onClose={() => store.clearError(action)} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>)}
    </>;
  }
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

function NaiveRun({ run }: { run: RunResult }) {
  const store = useStore();
  const proposal = run.proposal;
  const catalogProducts = store.catalogue?.products ?? fixtureProducts;
  const catalogProduct = proposal?.items[0] ? catalogProducts.find(product => product.product_id === proposal.items[0].sku) : undefined;
  const candidate = run.candidates.find(item => item.product_id === proposal?.items[0]?.sku);
  if (!proposal) return <section className="agent-column"><h3 className="text-h3">Without MandateGuard</h3><EmptyState sentence="The agent returned no proposal." /></section>;
  return <section className="agent-column naive-column">
    <h3 className="agent-column-title">Without MandateGuard</h3><p className="agent-caption">Unprotected agent. The policy engine only observes.</p>
    <div className="console-table-wrap"><table className="console-table"><thead><tr><th>Product</th><th className="numeric">Price</th><th className="numeric">Quantity</th></tr></thead><tbody>{proposal.items.map((item, index) => {
      const itemCandidate = run.candidates.find(entry => entry.product_id === item.sku);
      const itemProduct = catalogProducts.find(product => product.product_id === item.sku);
      const itemTitle = itemProduct?.title ?? itemCandidate?.observation.title ?? item.name;
      const itemDomain = itemCandidate?.observation.domain ?? itemProduct?.domain ?? 'store';
      return <tr key={`${item.sku}-${index}`}><td>{itemCandidate?.observation.url || itemProduct?.url ? <ProductLink title={itemTitle} url={itemCandidate?.observation.url ?? itemProduct?.url} domain={itemDomain} /> : itemTitle}{itemCandidate?.observation && <ListingSource source={itemCandidate.observation.source} />}<small>{item.sku}</small></td><td className="numeric"><Money cents={item.unit_price_cents} currency={proposal.currency} /></td><td className="numeric">{item.quantity}</td></tr>;
    })}</tbody></table></div>
    {run.naive_reasoning && <blockquote className="reasoning-quote">{run.naive_reasoning}</blockquote>}
    <div className="unauthorized-notice"><strong>Would be unauthorized</strong><p>{candidate?.reasons.map(reason => reasonMessage(reason.code, catalogProduct, 3000, reason.message)).join(' ') || 'The proposal is outside the mandate.'}</p></div>
    <div className="unsafe-total"><span>Total</span><Money cents={proposal.total_cents} currency={proposal.currency} /></div>
    <Tag>Simulated, not executed</Tag>
  </section>;
}

function ProtectedRun({ run, expandedId, onExpand, onCheckout, paid }: { run: RunResult; expandedId: string; onExpand: (id: string) => void; onCheckout: () => void; paid: boolean }) {
  const store = useStore();
  const motionPrefs = useReducedMotionVariants();
  const [showEvidence, setShowEvidence] = useState(false);
  const productsById = useMemo(() => new Map((store.catalogue?.products ?? fixtureProducts).map(product => [product.product_id, product])), [store.catalogue]);
  const candidates = [...run.candidates].sort((a, b) => ({ ALLOW: 0, REVIEW: 1, BLOCK: 2 }[a.decision] - { ALLOW: 0, REVIEW: 1, BLOCK: 2 }[b.decision]));
  const allowedAlternatives = (run.allowed_alternative_ids ?? []).map(id => run.candidates.find(candidate => candidate.evaluation_id === id)).filter((candidate): candidate is Candidate => Boolean(candidate));
  const proposal = run.proposal;
  const proposalProduct = proposal?.items[0] ? productsById.get(proposal.items[0].sku) : undefined;
  const proposalCandidate = proposal?.items[0] ? run.candidates.find(candidate => candidate.product_id === proposal.items[0].sku) : undefined;
  const hasAttention = candidates.some(candidate => candidate.decision !== 'ALLOW');
  if (!hasAttention && proposal) {
    const item = proposal.items[0];
    const candidate = candidates.find(value => value.product_id === item?.sku);
    const observation = candidate?.observation;
    return <section className="agent-column protected-column">
      <h3 className="agent-column-title">With MandateGuard</h3>
      <div className="quiet-allowed"><StatusPill status="ALLOW" /><ProductLink title={observation?.title ?? item?.name ?? 'Product'} url={observation?.url} domain={observation?.domain ?? 'approved merchant'} />{observation && <ListingSource source={observation.source} />}<span><Money cents={proposal.total_cents} currency={proposal.currency} /></span><p>Matches your preferences</p><div className="quiet-actions">{proposalProduct ? <Button size="md" disabled={paid} onClick={onCheckout}>{paid ? 'Paid' : 'Review and pay'}</Button> : observation?.url && <a className="button button-outline button-md" href={observation.url} target="_blank" rel="noopener noreferrer">Open store listing<ExternalLink size={16} aria-hidden="true" /></a>}<button className="text-action" type="button" aria-expanded={showEvidence} onClick={() => setShowEvidence(value => !value)}>{showEvidence ? 'Hide evidence' : 'Show evidence'}</button></div>{!proposalProduct && <p className="merchant-checkout-note">Checkout takes place on the merchant site and is outside MandateGuard.</p>}
      <AnimatePresence initial={false}>{showEvidence && candidate && <motion.div className="candidate-details" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut }}>{candidate.checks?.map(check => <p key={check.code}>{check.passed ? 'Passed' : 'Failed'}: {check.code.replaceAll('_', ' ')}</p>)}{candidate.extraction?.evidence.map((quote, index) => <blockquote className="evidence-quote mono" key={`${index}-${quote}`}>{quote}</blockquote>)}</motion.div>}</AnimatePresence></div>
    </section>;
  }
  return <section className="agent-column protected-column">
    <h3 className="agent-column-title">With MandateGuard</h3><p className="agent-caption">Every listing is analyzed as untrusted data, then checked against your mandate.</p>
    {candidates.length === 0 ? <EmptyState sentence={run.discovery_provider === 'channel3' ? 'No live marketplace listings matched this search.' : 'No live marketplace listings were returned. Check Channel3 setup or try another search.'} /> : <div className="console-table-wrap"><table className="console-table"><thead><tr><th>Product</th><th className="numeric">Price</th><th>Decision</th></tr></thead><tbody>{candidates.map(candidate => {
      const product = productsById.get(candidate.product_id);
      const expanded = expandedId === candidate.product_id;
      const candidateAlternatives = candidate.alternatives?.length ? candidate.alternatives : allowedAlternatives.filter(item => item.evaluation_id && item.observation.title.toLowerCase() !== candidate.observation.title.toLowerCase() && item.observation.domain !== candidate.observation.domain && (!candidate.observation.category_hint || item.observation.category_hint === candidate.observation.category_hint)).slice(0, 3).map(item => ({ evaluation_id: item.evaluation_id!, observation: item.observation, decision: 'ALLOW' as const, reasons: [] }));
      return <FragmentRows key={candidate.product_id} candidate={candidate} product={product} merchantName={store.catalogue?.merchants.find(merchant => merchant.merchant_id === product?.merchant_id)?.name ?? candidate.observation.seller} expanded={expanded} onExpand={() => onExpand(candidate.product_id)} allowedAlternatives={candidate.decision === 'ALLOW' ? [] : candidateAlternatives} />;
    })}</tbody></table></div>}
    {proposal ? <div className="proposal-bar"><div className="proposal-description">{proposalCandidate?.observation.url ? <><ProductLink title={proposalCandidate.observation.title} url={proposalCandidate.observation.url} domain={proposalCandidate.observation.domain} /><ListingSource source={proposalCandidate.observation.source} /></> : proposalProduct ? <ProductLink title={proposalProduct.title} url={proposalProduct.url} domain={proposalProduct.domain ?? 'store'} /> : <strong>{proposal.items.map(item => item.name).join(', ')}</strong>}<span>{proposalCandidate?.observation.seller ?? store.catalogue?.merchants.find(merchant => merchant.merchant_id === proposal.merchant_id)?.name ?? proposal.merchant_id} · <Money cents={proposal.total_cents} currency={proposal.currency} /></span></div><StatusPill status="ALLOW" />{proposalProduct ? <Button size="md" disabled={paid || proposal.source === 'naive'} onClick={onCheckout}>{paid ? 'Paid' : 'Review and pay'}</Button> : proposalCandidate?.observation.url && <a className="button button-outline button-md" href={proposalCandidate.observation.url} target="_blank" rel="noopener noreferrer">Open store listing<ExternalLink size={16} aria-hidden="true" /></a>}</div> : <EmptyState sentence="No listing passed your mandate. Nothing will be purchased." />}
  </section>;
}

function FragmentRows({ candidate, product, merchantName, expanded, onExpand, allowedAlternatives = [] }: { candidate: Candidate; product?: Product; merchantName?: string; expanded: boolean; onExpand: () => void; allowedAlternatives?: Alternative[] }) {
  const store = useStore();
  const mandateLimit = store.mandate?.max_total_cents ?? 3000;
  const motionPrefs = useReducedMotionVariants();
  const expandTransition = { duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut };
  return <>
    <tr className="candidate-row"><td><ProductLink title={candidate.observation.title ?? product?.title ?? candidate.product_id} url={candidate.observation.url ?? product?.url} domain={candidate.observation.domain ?? product?.domain ?? 'store'} /><ListingSource source={candidate.observation.source} /><button className="candidate-expand" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} evidence for ${candidate.observation.title ?? product?.title ?? candidate.product_id}`} onClick={onExpand}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{expanded ? 'Hide evidence' : 'Show evidence'}</button><small>{merchantName ?? (product ? fixtureMerchants.find(merchant => merchant.merchant_id === product.merchant_id)?.name : candidate.observation.seller ?? candidate.product_id)}</small></td><td className="numeric"><Money cents={candidate.observation.price_cents ?? product?.price_cents ?? 0} currency={candidate.observation.currency ?? product?.currency ?? 'USD'} /></td><td><StatusPill status={candidate.decision} /></td></tr>
    <AnimatePresence initial={false}>{expanded && <motion.tr className="candidate-details-row" key="details" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={expandTransition}><td colSpan={3}><motion.div className="candidate-details" initial={motionPrefs.prefersReducedMotion ? undefined : { height: 0 }} animate={motionPrefs.prefersReducedMotion ? undefined : { height: 'auto' }} exit={motionPrefs.prefersReducedMotion ? undefined : { height: 0 }} transition={expandTransition}>
      {candidate.reasons.length > 0 && <div className="candidate-reasons">{candidate.reasons.map(reason => <p key={`${reason.code}-${reason.source}`}>{reasonMessage(reason.code, product, mandateLimit, reason.message)}<code>{reason.code}</code><SourceTag children={reason.source === 'ai' ? 'AI' : 'Rule'} /></p>)}</div>}
      {candidate.checks && <div className="rule-checks">{candidate.checks.map(check => <p className={check.passed ? 'rule-check-passed' : 'rule-check-failed'} key={check.code}>{check.passed ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}<span>{check.code.replaceAll('_', ' ')}: {check.passed ? 'Passed' : 'Failed'}</span></p>)}</div>}
      {candidate.extraction?.evidence.length ? <div className="found-instructions"><h4>Instructions found in the listing</h4>{candidate.extraction.evidence.map((quote, index) => <blockquote className="evidence-quote mono" key={`${index}-${quote}`}>{quote}</blockquote>)}<p>Seller text is treated as untrusted data. These instructions were not followed.</p></div> : null}
      {allowedAlternatives.length > 0 && <section className="allowed-alternatives"><h4>Allowed alternatives</h4>{allowedAlternatives.map(alternative => <div className="allowed-alternative" key={alternative.evaluation_id}><ProductLink title={alternative.observation.title} url={alternative.observation.url} domain={alternative.observation.domain} /><span><Money cents={alternative.observation.price_cents} currency={alternative.observation.currency} /></span><Button variant="outline" size="sm" disabled={store.loading.alternative || !alternative.evaluation_id} onClick={() => alternative.evaluation_id && void store.useAlternative(alternative.evaluation_id)}>Use this instead</Button></div>)}</section>}
      {candidate.reasons.length === 0 && !candidate.checks?.length && <EmptyState sentence="No additional checks or reasons were returned." />}
    </motion.div></td></motion.tr>}</AnimatePresence>
  </>;
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
  const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
  const productId = typeof payload.product_id === 'string' ? payload.product_id : '';
  const detailProduct = fixtureProducts.find(product => product.product_id === productId);
  const detail = detailProduct?.title ?? (typeof payload.decision === 'string' ? payload.decision : typeof payload.source === 'string' ? `${payload.source} proposal` : typeof payload.total_cents === 'number' ? `Total ${formatMoney(payload.total_cents)}` : event.proposal_id ?? event.mandate_id ?? '');
  const label = eventLabels[event.event_type] ?? event.event_type.toLowerCase().replaceAll('_', ' ').replace(/^./, char => char.toUpperCase());
  return <motion.article className="audit-event" initial={false} animate={highlighted ? reduced ? { opacity: [0, 1] } : { backgroundColor: ['var(--color-review-bg)', 'transparent'] } : {}} transition={reduced ? { duration: 0.15 } : { backgroundColor: { duration: 1.5 } }}><time className="audit-time mono">{new Date(event.ts).toLocaleTimeString('en-US', { hour12: false })}</time><div className="audit-event-body"><strong>{label}</strong><p>{detail}</p><div className="audit-meta"><Tag>{event.actor}</Tag><Mono>{event.hash.slice(0, 8)}</Mono></div></div></motion.article>;
}

function CheckoutDrawer() {
  const store = useStore();
  const motionPrefs = useReducedMotionVariants();
  const proposal = store.proposal;
  const product = proposal?.items[0] ? (store.catalogue?.products ?? fixtureProducts).find(item => item.product_id === proposal.items[0].sku) : undefined;
  const merchant = proposal ? (store.catalogue?.merchants ?? fixtureMerchants).find(item => item.merchant_id === proposal.merchant_id) : undefined;
  const drawerTransition = { duration: motionPrefs.prefersReducedMotion ? 0.15 : 0.3, ease: expoOut };
  return <Dialog.Root open={store.drawerOpen} onOpenChange={open => open ? store.openCheckout() : store.closeCheckout()}>
    <Dialog.Portal forceMount><AnimatePresence initial={false}>{store.drawerOpen && <>
      <Dialog.Overlay forceMount asChild><motion.div className="console-dialog-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={drawerTransition} /></Dialog.Overlay>
      <Dialog.Content forceMount asChild><motion.div className="console-drawer checkout-drawer" initial={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: '100%' }} animate={motionPrefs.prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 }} exit={motionPrefs.prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: '100%' }} transition={drawerTransition}>
      <Dialog.Title className="drawer-title">Order summary</Dialog.Title><Dialog.Close asChild><button className="drawer-close" aria-label="Close checkout"><X size={20} /></button></Dialog.Close>
      {proposal && <KeyValueList rows={[
        { label: 'Item', value: product ? <ProductLink title={product.title} url={runObservationFor(store.runs.protected, product.product_id)?.url ?? product.url} domain={runObservationFor(store.runs.protected, product.product_id)?.domain ?? product.domain ?? 'demo storefront'} /> : proposal.items[0]?.name },
        { label: 'Merchant', value: merchant?.name ?? proposal.merchant_id },
        { label: 'Quantity', value: proposal.items.reduce((sum, item) => sum + item.quantity, 0) },
        { label: 'Total', value: <Money cents={proposal.total_cents} currency={proposal.currency} /> },
        { label: 'Mandate version', value: proposal.mandate_version },
      ]} />}
        {product && <p className="checkout-copy">PayPal approval is your confirmation. The server re-checks everything before capture.</p>}
        {!product && proposal && <div className="checkout-external"><p>This listing was checked against your mandate. Checkout takes place on the merchant site, outside MandateGuard.</p>{proposalCandidate?.observation.url && <a className="button button-outline button-md" href={proposalCandidate.observation.url} target="_blank" rel="noopener noreferrer">Open store listing<ExternalLink size={16} aria-hidden="true" /></a>}</div>}
      <AnimatePresence initial={false}>{store.errors.checkout && <InlineError key="checkout-error" message={store.errors.checkout.message} retry={() => void store.createCheckout()} onClose={() => store.clearError('checkout')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>
      <AnimatePresence initial={false}>{store.errors.capture && <InlineError key="capture-error" message={store.errors.capture.message} retry={() => proposal?.paypal_order_id && void store.capture(proposal.paypal_order_id)} onClose={() => store.clearError('capture')} reduced={motionPrefs.prefersReducedMotion} />}</AnimatePresence>
        {proposal?.source === 'protected' && product && <PayPalCheckout proposalId={proposal.proposal_id} disabled={store.captureResult?.status === 'CAPTURED'} busy={store.loading.checkout || store.loading.capture} onCreateOrder={store.createCheckout} onCapture={store.capture} />}
      {store.captureResult && <CaptureDisplay result={store.captureResult} orderId={proposal?.paypal_order_id ?? ''} />}
      </motion.div></Dialog.Content>
    </>}</AnimatePresence></Dialog.Portal>
  </Dialog.Root>;
}

function CaptureDisplay({ result, orderId }: { result: NonNullable<ReturnType<typeof useStore>['captureResult']>; orderId: string }) {
  const captured = result.status === 'CAPTURED';
  return <section className={`capture-result ${captured ? 'capture-ok' : 'capture-failed'}`} aria-live="polite">
    <div className="capture-title">{captured ? <><CheckCircle2 size={20} />Payment captured</> : <><Ban size={20} />Payment was not captured</>}</div>
    {captured && result.capture && <KeyValueList rows={[
      { label: 'PayPal order id', value: <Mono copyable>{orderId}</Mono> },
      { label: 'Capture id', value: <Mono copyable>{result.capture.id}</Mono> },
      { label: 'Amount', value: <Money cents={Math.round(Number(result.capture.amount) * 100)} /> },
    ]} />}
    <div className="verification-table-wrap"><table className="verification-table"><thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead><tbody>{result.checks.map(check => <tr key={check.id}><td><Mono>{check.id}</Mono><small>{checkLabels[check.id] ?? check.id}</small></td><td>{check.passed ? <span className="check-passed"><Check size={16} />Passed</span> : <span className="check-failed"><X size={16} />Failed</span>}</td><td>{check.detail}</td></tr>)}</tbody></table></div>
  </section>;
}
