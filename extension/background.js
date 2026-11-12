// extension/background.js
const badgeColors = { ALLOW: '#0B6B3A', REVIEW: '#7A4F00', BLOCK: '#B3261E' };
const badgeLabels = { ALLOW: 'OK', REVIEW: 'REV', BLOCK: 'BLK' };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'decision' && Number.isInteger(message.tabId)) {
    const decision = message.decision;
    if (!badgeLabels[decision]) { void chrome.action.setBadgeText({ tabId: message.tabId, text: '' }); return; }
    void chrome.action.setBadgeBackgroundColor({ tabId: message.tabId, color: badgeColors[decision] });
    void chrome.action.setBadgeText({ tabId: message.tabId, text: badgeLabels[decision] });
    return;
  }
  if (message?.type !== 'api' || typeof message.path !== 'string') return;
  (async () => {
    try {
      const { apiBase = 'http://localhost:3000', apiKey = '' } = await chrome.storage.local.get(['apiBase', 'apiKey']);
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${String(apiBase).replace(/\/+$/, '')}${message.path}`, {
          method: message.method || 'GET', signal: controller.signal,
          headers: { 'content-type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey } : {}) },
          ...(message.body === undefined ? {} : { body: JSON.stringify(message.body) }),
        });
        let data; try { data = await response.json(); } catch { data = null; }
        sendResponse({ ok: response.ok, status: response.status, data });
      } finally { clearTimeout(timer); }
    } catch (error) { sendResponse({ ok: false, status: 0, data: { error: { code: 'NETWORK_ERROR', message: error?.name === 'AbortError' ? 'The API request timed out.' : 'The API could not be reached.' } } }); }
  })();
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') void chrome.action.setBadgeText({ tabId, text: '' });
});
