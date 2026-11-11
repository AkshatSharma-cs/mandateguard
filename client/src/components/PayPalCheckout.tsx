import { useEffect, useRef, useState } from 'react';
import type { Mandate, Proposal } from '../types';
import { canCheckout, paymentStateAfterCapture, type PaymentState } from '../security';
import { api, ApiError } from '../api';
import { makePayPalCallbacks } from '../paypal';
import { ErrorBanner, StatusBadge } from './UI';

declare global {
  interface Window { paypal?: { Buttons: (options: Record<string, unknown>) => { render: (target: HTMLElement) => Promise<void>; close?: () => Promise<void> } } }
}
let sdkPromise: Promise<void> | null = null;
function loadSdk(clientId: string, currency: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    // Mirrors the existing checkout harness URL and its PayPal Buttons callback contract.
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency || 'USD')}&intent=capture`;
    script.async = true; script.onload = () => window.paypal ? resolve() : reject(new Error('PayPal SDK loaded without its Buttons API.'));
    script.onerror = () => reject(new Error('Could not load the PayPal Sandbox JavaScript SDK.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => { sdkPromise = null; throw error; });
  sdkPromise = pending;
  return pending;
}
function describeState(state: PaymentState) {
  if (state === 'complete') return 'Sandbox payment completed';
  if (state === 'cancelled') return 'Checkout cancelled. No payment success was recorded.';
  if (state === 'capturing') return 'Verifying and capturing through the backend…';
  if (state === 'checkout') return 'PayPal Sandbox checkout is ready.';
  if (state === 'loading_sdk') return 'Loading PayPal Sandbox…';
  if (state === 'unknown') return 'Payment state could not be verified. Check the audit log before retrying.';
  if (state === 'error') return 'Checkout could not continue.';
  return 'Ready for PayPal Sandbox approval.';
}
export function PayPalCheckout({ proposal, mandate }: { proposal: Proposal; mandate: Mandate }) {
  const host = useRef<HTMLDivElement>(null); const [state, setState] = useState<PaymentState>('ready'); const [message, setMessage] = useState(''); const [disabledReason, setDisabledReason] = useState('');
  useEffect(() => {
    let alive = true; let button: ReturnType<NonNullable<Window['paypal']>['Buttons']> | undefined;
    if (!canCheckout(proposal, mandate)) { setDisabledReason('Checkout is unavailable because this is not a current, protected ALLOW proposal.'); return; }
    setState('loading_sdk');
    (async () => {
      try {
        const currentMandate = await api.getMandate(mandate.mandate_id);
        if (currentMandate.status !== 'active' || currentMandate.version !== mandate.version || Date.parse(currentMandate.expires_at) <= Date.now()) {
          setDisabledReason('The mandate is no longer current. Return to Agent Lab and re-evaluate the proposal before checkout.');
          setState('unknown');
          return;
        }
        const config = await api.publicConfig();
        if (!config.paypal_client_id || !config.currency) throw new Error('Public PayPal Sandbox configuration is incomplete.');
        await loadSdk(config.paypal_client_id, config.currency);
        if (!alive || !host.current || !window.paypal) return;
        const callbacks = makePayPalCallbacks(proposal.proposal_id, {
          onCancel: () => { if (alive) setState('cancelled'); },
          onError: (error) => { if (alive) { setMessage(error instanceof Error ? error.message : 'PayPal checkout reported an error.'); setState('error'); } },
          onCapture: (result) => { if (alive) setState(paymentStateAfterCapture(result)); },
        });
        button = window.paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', label: 'paypal' },
          createOrder: async () => {
            try { return await callbacks.createOrder(); }
            catch (error) { if (alive) { setMessage(error instanceof Error ? error.message : 'The backend could not create an order.'); setState('error'); } throw error; }
          },
          onApprove: async (data: { orderID: string }) => {
            if (alive) setState('capturing');
            try { await callbacks.onApprove(data); }
            catch (error) {
              if (!alive) return;
              setMessage(error instanceof Error ? error.message : 'The backend could not verify capture.');
              setState(error instanceof ApiError && (error.status === 0 || error.status === 409 || error.code === 'INVALID_RESPONSE') ? 'unknown' : 'error');
            }
          },
          onCancel: callbacks.onCancel,
          onError: callbacks.onError,
        });
        await button.render(host.current);
        if (alive) setState('checkout');
      } catch (error) { if (alive) { setMessage(error instanceof Error ? error.message : 'Checkout is unavailable.'); setState('error'); } }
    })();
    return () => { alive = false; void button?.close?.().catch(() => undefined); };
  }, [proposal, mandate]);
  if (disabledReason) return <div className="checkout-locked"><StatusBadge status="BLOCK" /><p>{disabledReason}</p></div>;
  return <section className="checkout-panel"><div className="checkout-heading"><div><div className="eyebrow">PayPal Sandbox</div><h3>Buyer approval</h3></div><StatusBadge status={state === 'complete' ? 'CAPTURED' : state === 'unknown' || state === 'error' ? 'REVIEW' : 'SANDBOX'} /></div>
    <div className="payment-state" role="status">{describeState(state)}</div>{message && <ErrorBanner title="Checkout update">{message}</ErrorBanner>}{state === 'unknown' && <p className="microcopy">The backend did not verify a captured result. Do not treat this as a completed payment.</p>}
    <div ref={host} className="paypal-buttons" aria-label="PayPal Sandbox approval buttons" />
  </section>;
}
