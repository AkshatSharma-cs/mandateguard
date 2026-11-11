import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { SessionProvider } from '../session';
import { NaiveAgentPanel } from '../components/AgentPanels';

const mandate = { mandate_id: 'mandate-1', version: 1, status: 'pending_confirmation', owner_id: 'local', original_instruction: 'Find a wireless mouse under 30', item_category: 'mouse', max_unit_price_cents: 3000, max_total_cents: 3000, quantity_max: 1, currency: 'USD', allowed_merchant_ids: ['m_acme'], allow_bundles: false, allow_addons: false, expires_at: '2030-01-01T00:00:00.000Z', created_at: '2029-01-01T00:00:00.000Z', confirmed_at: null };
function mount(path: string) { window.history.pushState({}, '', path); return render(<SessionProvider><App /></SessionProvider>); }
describe('product safety flows', () => {
  it('never renders checkout controls in the naive demo panel', () => {
    const run = { run_id: 'run-1', mode: 'naive' as const, enforced: false, candidates: [], naive_reasoning: 'demo', proposal: { proposal_id: 'proposal-1', mandate_id: 'mandate-1', mandate_version: 1, merchant_id: 'm_acme', currency: 'USD', items: [{ sku: 'p-1', name: 'Mouse', quantity: 1, unit_price_cents: 1000 }], total_cents: 1000, source: 'protected' as const, status: 'ALLOWED', paypal_order_id: null, evidence: { decision: { decision: 'ALLOW' as const, reasons: [], checks: [] } } } };
    render(<NaiveAgentPanel run={run} onRun={() => undefined} busy={false} />);
    expect(screen.getByText(/demo only — checkout disabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/paypal sandbox/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay/i })).not.toBeInTheDocument();
  });
  it('does not activate a parsed mandate until the buyer confirms it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      if (path.endsWith('/api/catalogue')) return new Response(JSON.stringify({ merchants: [], products: [] }), { status: 200 });
      if (path.endsWith('/api/mandates/parse')) return new Response(JSON.stringify({ mandate, notes: [] }), { status: 201 });
      if (path.endsWith('/api/mandates/mandate-1/confirm')) return new Response(JSON.stringify({ ...mandate, status: 'active', confirmed_at: '2029-06-01T00:00:00.000Z' }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount('/mandates/new');
    await userEvent.click(screen.getByRole('button', { name: /parse mandate/i }));
    await screen.findByRole('heading', { name: 'Proposed mandate' });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/confirm'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /confirm mandate/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: /confirm mandate/i })).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: /cancel/i })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm mandate/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/confirm'))).toBe(true));
  });
  it('renders seller description as text, not executable markup', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/catalogue')
      ? new Response(JSON.stringify({ merchants: [], products: [{ product_id: 'p-1', merchant_id: 'm', title: 'Mouse', description: '<img src=x onerror=alert(1)> seller text', price_cents: 1200, currency: 'USD', category: 'mouse', is_bundle: null }] }), { status: 200 })
      : new Response(JSON.stringify({ status: 'ok' }), { status: 200 })));
    mount('/catalogue');
    expect(await screen.findByText('<img src=x onerror=alert(1)> seller text')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
