import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AgentRun, Mandate } from './types';

interface SessionValue { mandate: Mandate | null; setMandate: (m: Mandate | null) => void; runs: Partial<Record<'naive' | 'protected', AgentRun>>; setRun: (r: AgentRun) => void }
const Context = createContext<SessionValue | null>(null);
function readMandate(): Mandate | null {
  try { const v = sessionStorage.getItem('mg.mandate'); return v ? JSON.parse(v) as Mandate : null; } catch { return null; }
}
export function SessionProvider({ children }: { children: ReactNode }) {
  const [mandate, setCurrentMandate] = useState<Mandate | null>(readMandate);
  const [runs, setRuns] = useState<Partial<Record<'naive' | 'protected', AgentRun>>>({});
  const setMandate = (m: Mandate | null) => { setCurrentMandate(m); try { if (m) sessionStorage.setItem('mg.mandate', JSON.stringify(m)); else sessionStorage.removeItem('mg.mandate'); } catch { /* Session storage is optional. */ } };
  const setRun = (r: AgentRun) => setRuns((current) => ({ ...current, [r.mode]: r }));
  const value = useMemo(() => ({ mandate, setMandate, runs, setRun }), [mandate, runs]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error('SessionProvider is missing'); return value; }
