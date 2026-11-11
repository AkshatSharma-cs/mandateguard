import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

afterEach(() => vi.unstubAllGlobals());
describe('typed API client', () => {
  it('returns parsed JSON for a successful request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })));
    await expect(api.health()).resolves.toEqual({ status: 'ok' });
  });
  it('converts a non-2xx API error into ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Not eligible' } }), { status: 409 })));
    await expect(api.health()).rejects.toMatchObject({ name: 'ApiError', status: 409, code: 'CONFLICT', message: 'Not eligible' });
  });
  it('handles network failures without leaking fetch internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket details')));
    await expect(api.health()).rejects.toMatchObject({ name: 'ApiError', status: 0, code: 'NETWORK_ERROR', message: expect.not.stringContaining('socket details') });
  });
  it('rejects malformed checkout responses instead of enabling an unknown order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ paypal_order_id: '' }), { status: 201 })));
    await expect(api.checkout('proposal-1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
