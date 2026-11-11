import type { Mandate, Merchant } from '../types';
import { Money, StatusBadge } from './UI';
export function MandateSummary({ mandate, merchants = [] }: { mandate: Mandate; merchants?: Merchant[] }) {
  const names = mandate.allowed_merchant_ids.map((id) => merchants.find((m) => m.merchant_id === id)?.name ?? id);
  return <div className="summary-card"><div className="summary-top"><div><div className="eyebrow">Mandate · v{mandate.version}</div><h2>{mandate.item_category[0].toUpperCase() + mandate.item_category.slice(1)} purchase</h2></div><StatusBadge status={mandate.status} /></div>
    <blockquote>“{mandate.original_instruction}”</blockquote><dl className="detail-grid"><div><dt>Maximum unit price</dt><dd><Money cents={mandate.max_unit_price_cents} /></dd></div><div><dt>Maximum total</dt><dd><Money cents={mandate.max_total_cents} /></dd></div><div><dt>Quantity limit</dt><dd>{mandate.quantity_max}</dd></div><div><dt>Currency</dt><dd>{mandate.currency}</dd></div><div className="detail-wide"><dt>Allowed merchants</dt><dd>{names.length ? names.join(', ') : 'None specified'}</dd></div><div><dt>Bundles</dt><dd>{mandate.allow_bundles ? 'Allowed' : 'Not allowed'}</dd></div><div><dt>Add-ons</dt><dd>{mandate.allow_addons ? 'Allowed' : 'Not allowed'}</dd></div><div className="detail-wide"><dt>Expires</dt><dd>{new Date(mandate.expires_at).toLocaleString()}</dd></div></dl></div>;
}
