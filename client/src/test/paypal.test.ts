import { describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { makePayPalCallbacks } from '../paypal';

describe('PayPal callback contract', () => {
  it('asks the backend to create an order and sends approval to backend capture', async () => {
    const checkout = vi.spyOn(api, 'checkout').mockResolvedValue({ paypal_order_id: 'ORDER-1' });
    const capture = vi.spyOn(api, 'capture').mockResolvedValue({ status: 'CAPTURED', checks: [], capture: { id: 'CAP-1' } });
    const onCapture = vi.fn();
    const callbacks = makePayPalCallbacks('proposal-1', { onCancel: vi.fn(), onError: vi.fn(), onCapture });
    await expect(callbacks.createOrder()).resolves.toBe('ORDER-1');
    await expect(callbacks.onApprove({ orderID: 'ORDER-1' })).resolves.toMatchObject({ status: 'CAPTURED' });
    expect(checkout).toHaveBeenCalledWith('proposal-1');
    expect(capture).toHaveBeenCalledWith('proposal-1', 'ORDER-1');
    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ status: 'CAPTURED' }));
  });
});
