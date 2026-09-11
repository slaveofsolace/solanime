const mappingId = process.argv[2];
const language = process.argv[3] ?? 'sub';
if (!mappingId || !/^\d+$/.test(mappingId)) throw new Error('Usage: pnpm tsx scripts/verify-local-resolution.ts <mapping-id> [language]');
const response = await fetch(`http://127.0.0.1:8787/api/providers/${mappingId}/resolve`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ language }),
  signal: AbortSignal.timeout(30_000),
});
const payload = await response.json() as Record<string, unknown>;
if ('embedUrl' in payload && typeof payload.embedUrl === 'string') {
  const url = new URL(payload.embedUrl);
  payload.embedUrl = `${url.origin}${url.pathname}${url.search ? '?[redacted]' : ''}`;
}
console.log(JSON.stringify({ httpStatus: response.status, payload }, null, 2));
export {};
