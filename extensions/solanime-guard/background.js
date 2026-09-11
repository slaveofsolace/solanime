import {
  buildRules,
  isProjectUrl,
  isProviderUrl,
  playerCss,
  settings,
  theme,
  validateHosts,
} from './policy.js';
let chain = Promise.resolve();
function enqueue(operation) {
  const task = chain.then(operation);
  chain = task.catch(() => {});
  return task;
}
async function currentOptions() {
  const data = await chrome.storage.local.get('options');
  return settings(data.options);
}
async function projectTabs() {
  return (await chrome.tabs.query({}))
    .filter((tab) => tab.id !== undefined && isProjectUrl(tab.url))
    .map((tab) => tab.id);
}
async function refreshRules() {
  const options = await currentOptions();
  const ids = await projectTabs();
  const old = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: old.map((rule) => rule.id),
    addRules: buildRules(ids, options),
  });
}
async function topIsProject(tabId) {
  try {
    return isProjectUrl((await chrome.webNavigation.getFrame({ tabId, frameId: 0 }))?.url);
  } catch {
    return false;
  }
}
async function setFrameTheme(tabId, frame, value) {
  if (!frame.documentId || !isProviderUrl(frame.url) || !(await topIsProject(tabId))) return;
  const options = await currentOptions();
  const key = `css:${tabId}:${frame.documentId}`;
  const previous = (await chrome.storage.session.get(key))[key];
  const css = options.enabled ? playerCss(value) : null;
  if (previous === css) return;
  const target = { tabId, documentIds: [frame.documentId] };
  try {
    if (previous) await chrome.scripting.removeCSS({ target, css: previous, origin: 'USER' });
    if (css) {
      await chrome.scripting.insertCSS({ target, css, origin: 'USER' });
      await chrome.storage.session.set({ [key]: css });
    } else await chrome.storage.session.remove(key);
  } catch {
    await chrome.storage.session.remove(key); /* The frame may have navigated away. */
  }
}
async function applyToTab(tabId) {
  if (!(await topIsProject(tabId))) return;
  const value = (await chrome.storage.session.get(`theme:${tabId}`))[`theme:${tabId}`];
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  for (const frame of frames ?? [])
    if (frame.frameId !== 0) await setFrameTheme(tabId, frame, value);
}
async function purgeTab(tabId) {
  const data = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(
    Object.keys(data).filter((key) => key === `theme:${tabId}` || key.startsWith(`css:${tabId}:`)),
  );
}
chrome.runtime.onInstalled.addListener(() => {
  void enqueue(refreshRules);
});
chrome.runtime.onStartup.addListener(() => {
  void enqueue(refreshRules);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    await purgeTab(tabId);
    await refreshRules();
  });
});
chrome.webNavigation.onCommitted.addListener((details) => {
  void enqueue(async () => {
    if (details.frameId === 0) {
      await purgeTab(details.tabId);
      await refreshRules();
    } else {
      const data = await chrome.storage.session.get(null);
      const active = new Set(
        ((await chrome.webNavigation.getAllFrames({ tabId: details.tabId })) ?? []).map(
          (frame) => `css:${details.tabId}:${frame.documentId}`,
        ),
      );
      await chrome.storage.session.remove(
        Object.keys(data).filter(
          (key) => key.startsWith(`css:${details.tabId}:`) && !active.has(key),
        ),
      );
    }
  });
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  enqueue(async () => {
    const popup =
      sender.id === chrome.runtime.id &&
      sender.url === chrome.runtime.getURL('popup.html') &&
      !sender.tab;
    if (popup) {
      if (message?.type === 'get-options')
        return { options: await currentOptions(), tabs: (await projectTabs()).length };
      if (message?.type === 'set-options') {
        const value = message.value;
        if (!value || typeof value.enabled !== 'boolean' || typeof value.strict !== 'boolean')
          throw new Error('Invalid settings.');
        const options = {
          enabled: value.enabled,
          strict: value.strict,
          mediaHosts: validateHosts(value.mediaHosts),
        };
        await chrome.storage.local.set({ options });
        await refreshRules();
        for (const tabId of await projectTabs()) await applyToTab(tabId);
        return { options };
      }
    }
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !(await topIsProject(tabId)))
      throw new Error('Not a Solanime tab.');
    if (message?.type === 'theme' && sender.frameId === 0 && isProjectUrl(sender.url)) {
      // Reject messages from a top document replaced by navigation since it sent them.
      const current = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
      if (current?.documentId !== sender.documentId) throw new Error('Stale document.');
      await chrome.storage.session.set({ [`theme:${tabId}`]: theme(message.value) });
      await refreshRules();
      await applyToTab(tabId);
      return { ok: true };
    }
    if (message?.type === 'player-ready' && sender.frameId > 0 && isProviderUrl(sender.url)) {
      const frame = await chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId });
      if (frame?.documentId !== sender.documentId) throw new Error('Stale frame.');
      const value = (await chrome.storage.session.get(`theme:${tabId}`))[`theme:${tabId}`];
      await setFrameTheme(tabId, frame, value);
      return { ok: true };
    }
    throw new Error('Unsupported message.');
  }).then(
    (result) => respond(result),
    (error) => respond({ error: error.message }),
  );
  return true;
});
// Session rules survive worker suspension but not browser restart.
void enqueue(refreshRules);
