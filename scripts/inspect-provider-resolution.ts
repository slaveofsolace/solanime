import { load } from 'cheerio';

const titleId = process.argv[2] ?? '1057';
const episodeNumber = process.argv[3] ?? '1';
const list = await fetch(`https://anikototv.to/ajax/episode/list/${encodeURIComponent(titleId)}?vrf=`, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' }, signal: AbortSignal.timeout(20_000) }).then((response) => response.json()) as { result?: unknown };
const episodes = load(typeof list.result === 'string' ? list.result : '');
const serversRef = episodes(`a[data-num="${episodeNumber.replaceAll('"', '')}"]`).first().attr('data-ids');
if (!serversRef) throw new Error('Episode did not expose a server reference.');
const serverList = await fetch(`https://anikototv.to/ajax/server/list?servers=${encodeURIComponent(serversRef)}`, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' }, signal: AbortSignal.timeout(20_000) }).then((response) => response.json()) as { result?: unknown };
const servers = load(typeof serverList.result === 'string' ? serverList.result : '');
const results: unknown[] = [];
for (const item of servers('.type[data-type="sub"] [data-link-id]').toArray()) {
  const label = servers(item).text().replace(/\s+/g, ' ').trim();
  const resource = servers(item).attr('data-link-id');
  if (!resource) continue;
  const response = await fetch(`https://anikototv.to/ajax/server?get=${encodeURIComponent(resource)}`, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' }, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as { status?: unknown; result?: { url?: unknown } | unknown };
  const rawUrl = payload.result && typeof payload.result === 'object' && 'url' in payload.result ? (payload.result as { url?: unknown }).url : undefined;
  let destination: unknown = null;
  if (typeof rawUrl === 'string') {
    const url = new URL(rawUrl);
    destination = { protocol: url.protocol, hostname: url.hostname, pathname: url.pathname, hasQuery: Boolean(url.search) };
  }
  results.push({ label, httpStatus: response.status, envelopeStatus: payload.status, destination });
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
console.log(JSON.stringify(results, null, 2));
