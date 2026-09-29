'use strict';

const SITE = 'https://solanime.pages.dev/';
const SITE_HOST = 'solanime.pages.dev';
const EMBED_HOSTS = new Set(['megaplay.buzz', 'www.youtube-nocookie.com']);

function permittedDocument(rawUrl, mainFrame) {
  if (!mainFrame && rawUrl === 'about:blank') return true;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443')) return false;
  if (url.hostname === SITE_HOST) return true;
  return !mainFrame && EMBED_HOSTS.has(url.hostname);
}

function observedAdRequest(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname;
    return host === 'wuytg.com' || host.endsWith('.wuytg.com');
  } catch {
    return false;
  }
}

function safeHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return 'invalid';
  }
}

module.exports = { SITE, permittedDocument, observedAdRequest, safeHost };
