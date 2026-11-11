// extension/service-worker.js
const badgeColors = { ALLOW: '#0B6B3A', REVIEW: '#7A4F00', BLOCK: '#B3261E' };
const badgeLabels = { ALLOW: 'OK', REVIEW: 'REV', BLOCK: 'BLK' };

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'decision' || !Number.isInteger(message.tabId)) return;
  const decision = message.decision;
  if (!badgeLabels[decision]) {
    void chrome.action.setBadgeText({ tabId: message.tabId, text: '' });
    return;
  }
  void chrome.action.setBadgeBackgroundColor({ tabId: message.tabId, color: badgeColors[decision] });
  void chrome.action.setBadgeText({ tabId: message.tabId, text: badgeLabels[decision] });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') void chrome.action.setBadgeText({ tabId, text: '' });
});

