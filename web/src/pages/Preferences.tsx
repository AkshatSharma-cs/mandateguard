import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { Button, EmptyState, Input, KeyValueList, Money, Panel, Skeleton, Tag, Textarea } from '../components/ui';
import { api, ApiError } from '../api/client';
import type { Profile, ProfileLimits } from '../types';

const defaultDomains = ['amazon.com', 'walmart.com', 'target.com', 'bestbuy.com', 'newegg.com', 'bhphotovideo.com'];
const domainNames: Record<string, string> = { 'amazon.com': 'Amazon', 'walmart.com': 'Walmart', 'target.com': 'Target', 'bestbuy.com': 'Best Buy', 'newegg.com': 'Newegg', 'bhphotovideo.com': 'B&H Photo' };

export default function PreferencesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('100.00');
  const [allowBundles, setAllowBundles] = useState(false);
  const [allowAddons, setAllowAddons] = useState(false);
  const [firstParty, setFirstParty] = useState(true);
  const [domains, setDomains] = useState(defaultDomains);
  const [domainDraft, setDomainDraft] = useState('');
  const [wordMode, setWordMode] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [pending, setPending] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const active = profiles.find(profile => profile.is_default && profile.status === 'active');
  const currentProfile = active ?? profiles.find(profile => profile.status === 'pending_confirmation');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setProfiles((await api.getProfiles()).profiles); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Preferences could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function confirmAndDefault(profile: Profile) {
    setSaving(true); setError('');
    try {
      const confirmed = profile.status === 'active' ? profile : (await api.confirmProfile(profile.mandate_id)).profile;
      const selected = (await api.setDefaultProfile(confirmed.mandate_id)).profile;
      setProfiles(current => [selected, ...current.filter(item => item.mandate_id !== selected.mandate_id).map(item => ({ ...item, is_default: false }))]);
      setPending(null); setSaved(true); setWordMode(false);
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Preferences could not be saved.'); }
    finally { setSaving(false); }
  }
  async function saveStructured() {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100000) { setError('Enter an amount between $0.01 and $1,000.00.'); return; }
    setSaving(true); setError('');
    try {
      const limits: ProfileLimits = { max_total: (cents / 100).toFixed(2), allow_bundles: allowBundles, allow_addons: allowAddons, require_first_party: firstParty, allowed_domains: domains };
      const profile = (await api.createProfile({ limits })).profile;
      await confirmAndDefault(profile);
    } catch (failure) { setError(failure instanceof ApiError ? failure.message : 'Preferences could not be saved.'); setSaving(false); }
  }
  async function parseWords() {
    setSaving(true); setError('');
    try { setPending((await api.createProfile({ instruction })).profile); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : 'The description could not be parsed.'); }
    finally { setSaving(false); }
  }
  function addDomain() {
    const domain = domainDraft.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) { setError('Enter a valid website domain.'); return; }
    setDomains(current => current.includes(domain) ? current : [...current, domain]); setDomainDraft(''); setError('');
  }

  return <div className="preferences-page container">
    <header><h1 className="text-h2">Preferences</h1><p>Set your limits once. They apply to every task and to the browser extension.</p></header>
    <div className="preferences-grid">
      <Panel title="Your limits" headingLevel={2}>
        {loading ? <div className="preferences-loading"><Skeleton height={48} /><Skeleton height={48} /><Skeleton height={48} /></div> : <>
          {error && <div className="preferences-error" role="alert"><AlertCircle size={18} /><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button></div>}
          {pending ? <><p>Review these limits, then confirm them.</p><KeyValueList rows={[
            { label: 'Maximum purchase amount', value: <Money cents={pending.max_total_cents} /> },
            { label: 'Allow bundles', value: pending.allow_bundles ? 'Yes' : 'No' },
            { label: 'Allow add-ons or warranties', value: pending.allow_addons ? 'Yes' : 'No' },
            { label: 'Approved merchants only', value: pending.allowed_domains.map(domain => domainNames[domain] ?? domain).join(', ') || 'None' },
            { label: 'Require sold by the merchant itself', value: pending.require_first_party ? 'Yes' : 'No' },
          ]} /><div className="preferences-actions"><Button disabled={saving} onClick={() => void confirmAndDefault(pending)}>{saving ? 'Saving…' : 'Confirm and use these limits'}</Button><Button variant="secondary" onClick={() => setPending(null)}>Discard</Button></div></> : <>
            <form className="preferences-form" onSubmit={event => { event.preventDefault(); void saveStructured(); }}>
              <Input label="Maximum purchase amount" id="profile-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} required />
              <label className="preference-toggle"><input type="checkbox" checked={allowBundles} onChange={event => setAllowBundles(event.target.checked)} />Allow bundles</label>
              <label className="preference-toggle"><input type="checkbox" checked={allowAddons} onChange={event => setAllowAddons(event.target.checked)} />Allow add-ons or warranties</label>
              <fieldset className="domain-fieldset"><legend>Approved merchants only</legend><div className="domain-tags">{domains.map(domain => <Tag key={domain}><span>{domainNames[domain] ?? domain}</span><button type="button" aria-label={`Remove ${domainNames[domain] ?? domain}`} onClick={() => setDomains(current => current.filter(item => item !== domain))}>×</button></Tag>)}</div><div className="domain-entry"><Input label="Add website domain" id="domain-entry" value={domainDraft} onChange={event => setDomainDraft(event.target.value)} placeholder="store.example" /><Button type="button" variant="outline" size="md" onClick={addDomain}>Add</Button></div></fieldset>
              <label className="preference-toggle"><input type="checkbox" checked={firstParty} onChange={event => setFirstParty(event.target.checked)} />Require sold by the merchant itself</label>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</Button>
            </form>
            <Button className="word-mode-trigger" variant="outline" onClick={() => setWordMode(value => !value)}>Describe in words</Button>
            {wordMode && <form className="word-form" onSubmit={event => { event.preventDefault(); void parseWords(); }}><Textarea id="profile-instruction" label="Describe your standing limits" rows={3} value={instruction} onChange={event => setInstruction(event.target.value)} required /><Button variant="outline" type="submit" disabled={saving}>{saving ? 'Reading…' : 'Review limits'}</Button></form>}
          </>}
        </>}
      </Panel>
      <Panel title="Current default profile" headingLevel={2}>
        {saved && <p className="profile-saved" role="status"><Check size={16} aria-hidden="true" />You set these limits</p>}
        {loading ? <div className="preferences-loading"><Skeleton height={48} /><Skeleton height={48} /></div> : currentProfile ? <><KeyValueList rows={[
          { label: 'Status', value: <Tag variant={active ? 'brand' : 'neutral'}>{active && <Check size={14} aria-hidden="true" />}{active ? 'Active default' : 'Pending confirmation'}</Tag> },
          { label: 'Maximum purchase amount', value: <Money cents={currentProfile.max_total_cents} /> },
          { label: 'Approved websites', value: currentProfile.allowed_domains.join(', ') || 'None' },
          { label: 'Bundles', value: currentProfile.allow_bundles ? 'Allowed' : 'Excluded' },
          { label: 'Add-ons or warranties', value: currentProfile.allow_addons ? 'Allowed' : 'Excluded' },
          { label: 'Expires', value: new Date(currentProfile.expires_at).toLocaleDateString() },
        ]} /></> : <EmptyState sentence="No preferences yet. Set a ceiling to get started." />}
      </Panel>
    </div>
  </div>;
}
