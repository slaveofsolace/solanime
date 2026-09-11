const target = process.argv[2] ?? 'https://anikototv.to/filter';
export {};
const response = await fetch(target, {
  redirect: 'follow',
  headers: {
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'en-US,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (compatible; SolAnimeSchoolProject/0.1; +local-documentary-research)',
  },
  signal: AbortSignal.timeout(20_000),
});
const body = await response.text();
console.log(JSON.stringify({ requested: target, finalUrl: response.url, status: response.status, contentType: response.headers.get('content-type'), bytes: Buffer.byteLength(body), title: /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1] ?? null }, null, 2));
