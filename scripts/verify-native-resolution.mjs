const option = (name) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = option('origin');
const mapping = option('mapping');
const language = option('language');
if (!['https://cloud-release.solanime.pages.dev', 'https://solanime.pages.dev'].includes(origin) || !/^\d{1,12}$/.test(mapping ?? '') || !/^[a-z][a-z0-9_-]{0,31}$/.test(language ?? '')) throw new Error('Supply a reviewed cloud --origin, numeric --mapping and --language.');
const started = Date.now();
const response = await fetch(`${origin}/api/providers/${mapping}/resolve`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ language }), redirect: 'manual', signal: AbortSignal.timeout(30_000),
});
const data = await response.json();
const result = data.result;
console.log(JSON.stringify({ origin, mappingId: mapping, language, status: response.status,
  elapsedMs: Date.now() - started, kind: result?.kind ?? null, providerId: result?.providerId ?? null,
  format: result?.kind === 'native' ? result.format : null,
  mediaHostname: result?.kind === 'native' ? new URL(result.url).hostname : null,
  error: result?.kind === 'unsupported' ? result.error : data.error ?? null,
  playbackVerified: false, note: 'Resolution only. Browser media progression must be verified separately; temporary URLs are not printed.' }, null, 2));
if (!response.ok || result?.kind !== 'native') process.exitCode = 1;
