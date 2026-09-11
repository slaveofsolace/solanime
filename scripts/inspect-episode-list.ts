import { load } from 'cheerio';

const sourceId = process.argv[2] ?? '1057';
const response = await fetch(`https://anikototv.to/ajax/episode/list/${encodeURIComponent(sourceId)}?vrf=`, {
  headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' },
  signal: AbortSignal.timeout(20_000),
});
const payload = await response.json() as { status?: unknown; result?: unknown };
const html = typeof payload.result === 'string' ? payload.result : '';
const $ = load(html);
console.log(JSON.stringify({
  status: response.status,
  envelopeStatus: payload.status,
  bytes: Buffer.byteLength(html),
  count: $('a').length,
  textPreview: $.root().text().replace(/\s+/g, ' ').trim().slice(0, 240),
  elementSummary: $('*').slice(0, 20).map((_index, item) => ({ tag: $(item).prop('tagName') ?? null, id: $(item).attr('id') ?? null, className: $(item).attr('class') ?? null })).get(),
  samples: $('a').slice(0, 3).add($('a').slice(-2)).map((_index, item) => ({ attrs: { ...item.attribs }, text: $(item).text().replace(/\s+/g, ' ').trim(), html: $.html(item).slice(0, 1200) })).get(),
}, null, 2));
