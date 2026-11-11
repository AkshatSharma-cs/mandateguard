// web/src/state/store.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { AuditEvent, CaptureResult, Catalogue, Mandate, Proposal, RunResult } from '../types';

type ActionError = { code: string; message: string; status: number };
type State = {
  mandate: Mandate | null;
  exceeded: string[];
  catalogue: Catalogue | null;
  runs: { naive: RunResult | null; protected: RunResult | null };
  proposal: Proposal | null;
  drawerOpen: boolean;
  auditEvents: AuditEvent[];
  chainOk: boolean | null;
  captureResult: CaptureResult | null;
  loading: Record<string, boolean>;
  errors: Record<string, ActionError | null>;
};
type Action =
  | { type: 'loading'; name: string; value: boolean }
  | { type: 'error'; name: string; value: ActionError | null }
  | { type: 'mandate'; value: Mandate | null }
  | { type: 'exceeded'; value: string[] }
  | { type: 'catalogue'; value: Catalogue }
  | { type: 'runs'; value: State['runs'] }
  | { type: 'proposal'; value: Proposal | null }
  | { type: 'drawer'; value: boolean }
  | { type: 'audit'; value: { events: AuditEvent[]; chainOk: boolean } }
  | { type: 'capture'; value: CaptureResult | null };

const initialState: State = { mandate: null, exceeded: [], catalogue: null, runs: { naive: null, protected: null }, proposal: null, drawerOpen: false, auditEvents: [], chainOk: null, captureResult: null, loading: {}, errors: {} };
function reducer(state: State, action: Action): State {
  if (action.type === 'loading') return { ...state, loading: { ...state.loading, [action.name]: action.value } };
  if (action.type === 'error') return { ...state, errors: { ...state.errors, [action.name]: action.value } };
  if (action.type === 'mandate') return { ...state, mandate: action.value };
  if (action.type === 'exceeded') return { ...state, exceeded: action.value };
  if (action.type === 'catalogue') return { ...state, catalogue: action.value };
  if (action.type === 'runs') return { ...state, runs: action.value };
  if (action.type === 'proposal') return { ...state, proposal: action.value };
  if (action.type === 'drawer') return { ...state, drawerOpen: action.value };
  if (action.type === 'audit') return { ...state, auditEvents: action.value.events, chainOk: action.value.chainOk };
  if (action.type === 'capture') return { ...state, captureResult: action.value };
  return state;
}

type Store = State & {
  loadCatalogue: () => Promise<void>;
  parseMandate: (instruction: string) => Promise<void>;
  createTask: (instruction: string) => Promise<void>;
  confirmMandate: () => Promise<void>;
  revokeMandate: () => Promise<boolean>;
  discardMandate: () => void;
  runBoth: () => Promise<void>;
  openCheckout: () => void;
  closeCheckout: () => void;
  createCheckout: () => Promise<string | null>;
  capture: (orderId: string) => Promise<void>;
  useAlternative: (evaluationId: string) => Promise<void>;
  refreshAudit: () => Promise<void>;
  clearError: (action: string) => void;
};
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const setLoading = (name: string, value: boolean) => dispatch({ type: 'loading', name, value });
  const setError = (name: string, error: unknown) => dispatch({ type: 'error', name, value: error ? error instanceof ApiError ? { code: error.code, message: error.message, status: error.status } : { code: 'CLIENT_ERROR', message: error instanceof Error ? error.message : 'The action could not be completed.', status: 0 } : null });
  const refreshAudit = useCallback(async (mandateId?: string, proposalId?: string) => {
    setLoading('audit', true); setError('audit', null);
    try {
      const result = await api.getAudit({ mandate_id: mandateId, proposal_id: proposalId });
      dispatch({ type: 'audit', value: { events: result.events, chainOk: result.chain_ok } });
    } catch (error) {
      setError('audit', error);
      throw error;
    } finally { setLoading('audit', false); }
  }, []);

  async function act(name: string, task: () => Promise<void>) {
    setLoading(name, true); setError(name, null);
    try { await task(); }
    catch (error) { setError(name, error); }
    finally { setLoading(name, false); }
  }

  const loadCatalogue = () => act('catalogue', async () => { dispatch({ type: 'catalogue', value: await api.getCatalogue() }); });
  const parseMandate = (instruction: string) => act('parse', async () => {
    if (!instruction.trim()) {
      const profile = (await api.getProfiles()).profiles.find(item => item.is_default && item.status === 'active');
      if (!profile) throw new ApiError('NO_PREFERENCES', 'Set and confirm preferences before running the agent.', 409);
      dispatch({ type: 'mandate', value: profile }); dispatch({ type: 'exceeded', value: [] }); dispatch({ type: 'capture', value: null });
      dispatch({ type: 'runs', value: { naive: null, protected: null } }); dispatch({ type: 'proposal', value: null });
      await refreshAudit(profile.mandate_id);
      return;
    }
    const result = await api.createTask(instruction);
    dispatch({ type: 'mandate', value: result.mandate }); dispatch({ type: 'exceeded', value: result.exceeded }); dispatch({ type: 'capture', value: null });
    dispatch({ type: 'runs', value: { naive: null, protected: null } });
    dispatch({ type: 'proposal', value: null });
    await refreshAudit(result.mandate.mandate_id);
  });
  const createTask = parseMandate;
  const confirmMandate = () => act('confirm', async () => {
    if (!state.mandate) return;
    const mandate = await api.confirmMandate(state.mandate.mandate_id);
    dispatch({ type: 'mandate', value: mandate }); dispatch({ type: 'exceeded', value: [] }); await refreshAudit(mandate.mandate_id);
  });
  const revokeMandate = async () => {
    setLoading('revoke', true); setError('revoke', null);
    try {
      if (!state.mandate) return false;
      const mandate = await api.revokeMandate(state.mandate.mandate_id);
      dispatch({ type: 'mandate', value: mandate }); await refreshAudit(mandate.mandate_id);
      return true;
    } catch (error) { setError('revoke', error); return false; }
    finally { setLoading('revoke', false); }
  };
  const discardMandate = () => { dispatch({ type: 'mandate', value: null }); dispatch({ type: 'exceeded', value: [] }); dispatch({ type: 'runs', value: { naive: null, protected: null } }); dispatch({ type: 'proposal', value: null }); };
  const runBoth = () => act('run', async () => {
    if (!state.mandate) return;
    const mandateId = state.mandate.mandate_id;
    let partialNaive: RunResult | null = null;
    let partialProtected: RunResult | null = null;
    dispatch({ type: 'runs', value: { naive: null, protected: null } });
    const { naive, protected: protectedRun } = await api.runBothAgent(mandateId, event => {
      const runId = String(event.data.run_id ?? 'streaming');
      if (event.type === 'phase' && event.data.name === 'searching') void refreshAudit(mandateId).catch(() => undefined);
      if (event.type === 'candidate') {
        const candidate = event.data as unknown as RunResult['candidates'][number];
        partialProtected = { run_id: runId, mode: 'protected', enforced: true,
          candidates: [...(partialProtected?.candidates ?? []), { ...candidate, extraction: null }], proposal: partialProtected?.proposal ?? null,
          naive_reasoning: null, allowed_alternative_ids: partialProtected?.allowed_alternative_ids ?? [], compare_links: partialProtected?.compare_links ?? [] };
        dispatch({ type: 'runs', value: { naive: partialNaive, protected: partialProtected } });
        void refreshAudit(mandateId).catch(() => undefined);
      } else if (event.type === 'naive') {
        const proposal = event.data.proposal as Proposal | null;
        partialNaive = { run_id: runId, mode: 'naive', enforced: false, candidates: partialNaive?.candidates ?? [],
          proposal, naive_reasoning: String(event.data.reasoning ?? ''), would_have_been: event.data.would_have_been as RunResult['would_have_been'] };
        dispatch({ type: 'runs', value: { naive: partialNaive, protected: partialProtected } });
      } else if (event.type === 'proposal') {
        partialProtected = { run_id: runId, mode: 'protected', enforced: true, candidates: partialProtected?.candidates ?? [],
          proposal: event.data.proposal as Proposal | null, naive_reasoning: null,
          allowed_alternative_ids: event.data.allowed_alternative_ids as string[], compare_links: partialProtected?.compare_links ?? [] };
        dispatch({ type: 'runs', value: { naive: partialNaive, protected: partialProtected } });
      } else if (event.type === 'compare_links') {
        partialProtected = { run_id: runId, mode: 'protected', enforced: true, candidates: partialProtected?.candidates ?? [],
          proposal: partialProtected?.proposal ?? null, naive_reasoning: null, allowed_alternative_ids: partialProtected?.allowed_alternative_ids ?? [],
          compare_links: event.data.links as RunResult['compare_links'] };
        dispatch({ type: 'runs', value: { naive: partialNaive, protected: partialProtected } });
      }
    });
    dispatch({ type: 'runs', value: { naive, protected: protectedRun } });
    dispatch({ type: 'proposal', value: protectedRun.proposal }); dispatch({ type: 'capture', value: null });
    await refreshAudit(mandateId);
  });
  const openCheckout = () => { dispatch({ type: 'drawer', value: true }); dispatch({ type: 'capture', value: null }); };
  const closeCheckout = () => dispatch({ type: 'drawer', value: false });
  const createCheckout = async () => {
    let orderId: string | null = null;
    await act('checkout', async () => {
      if (!state.proposal || state.proposal.source !== 'protected') return;
      try {
        const result = await api.createCheckout(state.proposal.proposal_id); orderId = result.paypal_order_id;
        dispatch({ type: 'proposal', value: { ...state.proposal, paypal_order_id: orderId } });
      } finally { await refreshAudit(state.proposal.mandate_id, state.proposal.proposal_id); }
    });
    return orderId;
  };
  const capture = (orderId: string) => act('capture', async () => {
    if (!state.proposal || state.proposal.source !== 'protected') return;
    try {
      const result = await api.capture(state.proposal.proposal_id, orderId);
      dispatch({ type: 'capture', value: result });
    } finally { await refreshAudit(state.proposal.mandate_id, state.proposal.proposal_id); }
  });
  const useAlternative = (evaluationId: string) => act('alternative', async () => {
    const result = await api.useAlternative(evaluationId);
    dispatch({ type: 'proposal', value: result.proposal }); dispatch({ type: 'capture', value: null }); dispatch({ type: 'drawer', value: true });
    await refreshAudit(result.proposal.mandate_id, result.proposal.proposal_id);
  });
  const clearError = (name: string) => setError(name, null);

  useEffect(() => {
    void loadCatalogue();
    void refreshAudit().catch(() => undefined);
  }, []);
  const value = useMemo<Store>(() => ({ ...state, loadCatalogue, parseMandate, createTask, confirmMandate, revokeMandate, discardMandate, runBoth, openCheckout, closeCheckout, createCheckout, capture, useAlternative, refreshAudit: () => refreshAudit(state.mandate?.mandate_id), clearError }), [state, refreshAudit]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('StoreProvider is missing.');
  return store;
}
