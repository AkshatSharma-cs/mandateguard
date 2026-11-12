// extension/popup.js
import { createApi } from './lib/api.js';

const $ = selector => document.querySelector(selector);
const form = $('#listing-form');
const mandateSelect = $('#mandate');
const urlInput = $('#url');
const titleInput = $('#title');
const priceInput = $('#price');
const descriptionInput = $('#description');
const submitButton = $('#submit');
const result = $('#result');
const error = $('#error');
const connectionForm = $('#connection-form');
const preferences = $('#preferences');
const profileForm = $('#profile-form');
const noPreferences = $('#no-preferences');
const narrowLink = $('#narrow-task');
const narrowForm = $('#narrow-form');

let api;
let activeTab = null;
let latestEvaluation = null;
let extractedPage = null;
let pageCheckForbidden = false;

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

function clearError() { error.textContent = ''; error.hidden = true; }
function connectionStatus(connected) {
  const status = $('#connection-status'); status.replaceChildren(element('span', undefined, 'connection-dot'), connected ? 'Connected' : 'Not connected');
  status.classList.toggle('is-connected', connected);
}
function baseUrl() { return $('#api-url').value.trim().replace(/\/+$/, ''); }
function openPreferences() { chrome.tabs.create({ url: `${baseUrl()}/app/#/preferences` }); }
function sendBadge(decision) { if (activeTab?.id) void chrome.runtime.sendMessage({ type: 'decision', decision, tabId: activeTab.id }).catch(() => {}); }

function marketplaceSearches(title) {
  const query = encodeURIComponent(title);
  return [
    ['Amazon', `https://www.amazon.com/s?k=${query}`],
    ['Walmart', `https://www.walmart.com/search?q=${query}`],
    ['Target', `https://www.target.com/s?searchTerm=${query}`],
    ['Best Buy', `https://www.bestbuy.com/site/searchpage.jsp?st=${query}`],
    ['eBay', `https://www.ebay.com/sch/i.html?_nkw=${query}`],
  ];
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function money(cents, currency = 'USD') {
  if (cents == null) return 'Price unknown';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

function productObservation() {
  const url = new URL(urlInput.value.trim());
  const rawPrice = priceInput.value.trim();
  const match = rawPrice.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (rawPrice && !match) throw new Error('Enter the displayed price using dollars and cents.');
  const price_cents = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
  const text = descriptionInput.value.trim();
  const title = titleInput.value.trim();
  if (!title) throw new Error('Enter the product title.');
  return {
    observation_id: `page-${Date.now()}`,
    url: url.href,
    domain: url.hostname.toLowerCase(),
    source: 'page',
    title,
    price_cents,
    currency: extractedPage?.currency || 'USD',
    seller: extractedPage?.seller || url.hostname,
    sold_by_merchant: false,
    availability: extractedPage?.availability || 'unknown',
    image_url: null,
    category_hint: extractedPage?.category_hint || null,
    bundle_signal: extractedPage?.bundle_signal ?? null,
    hidden_text_found: extractedPage?.hidden_text_found || false,
    text: `${title}\n${text}`.slice(0, 4000),
    captured_at: extractedPage?.captured_at || new Date().toISOString(),
    content_hash: '',
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  if (busy) { button.dataset.label = button.textContent; button.textContent = text; }
  else if (button.dataset.label) { button.textContent = button.dataset.label; delete button.dataset.label; }
}

function renderProfiles(response) {
  const profiles = response.profiles || [];
  const defaultProfile = profiles.find(profile => profile.is_default && profile.status === 'active');
  noPreferences.hidden = Boolean(defaultProfile);
  form.hidden = !defaultProfile;
  if (!defaultProfile) return false;
  mandateSelect.replaceChildren(new Option('Use default preferences', ''));
  mandateSelect.hidden = true;
  return true;
}

async function connect() {
  clearError();
  const apiUrl = baseUrl();
  let parsedApiUrl;
  try { parsedApiUrl = new URL(apiUrl); } catch { showError('Enter a valid API URL.'); return; }
  if (!['http:', 'https:'].includes(parsedApiUrl.protocol)) { showError('Enter an HTTP or HTTPS API address.'); return; }
  if (parsedApiUrl.hostname !== 'localhost' && parsedApiUrl.hostname !== '127.0.0.1') {
    const granted = await chrome.permissions.request({ origins: [`${parsedApiUrl.origin}/*`] });
    if (!granted) { showError('Permission to connect to this API address was not granted.'); return; }
  }
  localStorage.setItem('mandateguard_api_url', apiUrl);
  localStorage.setItem('mandateguard_api_key', $('#api-key').value.trim());
  await chrome.storage.local.set({ apiBase: apiUrl, apiKey: $('#api-key').value.trim() });
  api = createApi({ baseUrl: apiUrl, apiKey: $('#api-key').value.trim() });
  setBusy($('#connect'), true, 'Connecting…');
  try {
    const profileResponse = await api.getProfiles();
    connectionStatus(true);
    const hasPreferences = renderProfiles(profileResponse);
    preferences.hidden = hasPreferences;
    connectionForm.hidden = true;
    if (hasPreferences && !pageCheckForbidden) await analyzeCurrentPage();
  } catch (cause) {
    connectionStatus(false);
    showError(cause instanceof Error ? cause.message : 'Could not connect to the MandateGuard API.');
  } finally { setBusy($('#connect'), false); }
}

function renderResult(evaluation) {
  latestEvaluation = evaluation;
  result.replaceChildren();
  const observation = evaluation.observation;
  const heading = element('h2', observation.title);
  const pill = element('span', evaluation.decision === 'ALLOW' ? 'Allowed' : evaluation.decision === 'BLOCK' ? 'Blocked' : 'Needs review', `decision-pill decision-${evaluation.decision.toLowerCase()}`);
  result.append(pill, heading, element('p', `${money(observation.price_cents, observation.currency)} · ${observation.domain}`, 'product-meta'));

  if (evaluation.decision === 'ALLOW') {
    result.append(element('p', 'Matches your preferences', 'match-copy'));
    const actions = element('div', undefined, 'result-actions');
    const createProposal = element('button', 'Buy now', 'primary-action'); createProposal.type = 'button';
    createProposal.setAttribute('aria-label', `Buy now ${observation.title}`);
    createProposal.addEventListener('click', () => showBuyConfirmation(evaluation.evaluation_id, observation, actions));
    actions.append(createProposal, element('span', 'PayPal sandbox', 'decision-pill'));
    if (observation.checkout_mode === 'handoff') {
      const open = element('button', `Open at ${observation.domain}`, 'text-action'); open.type = 'button';
      open.addEventListener('click', () => void openHandoff(evaluation.evaluation_id, open)); actions.append(open);
    }
    result.append(actions);
    const evidenceButton = element('button', 'Show evidence', 'text-action');
    evidenceButton.type = 'button';
    const evidence = renderEvidence(evaluation, observation);
    evidence.hidden = true;
    evidenceButton.addEventListener('click', () => {
      evidence.hidden = !evidence.hidden;
      evidenceButton.textContent = evidence.hidden ? 'Show evidence' : 'Hide evidence';
    });
    result.append(evidenceButton, evidence);
  } else {
    const reasonList = element('ul', undefined, 'reason-list');
    for (const reason of evaluation.reasons || []) reasonList.append(element('li', reason.message));
    result.append(reasonList);
    const quote = element('blockquote', `“${observation.text}”`, 'listing-evidence');
    result.append(quote);
    const alternatives = evaluation.alternatives || [];
    if (alternatives.length) {
      result.append(element('h3', 'Allowed alternatives'));
      const list = element('div', undefined, 'alternative-list');
      for (const alternative of alternatives.slice(0, 3)) list.append(renderAlternative(alternative));
      result.append(list);
    } else {
      result.append(element('p', 'No allowed alternative found.'));
      const searchAgain = element('button', 'Find alternatives', 'text-action');
      searchAgain.type = 'button';
      searchAgain.addEventListener('click', () => void searchAgainFor(observation, searchAgain));
      result.append(searchAgain);
    }
  }
  result.hidden = false;
  sendBadge(evaluation.decision);
  void rememberCheck(observation, evaluation.decision);
}

async function rememberCheck(observation, decision) {
  const { recentChecks = [] } = await chrome.storage.local.get('recentChecks');
  const next = [{ title: observation.title, url: observation.url, domain: observation.domain,
    price: observation.price_cents == null ? null : money(observation.price_cents, observation.currency), decision,
    time: new Date().toISOString() }, ...recentChecks].slice(0, 10);
  await chrome.storage.local.set({ recentChecks: next }); renderHistory(next);
}

function renderHistory(entries) {
  const list = $('#history-list'); list.replaceChildren();
  for (const entry of entries) {
    const button = element('button', `${entry.title} · ${entry.price ?? 'Price unknown'} · ${entry.domain} · ${entry.decision} · ${new Date(entry.time).toLocaleString()}`, 'history-entry');
    button.type = 'button'; button.setAttribute('aria-label', `Reopen ${entry.title} at ${entry.domain}`);
    button.addEventListener('click', () => chrome.tabs.create({ url: entry.url })); list.append(button);
  }
  $('#recent-checks').hidden = entries.length === 0;
}

function renderEvidence(evaluation, observation) {
  const section = element('section', undefined, 'evidence-details');
  const reasons = element('ul');
  for (const reason of evaluation.reasons || []) reasons.append(element('li', reason.message));
  const checks = element('ul');
  for (const check of evaluation.checks || []) checks.append(element('li', `${check.code.replaceAll('_', ' ')}: ${check.passed ? 'Passed' : 'Failed'}`));
  section.append(element('h3', 'Reasons'), reasons, element('h3', 'Checks'), checks,
    element('blockquote', `“${observation.text}”`, 'listing-evidence'));
  return section;
}

function renderAlternative(alternative) {
  const observation = alternative.observation;
  const row = element('article', undefined, 'alternative');
  const link = element('a', observation.title);
  link.href = observation.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  row.append(link, element('p', `${money(observation.price_cents, observation.currency)} · ${observation.domain}`));
  const actions = element('div', undefined, 'result-actions');
  const use = element('button', 'Buy now', 'primary-action');
  use.type = 'button';
  use.setAttribute('aria-label', `Buy now ${observation.title}`);
  use.addEventListener('click', () => showBuyConfirmation(alternative.evaluation_id, observation, actions));
  actions.append(use, element('span', 'PayPal sandbox', 'decision-pill'));
  if (alternative.checkout_mode === 'handoff') { const open = element('button', `Open at ${observation.domain}`, 'text-action'); open.type = 'button'; open.addEventListener('click', () => void openHandoff(alternative.evaluation_id, open)); actions.append(open); }
  row.append(actions);
  return row;
}

function showBuyConfirmation(evaluationId, observation, container) {
  container.replaceChildren();
  const message = observation.checkout_mode === 'gateway'
    ? 'This is a sandbox order on the MandateGuard demo store. No real purchase or shipment happens.'
    : `This creates a PayPal sandbox order. Nothing is purchased at ${observation.domain} and no real money moves.`;
  container.append(element('p', message, 'match-copy'));
  const proceed = element('button', 'Continue', 'primary-action'); proceed.type = 'button';
  proceed.setAttribute('aria-label', `Continue to PayPal for ${observation.title}`);
  proceed.addEventListener('click', () => void createProposalAndPay(evaluationId, proceed));
  const cancel = element('button', 'Cancel', 'text-action'); cancel.type = 'button';
  cancel.addEventListener('click', () => { container.replaceChildren(); });
  container.append(proceed, cancel);
}

async function openHandoff(evaluationId, button) {
  clearError(); setBusy(button, true, 'Opening…');
  try {
    const { handoff_url } = await api.handoff(evaluationId);
    chrome.tabs.create({ url: handoff_url });
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'The product page could not be opened.'); }
  finally { setBusy(button, false); }
}

async function createProposalAndPay(evaluationId, button) {
  clearError(); setBusy(button, true, 'Creating proposal…');
  try {
    const { proposal } = await api.createProposal(evaluationId);
    const target = new URL('/app/#/console', baseUrl());
    target.searchParams.set('proposal_id', proposal.proposal_id);
    chrome.tabs.create({ url: target.href });
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'The proposal could not be created.'); }
  finally { setBusy(button, false); }
}

async function useAlternative(evaluationId, button) {
  clearError(); setBusy(button, true, 'Opening…');
  try {
    const { proposal } = await api.createProposal(evaluationId);
    const target = new URL('/app/#/console', baseUrl());
    target.searchParams.set('proposal_id', proposal.proposal_id);
    chrome.tabs.create({ url: target.href });
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'The alternative could not be selected.'); }
  finally { setBusy(button, false); }
}

async function searchAgainFor(observation, button) {
  clearError(); setBusy(button, true, 'Searching…');
  try {
    const found = await api.search(observation.title, observation);
    const alternatives = found.alternatives || found.results || [];
    if (!alternatives.length) { button.textContent = 'No allowed alternative found.'; button.disabled = true; return; }
    const updated = { ...latestEvaluation, alternatives };
    renderResult(updated);
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'Alternative search failed.'); }
  finally { if (button.isConnected && !button.disabled) setBusy(button, false); }
}

async function analyzeCurrentPage() {
  clearError(); result.hidden = true;
  let observation;
  try {
    observation = productObservation();
    observation.content_hash = await sha256(observation.text);
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'Enter the page details to evaluate.'); return; }
  setBusy(submitButton, true, 'Checking…');
  try { renderResult(await api.evaluate(observation)); }
  catch (cause) { sendBadge(''); showError(cause instanceof Error ? cause.message : 'The page could not be evaluated.'); }
  finally { setBusy(submitButton, false); }
}

async function savePreferences(event) {
  event.preventDefault(); clearError();
  const amount = Number($('#maximum-amount').value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) { showError('Enter an amount from $0.01 to $1,000.00.'); return; }
  const button = $('#save-preferences'); setBusy(button, true, 'Saving…');
  try {
    const created = await api.createProfile({ max_total: amount.toFixed(2), allow_bundles: $('#allow-bundles').checked,
      allow_addons: $('#allow-addons').checked, require_first_party: true,
      allowed_domains: ['amazon.com', 'walmart.com', 'target.com', 'bestbuy.com', 'newegg.com', 'bhphotovideo.com'] });
    const confirmed = await api.confirmProfile(created.profile.mandate_id);
    await api.setDefaultProfile(confirmed.profile.mandate_id);
    preferences.hidden = true;
    form.hidden = false;
    noPreferences.hidden = true;
    await analyzeCurrentPage();
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'Preferences could not be saved.'); }
  finally { setBusy(button, false); }
}

function setConnectionValues() {
  $('#api-url').value = localStorage.getItem('mandateguard_api_url') || 'http://localhost:3000';
  $('#api-key').value = localStorage.getItem('mandateguard_api_key') || '';
  void chrome.storage.local.set({ apiBase: $('#api-url').value, apiKey: $('#api-key').value });
}

connectionForm.addEventListener('submit', event => { event.preventDefault(); void connect(); });
profileForm.addEventListener('submit', event => { void savePreferences(event); });
form.addEventListener('submit', event => { event.preventDefault(); void analyzeCurrentPage(); });
$('#set-preferences').addEventListener('click', openPreferences);
$('#settings-toggle').addEventListener('click', () => { connectionForm.hidden = !connectionForm.hidden; });
$('#show-api-key').addEventListener('click', () => {
  const input = $('#api-key'); const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
  $('#show-api-key').textContent = visible ? 'Hide API key' : 'Show API key';
});
narrowLink.addEventListener('click', event => { event.preventDefault(); narrowForm.hidden = !narrowForm.hidden; });
narrowForm.addEventListener('submit', async event => {
  event.preventDefault(); clearError();
  const instruction = $('#task-instruction').value.trim();
  const button = $('#create-task'); setBusy(button, true, 'Checking…');
  try {
    const task = await api.createTask(instruction);
    if (task.mandate.status !== 'active') throw new Error(task.notes?.join(' ') || 'This task needs your confirmation in the console.');
    let observation = productObservation(); observation.content_hash = await sha256(observation.text);
    renderResult(await api.evaluate(observation, task.mandate.mandate_id));
  } catch (cause) { showError(cause instanceof Error ? cause.message : 'The task could not be created.'); }
  finally { setBusy(button, false); }
});

chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
  activeTab = tabs[0] ?? null;
  const forbidden = !activeTab?.id || /^(chrome|edge|file):\/\//i.test(activeTab.url || '') || /chromewebstore\.google\.com|chrome\.google\.com\/webstore/i.test(activeTab.url || '');
  if (forbidden) { pageCheckForbidden = true; void connect().finally(() => showError('This page cannot be checked.')); return; }
  chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/extract.js'] })
    .then(() => chrome.scripting.executeScript({ target: { tabId: activeTab.id }, func: () => window.__mgExtract?.() }))
    .then(results => {
      extractedPage = results?.[0]?.result ?? null;
      if (extractedPage) {
        urlInput.value = extractedPage.url; titleInput.value = extractedPage.title;
        priceInput.value = extractedPage.price_cents == null ? '' : `${Math.floor(extractedPage.price_cents / 100)}.${String(extractedPage.price_cents % 100).padStart(2, '0')}`;
        descriptionInput.value = extractedPage.text;
      }
      void connect();
    }).catch(() => { if (activeTab?.url) urlInput.value = activeTab.url; void connect(); });
});

mandateSelect.hidden = true;
setConnectionValues();
connectionForm.hidden = false;
api = createApi({ baseUrl: $('#api-url').value, apiKey: $('#api-key').value });
void chrome.storage.local.get('recentChecks').then(({ recentChecks = [] }) => renderHistory(recentChecks));
$('#clear-history').addEventListener('click', async () => { await chrome.storage.local.set({ recentChecks: [] }); renderHistory([]); });
