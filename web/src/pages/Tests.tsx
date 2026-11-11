import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button, EmptyState, KeyValueList, Panel, Skeleton, StatusPill, Table } from '../components/ui';
import { api, ApiError } from '../api/client';
import type { Decision, TestResults } from '../types';
import './tests.css';

const aggregateLabels: Record<string, string> = {
  unprotected_unsafe_rate: 'Unprotected unsafe rate',
  policy_accuracy: 'Policy accuracy',
  unauthorized_allowed: 'Unauthorized allowed',
  benign_blocked: 'Benign blocked',
};

export default function TestsPage() {
  const [results, setResults] = useState<TestResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null); setResults(null);
    try { setResults(await api.getTestResults()); }
    catch (failure) {
      if (!(failure instanceof ApiError && failure.status === 404)) setError(failure instanceof ApiError ? failure : new ApiError('CLIENT_ERROR', failure instanceof Error ? failure.message : 'The results could not be loaded.', 0));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <div className="tests-page container">
    <header className="tests-heading"><h1 className="text-h2">Security tests</h1></header>
    <p className="tests-intro">This is a small demonstration suite, not a general security claim.</p>
    {loading ? <div className="tests-loading"><Skeleton width="100%" height={48} /><Skeleton width="100%" height={48} /><Skeleton width="72%" height={48} /></div>
      : error ? <Panel className="tests-error"><AlertCircle size={20} /><p>{error.message}</p><Button variant="outline" size="md" onClick={() => void load()}>Retry</Button></Panel>
        : !results ? <Panel className="tests-empty"><EmptyState sentence="No results yet. Run npm run attacks, then reload." /></Panel>
          : <>
            {results.aggregate && <Panel className="tests-aggregate"><KeyValueList rows={Object.entries(results.aggregate).map(([key, value]) => ({ label: aggregateLabels[key] ?? key.replaceAll('_', ' '), value: String(value) }))} /></Panel>}
            <Panel className="tests-cases" title="Cases" headingLevel={2}>{results.cases.length === 0 ? <EmptyState sentence="No results yet. Run npm run attacks, then reload." /> : <div className="tests-table-wrap"><Table><thead><tr><th>Case</th><th>Attack type</th><th>Expected</th><th>Result</th><th>Unprotected agent unsafe runs</th><th>Extractor hit</th></tr></thead><tbody>{results.cases.map(testCase => <tr key={testCase.case_id}><td className="mono">{testCase.case_id}</td><td>{testCase.attack_type}</td><td><StatusPill status={testCase.expected_decision as Decision} /></td><td><StatusPill status={testCase.decision} /></td><td>{testCase.unsafe_count === undefined || testCase.runs === undefined ? '—' : `${testCase.unsafe_count} of ${testCase.runs}`}</td><td>{testCase.extractor_hit === null || testCase.extractor_hit === undefined ? '—' : testCase.extractor_hit ? 'Yes' : 'No'}</td></tr>)}</tbody></Table></div>}</Panel>
            {results.settings && <Panel className="tests-settings" title="Settings" headingLevel={2}><KeyValueList rows={[
              { label: 'Provider', value: results.settings.provider ?? '—' },
              { label: 'Model', value: results.settings.model ?? '—' },
              { label: 'Runs', value: results.settings.runs ?? '—' },
              { label: 'Date', value: results.settings.date ?? '—' },
            ]} /></Panel>}
          </>}
  </div>;
}
