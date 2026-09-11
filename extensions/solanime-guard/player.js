// The worker checks the actual top-page URL and browser-issued document identity.
// Nothing is exposed to the player's page scripts.
if (window.top !== window) chrome.runtime.sendMessage({ type: 'player-ready' }).catch(() => {});
