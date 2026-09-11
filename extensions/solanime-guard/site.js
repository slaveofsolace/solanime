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
    chrome.runtime.sendMessage({ type: 'theme', value }).catch(() => {
      last = '';
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
