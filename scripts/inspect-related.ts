const sourceId = process.argv[2] ?? '1057';
for (const endpoint of [`/api/seasons/${sourceId}`, `/api/watch-order/${sourceId}`]) {
  const response = await fetch(`https://anikototv.to${endpoint}`, {
    headers: { accept: 'application/json', referer: 'https://anikototv.to/' },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  console.log(JSON.stringify({ endpoint, httpStatus: response.status, payload }, null, 2));
}
export {};
