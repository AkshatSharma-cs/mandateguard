// extension/lib/api.js
export function createApi({ baseUrl, apiKey = '', fetchImpl = fetch }) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('Enter a valid API URL.');
  const headers = { 'content-type': 'application/json' };
  if (apiKey.trim()) headers['x-api-key'] = apiKey.trim();

  async function request(path, { method = 'GET', body } = {}) {
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
    if (!response.ok) throw new Error(value?.error?.message || `The API request failed (${response.status}).`);
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
    search: (query, observation) => request('/v1/search', { method: 'POST', body: { query, ...(observation ? { observation } : {}) } }),
  });
}
