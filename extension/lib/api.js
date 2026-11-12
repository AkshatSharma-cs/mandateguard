// extension/lib/api.js
export function createApi({ baseUrl, apiKey = '', fetchImpl = fetch }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Enter a valid API URL.');
  const headers = { 'content-type': 'application/json' };
  if (apiKey.trim()) headers['x-api-key'] = apiKey.trim();

  async function request(path, { method = 'GET', body } = {}) {
    const friendly = (code, fallback) => ({
      NETWORK_ERROR: 'The API could not be reached. Check the API address and try again.',
      BAD_API_KEY: 'The API key was not accepted. Check Settings.',
      UNAUTHORIZED: 'The API key was not accepted. Check Settings.',
      RATE_LIMITED: 'Too many requests. Wait a little, then retry.',
      NO_PREFERENCES: 'No active limits yet. Set preferences in MandateGuard.',
      PRICE_UNKNOWN: 'This listing has no price, so it cannot be paid.',
    })[code] || fallback;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage && fetchImpl === fetch) {
      let result;
      try { result = await chrome.runtime.sendMessage({ type: 'api', path, method, body }); }
      catch { throw new Error('The API could not be reached. Check the API URL and try again.'); }
      if (!result?.ok) throw new Error(friendly(result?.data?.error?.code, result?.data?.error?.message || `The API request failed (${result?.status ?? 0}).`));
      if (!result.data || typeof result.data !== 'object') throw new Error('The API returned an invalid response.');
      return result.data;
    }
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error('The API could not be reached. Check the API URL and try again.');
    }
    let value;
    try { value = await response.json(); } catch { value = null; }
    if (!response.ok) throw new Error(friendly(value?.error?.code, value?.error?.message || `The API request failed (${response.status}).`));
    if (!value || typeof value !== 'object') throw new Error('The API returned an invalid response.');
    return value;
  }

  return Object.freeze({
    getProfiles: () => request('/v1/profiles'),
    createProfile: limits => request('/v1/profiles', { method: 'POST', body: { limits } }),
    confirmProfile: id => request(`/v1/profiles/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: {} }),
    setDefaultProfile: id => request(`/v1/profiles/${encodeURIComponent(id)}/default`, { method: 'POST', body: {} }),
    createTask: instruction => request('/v1/mandates', { method: 'POST', body: { instruction } }),
    evaluate: (observation, mandate_id) => request('/v1/evaluate', { method: 'POST', body: { observation, ...(mandate_id ? { mandate_id } : {}) } }),
    createProposal: evaluation_id => request('/v1/proposals', { method: 'POST', body: { evaluation_id } }),
    handoff: evaluation_id => request(`/v1/evaluations/${encodeURIComponent(evaluation_id)}/handoff`, { method: 'POST', body: {} }),
    search: (query, observation) => request('/v1/search', { method: 'POST', body: { query, ...(observation ? { observation } : {}) } }),
  });
}
