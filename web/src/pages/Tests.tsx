import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, EmptyState, KeyValueList, Panel, Skeleton, StatusPill, Table, Tag } from '../components/ui';
import { api, ApiError, isMockMode } from '../api/client';
import type { Decision, TestResults } from '../types';
import './tests.css';

function metric(value: number | null | undefined, format: (n: number) => string = String) {
  return value === null || value === undefined ? 'Not measured' : format(value);
}
function percent(value: number | null | undefined) {
  return metric(value, number => `${(number * 100).toFixed(1)}%`);
}

export default function TestsPage() {
  const [results, setResults] = useState<TestResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setResults(await api.getTestResults()); }
    catch (failure) { setError(failure instanceof ApiError ? failure : new ApiError('CLIENT_ERROR', failure instanceof Error ? failure.message : 'The results could not be loaded.', 0)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => {
    const grouped = new Map<string, NonNullable<TestResults['cases']>>();
    for (const item of results?.cases ?? []) grouped.set(item.attack_type, [...(grouped.get(item.attack_type) ?? []), item]);
    return [...grouped.entries()];
  }, [results]);
  const runAgain = async () => {
    if (isMockMode || running) return;
    setRunning(true); setError(null);
    try { await api.runTests(); await load(); }
    catch (failure) { setError(failure instanceof ApiError ? failure : new ApiError('RUN_FAILED', failure instanceof Error ? failure.message : 'The test run failed.', 0)); }
    finally { setRunning(false); }
  };
  const aggregate = results?.aggregate;
  const settingsRows = Object.entries(results?.settings ?? {}).map(([key, value]) => ({ label: key === 'date' ? 'Run date' : key.replaceAll('_', ' '), value: value === null || value === undefined ? 'Not measured' : String(value) }));
  if (!settingsRows.some(row => row.label === 'Run date')) settingsRows.unshift({ label: 'Run date', value: 'Not measured' });

  return <div className="tests-page container">
    <header className="tests-heading"><h1 className="text-h2">Security tests</h1><div className="tests-actions">{results?.source === 'snapshot' && <Tag variant="brand">Snapshot</Tag>}<Button variant="secondary" size="md" disabled={isMockMode || running} onClick={() => void runAgain()}>{running ? 'Running…' : 'Run again'}</Button></div></header>
    <p className="tests-intro">This is a small demonstration suite, not a general security claim.</p>
    {isMockMode && <p className="tests-hint">Needs the backend</p>}
    {running && <p className="tests-progress" role="status">Running security tests…</p>}
    {loading ? <div className="tests-loading" aria-label="Loading test results"><Skeleton width="100%" height={104} /><Skeleton width="100%" height={240} /><Skeleton width="72%" height={104} /></div>
      : error ? <Panel className="tests-error"><AlertCircle size={20} aria-hidden="true" /><p>{error.message}</p><Button variant="outline" size="md" onClick={() => void load()}>Retry</Button></Panel>
        : results && <>
          <section className="tests-summary" aria-label="Test summary">
            <Metric title="Unauthorized allowed" value={metric(aggregate?.unauthorized_allowed)} meaning="Unauthorized purchases allowed by policy." />
            <Metric title="Benign blocked" value={metric(aggregate?.benign_blocked)} meaning="Expected allowed purchases blocked." />
            <Metric title="Policy accuracy" value={percent(aggregate?.policy_ok_rate)} meaning="Cases matching the expected decision." />
            <Metric title="Unprotected agent fooled" value={percent(aggregate?.unprotected_unsafe_rate)} meaning="Unsafe choices by the unprotected agent." />
          </section>
          <Panel className="tests-cases" title="Cases" headingLevel={2}>{results.cases.length === 0 ? <EmptyState sentence="No cases are present in this results file." /> : <div className="tests-table-wrap"><Table><thead><tr><th>Case</th><th>Expected</th><th>Result</th><th>Unprotected agent unsafe runs</th><th>Extractor hit</th></tr></thead>{groups.map(([attackType, cases]) => <tbody key={attackType} className="tests-case-group"><tr><th colSpan={5} scope="rowgroup">{attackType.replaceAll('_', ' ')}</th></tr>{cases.map(testCase => <tr key={testCase.case_id}><td><span className="mono">{testCase.case_id}</span><span className="tests-product-id">{testCase.product_id}</span></td><td><StatusPill status={testCase.expected_decision as Decision} /></td><td><StatusPill status={testCase.policy?.decision ?? 'REVIEW'} /></td><td>{testCase.unprotected?.unsafe_count === null || testCase.unprotected?.unsafe_count === undefined ? 'Not measured' : `${testCase.unprotected.unsafe_count} of ${testCase.unprotected.runs_completed}`}</td><td>{testCase.extractor_hit === null || testCase.extractor_hit === undefined ? 'Not measured' : testCase.extractor_hit ? 'Yes' : 'No'}</td></tr>)}</tbody>)}</Table></div>}</Panel>
          <Panel className="tests-settings" title="Settings" headingLevel={2}><KeyValueList rows={settingsRows} /></Panel>
        </>}
  </div>;
}

function Metric({ title, value, meaning }: { title: string; value: string; meaning: string }) {
  return <Panel className="tests-metric"><h2>{title}</h2><p className="tests-metric-value mono">{value}</p><p className="tests-metric-meaning">{meaning}</p></Panel>;
}
