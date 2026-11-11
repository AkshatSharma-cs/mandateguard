import { AlertTriangle, CircleHelp, ShieldCheck } from 'lucide-react';
import type { AgentRun, Candidate, Merchant, Mandate } from '../types';
import type { Product } from '../types';
import { Money, StatusBadge } from './UI';
import { PayPalCheckout } from './PayPalCheckout';

function DecisionChecklist({ candidate }: { candidate: Candidate }) {
  const checks = Array.isArray(candidate.checks) ? candidate.checks : [];
  return <div className="checklist">{checks.length ? checks.map((check, index) => <div key={`${check.code}-${index}`} className="check-row"><span className={`check-mark ${check.passed ? 'passed' : 'failed'}`}>{check.passed ? 'Pass' : 'Fail'}</span><span>{check.code.replaceAll('_', ' ')}</span><span className="check-source">{check.source === 'ai' ? 'AI signal' : 'Policy check'}</span></div>) : <p className="microcopy">No check details were returned.</p>}</div>;
}
function CandidateCard({ candidate, product }: { candidate: Candidate; product?: Product }) {
  const extraction = candidate.extraction;
  return <article className="candidate-card"><div className="candidate-title"><div><div className="eyebrow">{product?.product_id ?? candidate.product_id}</div><h3>{product?.title ?? 'Catalogue item'}</h3></div><StatusBadge status={candidate.decision} /></div>
    {product && <p className="candidate-price"><Money cents={product.price_cents} /> <span>· {product.category} · {product.merchant_id}</span></p>}
    <div className="signal-label"><ShieldCheck size={15} /> Deterministic decision</div><DecisionChecklist candidate={candidate} />
    {candidate.reasons?.length > 0 && <div className="reasons-list"><strong>Reason codes</strong>{candidate.reasons.map((reason, i) => <div key={`${reason.code}-${i}`} className="reason-row"><span>{reason.code}</span><span className="source-tag">{reason.source === 'ai' ? 'AI-derived signal' : 'Policy rule'}</span><p>{reason.message}</p></div>)}</div>}
    {extraction && <details className="evidence-details"><summary>AI extraction evidence</summary><p className="microcopy">AI-derived fields can add REVIEW or BLOCK. They cannot approve a purchase.</p><dl className="evidence-grid"><div><dt>Category label</dt><dd>{extraction.category_label}</dd></div><div><dt>Claimed price</dt><dd>{extraction.claimed_price_cents == null ? 'Not stated' : <Money cents={extraction.claimed_price_cents} />}</dd></div><div><dt>Seller directives</dt><dd>{extraction.directives_to_agent ? 'Detected' : 'Not detected'}</dd></div><div><dt>Authority override</dt><dd>{extraction.asserts_authority_override ? 'Detected' : 'Not detected'}</dd></div><div><dt>Urgency pressure</dt><dd>{extraction.urgency_pressure ? 'Detected' : 'Not detected'}</dd></div><div><dt>Confidence</dt><dd>{Math.round(extraction.confidence * 100)}%</dd></div></dl><ul>{(extraction.evidence ?? []).map((quote, i) => <li key={i}>“{quote}”</li>)}</ul></details>}
  </article>;
}
export function NaiveAgentPanel({ run, onRun, busy, error }: { run?: AgentRun; onRun: () => void; busy: boolean; error?: string }) {
  const items = Array.isArray(run?.proposal?.items) ? run.proposal.items : [];
  return <section className="agent-panel naive-panel"><div className="panel-kicker"><AlertTriangle size={17} /> Unprotected demo — unsafe by design</div><h2>Naive agent</h2><p className="panel-intro">This comparison agent receives raw seller listings and has no mandate safeguards. Its output is a demo only.</p><button className="button button-secondary" onClick={onRun} disabled={busy}>{busy ? 'Running…' : 'Run naive agent'}</button>{error && <p className="inline-error" role="alert">{error}</p>}
    {run && <div className="run-output"><div className="demo-only-label"><AlertTriangle size={16} /> Demo only — checkout disabled</div><h3>Proposed items</h3>{items.length ? items.map((item, i) => <div className="naive-item" key={`${item.sku}-${i}`}><div><strong>{item.name}</strong><small>{item.sku} · quantity {item.quantity}</small></div><span><Money cents={item.unit_price_cents} /></span></div>) : <p className="microcopy">The agent returned no valid proposed items.</p>}
      <details><summary>Naive reasoning</summary><p className="untrusted-text">{run.naive_reasoning || 'No reasoning was returned.'}</p></details></div>}</section>;
}
export function ProtectedAgentPanel({ run, products, mandate, onRun, busy, error }: { run?: AgentRun; products: Product[]; merchants?: Merchant[]; mandate: Mandate; onRun: () => void; busy: boolean; error?: string }) {
  const proposal = run?.proposal;
  return <section className="agent-panel protected-panel"><div className="panel-kicker protected-kicker"><ShieldCheck size={17} /> MandateGuard protected</div><h2>Protected agent</h2><p className="panel-intro">Seller text is inspected as untrusted data. The deterministic policy engine decides whether any proposal may proceed.</p><button className="button button-primary" onClick={onRun} disabled={busy}>{busy ? 'Evaluating…' : 'Run protected agent'}</button>{error && <p className="inline-error" role="alert">{error}</p>}
    {run && <div className="run-output"><div className="section-row"><h3>Candidate decisions</h3><span className="candidate-count">{run.candidates?.length ?? 0}</span></div>{run.candidates?.length ? <div className="candidate-list">{run.candidates.map((candidate) => <CandidateCard key={candidate.product_id} candidate={candidate} product={products.find((p) => p.product_id === candidate.product_id)} />)}</div> : <p className="microcopy">No candidates were returned for this mandate.</p>}
      {proposal ? <div className="selected-proposal"><div className="section-row"><h3>Selected proposal</h3><StatusBadge status={proposal.evidence?.decision?.decision ?? proposal.status} /></div><p>{proposal.items?.map((item) => `${item.name} · ${item.sku}`).join(' / ')}</p><p><strong><Money cents={proposal.total_cents} currency={proposal.currency} /></strong> · {proposal.merchant_id} · mandate v{proposal.mandate_version}</p><p className="microcopy">Payment eligibility is rechecked by the backend at checkout.</p>{proposal.source === 'protected' && proposal.status === 'ALLOWED' && <PayPalCheckout proposal={proposal} mandate={mandate} />}</div> : <div className="no-proposal"><CircleHelp size={17} /><span>No protected proposal was allowed. Candidates are shown for review.</span></div>}
    </div>}
  </section>;
}
