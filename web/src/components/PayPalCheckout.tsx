import { useEffect, useRef, useState } from 'react';
import { Button, Skeleton } from './ui';
import { api } from '../api/client';

type PayPalApproveData = { orderID: string };
type PayPalButtonsInstance = { render(target: HTMLElement): Promise<void>; close(): Promise<void> | void };
type PayPalNamespace = { Buttons(options: {
  style: { layout: 'vertical'; shape: 'pill'; label: 'pay' };
  createOrder(): Promise<string>;
  onApprove(data: PayPalApproveData): Promise<void>;
  onCancel?(): void;
  onError?(error: unknown): void;
}): PayPalButtonsInstance };

declare global { interface Window { paypal?: PayPalNamespace } }

const sdkLoads = new Map<string, Promise<void>>();
const isMock = import.meta.env.VITE_USE_MOCK === 'true';

function loadPayPalSdk(url: string): Promise<void> {
  const prior = sdkLoads.get(url);
  if (prior) return prior;
  const load = new Promise<void>((resolve, reject) => {
    if (window.paypal) { resolve(); return; }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CSS.escape(url)}"]`);
    const script = existing ?? document.createElement('script');
    const onLoad = () => window.paypal ? resolve() : reject(new Error('The PayPal Sandbox SDK did not load.'));
    const onError = () => { script.remove(); reject(new Error('The PayPal Sandbox SDK could not be loaded.')); };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) { script.src = url; script.async = true; document.head.appendChild(script); }
    if (existing && window.paypal) resolve();
  });
  sdkLoads.set(url, load);
  void load.catch(() => { sdkLoads.delete(url); });
  return load;
}

type Props = {
  proposalId: string;
  disabled?: boolean;
  busy?: boolean;
  onCreateOrder: () => Promise<string | null>;
  onCapture: (orderId: string) => Promise<void>;
};

export default function PayPalCheckout({ proposalId, disabled = false, busy = false, onCreateOrder, onCapture }: Props) {
  const target = useRef<HTMLDivElement>(null);
  const createOrderRef = useRef(onCreateOrder);
  const captureRef = useRef(onCapture);
  createOrderRef.current = onCreateOrder;
  captureRef.current = onCapture;
  const [ready, setReady] = useState(isMock);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isMock || disabled || !proposalId) return;
    let active = true;
    let buttons: PayPalButtonsInstance | undefined;
    let rendered = false;
    setReady(false);
    setLoadError('');
    void api.getPublicConfig().then(config => {
      if (!config.paypal_client_id) throw new Error('PayPal Sandbox is not configured.');
      const url = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypal_client_id)}&currency=${encodeURIComponent(config.currency || 'USD')}&intent=capture`;
      return loadPayPalSdk(url);
    }).then(async () => {
      if (!active || !target.current || !window.paypal) return;
      buttons = window.paypal.Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'pay' },
        createOrder: async () => {
          const orderId = await createOrderRef.current();
          if (!orderId) throw new Error('The PayPal order could not be created.');
          return orderId;
        },
        onApprove: async data => { await captureRef.current(data.orderID); },
        onCancel: () => undefined,
        onError: error => setLoadError(error instanceof Error ? error.message : 'PayPal could not complete this order.'),
      });
      await buttons.render(target.current);
      rendered = true;
      if (active) setReady(true);
    }).catch(error => {
      if (active) setLoadError(error instanceof Error ? error.message : 'PayPal Sandbox is unavailable.');
    });
    return () => {
      active = false;
      if (rendered) void buttons?.close();
      if (target.current) target.current.replaceChildren();
    };
  }, [proposalId, disabled, attempt]);

  async function simulateApproval() {
    const orderId = await onCreateOrder();
    if (orderId) await onCapture(orderId);
  }

  if (isMock) return <Button className="simulate-approval" variant="secondary" size="lg" disabled={disabled || busy} onClick={() => void simulateApproval()}>{busy ? 'Processing…' : 'Simulate PayPal approval'}</Button>;
  return <>
    {!ready && !loadError && <div className="paypal-skeleton"><Skeleton width="100%" height={48} label="Loading PayPal Sandbox buttons" />Loading PayPal Sandbox buttons…</div>}
    <div ref={target} />
    {loadError && <div className="console-error" role="alert"><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
  </>;
}
