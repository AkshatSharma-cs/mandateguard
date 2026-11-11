import { api } from './api';
import type { CaptureResult } from './types';

export interface PayPalCallbacks {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<CaptureResult>;
  onCancel: () => void;
  onError: (error: unknown) => void;
}
export function makePayPalCallbacks(proposalId: string, callbacks: Pick<PayPalCallbacks, 'onCancel' | 'onError'> & { onCapture?: (result: CaptureResult) => void }): PayPalCallbacks {
  return {
    createOrder: async () => {
      const result = await api.checkout(proposalId);
      if (typeof result.paypal_order_id !== 'string' || !result.paypal_order_id) throw new Error('The server did not return a PayPal order ID.');
      return result.paypal_order_id;
    },
    onApprove: async (data) => {
      if (typeof data?.orderID !== 'string' || !data.orderID) throw new Error('PayPal did not return an order ID.');
      const result = await api.capture(proposalId, data.orderID);
      callbacks.onCapture?.(result);
      return result;
    },
    onCancel: callbacks.onCancel,
    onError: callbacks.onError,
  };
}
