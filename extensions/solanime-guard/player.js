// The worker checks the top-page URL and browser-issued document identity.
// This isolated-world listener leaves legitimate player buttons and the
// provider's javascript: Skip Intro/Outro controls intact.
if (window.top !== window) {
  let enabled = true;
  chrome.runtime.sendMessage({ type: 'player-ready' })
    .then((response) => { enabled = response?.enabled !== false; })
    .catch(() => { enabled = false; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.options) enabled = changes.options.newValue?.enabled !== false;
  });
  const stopExternalLink = (event) => {
    if (!enabled || !(event.target instanceof Element)) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') ?? '';
    if (/^javascript:/i.test(href)) return;
    let destination;
    try { destination = new URL(href, location.href); }
    catch { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (destination.origin === location.origin &&
        destination.pathname.startsWith('/stream/') &&
        !['_blank', '_top', '_parent'].includes(link.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener('click', stopExternalLink, true);
  window.addEventListener('auxclick', stopExternalLink, true);
}
