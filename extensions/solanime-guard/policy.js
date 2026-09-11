export const DEFAULTS = { enabled: true, strict: false, mediaHosts: [] };
export const PROVIDER = 'megaplay.buzz';
// An independently maintained starter list, not an EasyList/AdBlock distribution.
export const TRACKERS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'connect.facebook.net',
  'hotjar.com',
  'clarity.ms',
  'popads.net',
  'popcash.net',
];
export function isProjectUrl(input) {
  try {
    const url = new URL(input);
    if (url.username || url.password) return false;
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1')
      return ['5173', '8787', '4173', '18787'].includes(url.port);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      (url.hostname === 'solanime.pages.dev' ||
        /^[a-z0-9-]+\.solanime\.pages\.dev$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
export function isProviderUrl(input) {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'https:' &&
      url.hostname === PROVIDER &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith('/stream/')
    );
  } catch {
    return false;
  }
}
export function validateHosts(value) {
  if (!Array.isArray(value) || value.length > 30)
    throw new Error('Use at most 30 media hostnames.');
  const hosts = value.map((host) => (typeof host === 'string' ? host.trim().toLowerCase() : ''));
  if (
    hosts.some(
      (host) =>
        host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host),
    )
  )
    throw new Error('Enter hostnames only, without paths, ports, wildcards, or IP addresses.');
  return [...new Set(hosts)];
}
export function settings(value) {
  let hosts = [];
  try {
    hosts = validateHosts(value?.mediaHosts ?? []);
  } catch {
    /* Reset malformed local preferences. */
  }
  return { enabled: value?.enabled !== false, strict: value?.strict === true, mediaHosts: hosts };
}
export function buildRules(tabIds, options) {
  const ids = [...new Set(tabIds.filter((id) => Number.isInteger(id) && id >= 0))];
  if (!options.enabled || !ids.length) return [];
  const common = { tabIds: ids, initiatorDomains: [PROVIDER] };
  // Omitting resourceTypes covers every subresource, including stylesheets and fonts.
  // Top-frame navigation has its own explicit rule below.
  const rules = [
    {
      id: 1,
      priority: 10,
      action: { type: 'block' },
      condition: {
        ...common,
        requestDomains: TRACKERS,
      },
    },
    {
      id: 2,
      priority: 10,
      action: { type: 'block' },
      condition: { ...common, resourceTypes: ['ping'], domainType: 'thirdParty' },
    },
    {
      id: 3,
      priority: 10,
      action: { type: 'block' },
      condition: { ...common, resourceTypes: ['main_frame'] },
    },
  ];
  // Strict mode is explicitly opt-in: unknown media/CDN hosts will also be blocked.
  if (options.strict)
    rules.push({
      id: 4,
      priority: 1,
      action: { type: 'block' },
      condition: {
        ...common,
        excludedRequestDomains: [PROVIDER, ...validateHosts(options.mediaHosts)],
        domainType: 'thirdParty',
      },
    });
  return rules;
}
const safeColor = (color, fallback) =>
  typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color) ? color.toUpperCase() : fallback;
export function theme(value) {
  return {
    accent: safeColor(value?.accent, '#E50914'),
    ink: safeColor(value?.ink, '#FF5360'),
    mode: value?.mode === 'light' ? 'light' : 'dark',
  };
}
export function playerCss(value) {
  const { accent, ink } = theme(value);
  // Known HTML controls only. Never hide the video, subtitles, paywall/error states,
  // security challenges, or provider controls behind a fake replacement UI.
  return `:root{--solanime-accent:${accent} !important;--plyr-color-main:${accent} !important;--jw-slider-color:${accent} !important;accent-color:${accent} !important;}
  .jwplayer,.plyr,.video-js{font-family:Arial,Helvetica,sans-serif !important;background:#141414 !important;}
  .jwplayer .jw-slider-horizontal .jw-progress,.jwplayer .jw-slider-vertical .jw-progress,.video-js .vjs-play-progress{background:${accent} !important;}
  .jwplayer .jw-icon:hover,.jwplayer .jw-button-color:hover,.video-js .vjs-control:hover{color:${ink} !important;}
  .jwplayer .jw-controlbar,.video-js .vjs-control-bar,.plyr--video .plyr__controls{background:linear-gradient(transparent,rgba(0,0,0,.94)) !important;color:#fff !important;}
  .jwplayer :focus-visible,.plyr :focus-visible,.video-js :focus-visible{outline:3px solid ${ink} !important;outline-offset:3px !important;}
  video{accent-color:${accent} !important;}`;
}
