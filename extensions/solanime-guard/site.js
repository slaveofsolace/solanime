(() => {
  if (window.top !== window) return;
  const url = new URL(location.href);
  const allowed =
    (url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      ['5173', '8787', '4173', '18787'].includes(url.port)) ||
    (url.protocol === 'https:' &&
      !url.port &&
      (url.hostname === 'solanime.pages.dev' ||
        /^[a-z0-9-]+\.solanime\.pages\.dev$/.test(url.hostname)));
  if (!allowed) return;
  let timer;
  let last = '';
  const markGuard = (active, version = '') => {
    const root = document.documentElement;
    if (!root) return;
    root.dataset.solanimeGuard = active ? 'active' : 'inactive';
    if (active && version) root.dataset.solanimeGuardVersion = version;
    else delete root.dataset.solanimeGuardVersion;
    window.dispatchEvent(new Event('solanime-guard-status'));
  };
  const publish = () => {
    if (!document.documentElement) return;
    const root = document.documentElement;
    const value = {
      accent: root.dataset.accent,
      ink: getComputedStyle(root).getPropertyValue('--player-accent').trim(),
      mode: root.dataset.theme,
    };
    const signature = JSON.stringify(value);
    if (signature === last) return;
    last = signature;
    chrome.runtime.sendMessage({ type: 'theme', value }).then((response) => {
      const guard = response?.guard;
      markGuard(guard?.enabled === true && guard?.navigationBlock === true, guard?.version);
    }).catch(() => {
      last = '';
      markGuard(false);
    });
  };
  const observe = () => {
    const root = document.documentElement;
    if (!root) return;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(publish, 40);
    }).observe(root, { attributes: true, attributeFilter: ['data-accent', 'data-theme', 'style'] });
    publish();
  };
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });
  window.addEventListener('pageshow', () => {
    last = '';
    publish();
  });
})();
