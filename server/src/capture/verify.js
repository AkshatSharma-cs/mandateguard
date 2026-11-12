// server/src/capture/verify.js
import { toCents } from '../money.js';

function check(checks, id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail });
}

export function verifyBeforeCapture({ proposal, mandate, order, businessEmail, alreadyCaptured, policyDecision, now, paymentMode }) {
  const checks = [];
  const safeProposal = proposal && typeof proposal === 'object' ? proposal : {};
  const safeMandate = mandate && typeof mandate === 'object' ? mandate : {};
  const safeOrder = order && typeof order === 'object' ? order : {};
  const units = Array.isArray(safeOrder.purchase_units) ? safeOrder.purchase_units : [];
  const unit = units[0] ?? {};
  check(checks, 'V1', safeProposal.status === 'ORDER_CREATED' && safeProposal.source === 'protected', 'proposal must be protected and ORDER_CREATED');
  check(checks, 'V2', safeOrder.id === safeProposal.paypal_order_id, 'PayPal order id must match the stored proposal');
  const expires = Date.parse(safeMandate.expires_at);
  check(checks, 'V3', safeMandate.status === 'active' && safeMandate.version === safeProposal.mandate_version
    && Number.isFinite(expires) && now instanceof Date && expires > now.getTime(), 'mandate must be active, current, and unexpired');
  check(checks, 'V4', safeOrder.status === 'APPROVED', 'PayPal order must be APPROVED');

  const orderCurrency = unit.amount?.currency_code;
  check(checks, 'V5', orderCurrency === safeProposal.currency, 'PayPal order currency must match proposal');
  let orderCents = null;
  try { orderCents = toCents(unit.amount?.value); } catch { /* malformed order amounts fail below */ }
  check(checks, 'V6', Number.isSafeInteger(orderCents) && orderCents === safeProposal.total_cents, 'PayPal amount must exactly match proposal cents');

  const orderItems = Array.isArray(unit.items) ? unit.items : [];
  const proposalItems = Array.isArray(safeProposal.items) ? safeProposal.items : [];
  const normalizedOrderItems = orderItems.map((item) => ({ sku: item?.sku, quantity: Number(item?.quantity), unit_price_cents: (() => {
    try { return toCents(item?.unit_amount?.value); } catch { return null; }
  })(), currency: item?.unit_amount?.currency_code }));
  const expectedItems = proposalItems.map((item) => ({
    sku: safeProposal.payment_mode === 'sandbox_simulation'
      ? String(safeProposal.payment_observation?.observation_id ?? item?.sku ?? '').slice(0, 12) : item?.sku,
    quantity: item?.quantity, unit_price_cents: item?.unit_price_cents }));
  const exactItems = normalizedOrderItems.length === expectedItems.length
    && expectedItems.every((expected, index) => {
      const actual = normalizedOrderItems[index];
      return actual.sku === expected.sku && actual.quantity === expected.quantity
        && actual.unit_price_cents === expected.unit_price_cents && actual.currency === safeProposal.currency;
    });
  check(checks, 'V7', exactItems, 'PayPal order lines must exactly match proposal SKU, quantity, and unit price');
  check(checks, 'V8', unit.invoice_id === safeProposal.proposal_id && unit.custom_id === safeProposal.proposal_id,
    'invoice_id and custom_id must both bind the PayPal order to this proposal');

  const returnedPayee = unit.payee?.email_address ?? safeOrder.payee?.email_address;
  const payeePass = returnedPayee == null || (typeof returnedPayee === 'string' && typeof businessEmail === 'string'
    && returnedPayee.toLocaleLowerCase() === businessEmail.toLocaleLowerCase());
  check(checks, 'V9', payeePass, returnedPayee == null ? 'payee not returned' : 'PayPal payee must match configured business email');
  check(checks, 'V10', alreadyCaptured === false, 'proposal SKU must not already be captured');
  check(checks, 'V11', policyDecision === 'ALLOW', 'current policy decision must be ALLOW');
  const expectedMode = paymentMode;
  const description = String(unit.description ?? '');
  check(checks, 'V12', ['store_checkout', 'sandbox_simulation'].includes(expectedMode) && safeProposal.payment_mode === expectedMode
    && (expectedMode !== 'sandbox_simulation' || description.includes('SANDBOX SIMULATION')),
  'payment mode must match the stored observation and simulated orders must be disclosed');

  return { ok: checks.every((entry) => entry.passed), checks };
}
