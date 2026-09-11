import { load } from 'cheerio';

const sourceId = process.argv[2] ?? '1057';
const episodeNumber = process.argv[3] ?? '1';
const listResponse = await fetch(`https://anikototv.to/ajax/episode/list/${encodeURIComponent(sourceId)}?vrf=`, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' }, signal: AbortSignal.timeout(20_000) });
const listPayload = await listResponse.json() as { result?: unknown };
const listHtml = typeof listPayload.result === 'string' ? listPayload.result : '';
const list = load(listHtml);
const item = list(`a[data-num="${episodeNumber.replaceAll('"', '')}"]`).first();
const serversRef = item.attr('data-ids');
if (!serversRef) throw new Error('Episode did not expose a server-list reference.');
const response = await fetch(`https://anikototv.to/ajax/server/list?servers=${encodeURIComponent(serversRef)}`, { headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' }, signal: AbortSignal.timeout(20_000) });
const payload = await response.json() as { status?: unknown; result?: unknown };
const html = typeof payload.result === 'string' ? payload.result : '';
const $ = load(html);
console.log(JSON.stringify({
  status: response.status,
  envelopeStatus: payload.status,
  bytes: Buffer.byteLength(html),
  groups: $('[data-type],.server-items').map((_index, group) => ({ attrs: group.attribs, text: $(group).text().replace(/\s+/g, ' ').trim().slice(0, 500) })).get(),
  buttons: $('[data-link-id]').map((_index, button) => ({
    label: $(button).text().replace(/\s+/g, ' ').trim(),
    class: $(button).attr('class'),
    episodeId: $(button).attr('data-ep-id'),
    cmid: $(button).attr('data-cmid'),
    serverId: $(button).attr('data-sv-id'),
    linkIdLength: $(button).attr('data-link-id')?.length,
    parents: $(button).parents().slice(0, 3).map((_i, parent) => `${parent.tagName}.${$(parent).attr('class') ?? ''}[${$(parent).attr('data-type') ?? ''}]`).get(),
  })).get(),
}, null, 2));
