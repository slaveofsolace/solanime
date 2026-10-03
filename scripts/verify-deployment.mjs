import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const release = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
/** Check the served release, not a local build or a provider iframe load event. */
export async function inspectDeployment(address, fetcher = fetch) {
  const target = new URL(address);
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw Error('Use an HTTP(S) site origin without credentials, query or fragment.');
  const origin = target.origin;
  const get = (path) =>
    fetcher(`${origin}${path}`, {
      headers: { 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
  const [page, api] = await Promise.all([get('/'), get('/api/health')]);
  const html = await page.text();
  const frontend = /<meta\s+name="solanime-release"\s+content="([^"]+)"/i.exec(html)?.[1] ?? null;
  const json = api.headers.get('content-type')?.includes('application/json')
    ? await api.json()
    : null;
  const csp = page.headers.get('content-security-policy') ?? '';
  const frameSources = /(?:^|;)\s*frame-src\s+([^;]+)\s*(?:;|$)/i
    .exec(csp)?.[1]
    ?.trim()
    .split(/\s+/)
    .filter(Boolean) ?? [];
  const checks = {
    page: page.ok,
    framesRestrictedToApprovedPlayers:
      frameSources.length === 3 &&
      frameSources.includes('https://www.youtube-nocookie.com/embed/') &&
      frameSources.includes('https://megaplay.buzz/stream/s-2/') &&
      // Cloudflare Turnstile on sign-up and recovery.
      frameSources.includes('https://challenges.cloudflare.com'),
    frontendCurrent: frontend === release,
    apiCurrent: api.ok && json?.status === 'ok' && json?.release === release,
    noParentSandboxPolicy: !/(?:^|;)\s*sandbox(?:\s|;|$)/i.test(csp),
  };
  return {
    expected: release,
    origin,
    frontend,
    backend: json?.release ?? null,
    checks,
    passed: Object.values(checks).every(Boolean),
    note: 'This checks the deployed application version and exact frame-host policy; it does not certify media availability, playback, or redirect protection. Browser-only playback and optional Desktop Guard must be verified separately; the restored default has no iframe sandbox.',
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2])
      throw Error('Usage: pnpm run verify:deployment -- https://your-site.example');
    const address = process.argv.slice(2).find((arg) => arg !== '--');
    const result = await inspectDeployment(address);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
