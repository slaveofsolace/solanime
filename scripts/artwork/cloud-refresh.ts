import { boundedArtworkBody } from '../../server/artwork/source.ts';

const values = process.argv.slice(2);
const option = (name: string) => values.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const origin = option('origin');
const key = option('key');
const matchIds = values.filter(value => value.startsWith('--match-id=')).map(value => value.slice(11));
if (values.some(value => value !== '--execute' && !/^--(?:origin|key|match-id)=/.test(value))
  || origin !== 'https://cloud-release.solanime.pages.dev' || !key || !/^[a-zA-Z0-9:_-]{1,80}$/.test(key)
  || matchIds.length < 1 || matchIds.length > 5 || new Set(matchIds).size !== matchIds.length
  || matchIds.some(id => !/^anikoto:[A-Za-z0-9_-]{1,100}:anilist:[1-9][0-9]{0,14}$/.test(id))) {
  throw new Error('Use the exact review --origin, a stable --key and one to five distinct --match-id values. This command cannot discover or approve a match.');
}
const body = { key, matchIds };
if (!values.includes('--execute')) {
  console.log(JSON.stringify({ mode: 'dry-run', origin, path: '/api/admin/artwork/refresh', body, requests: 0, writes: 0, note: 'The server must independently validate existing reviewed identities. Add --execute only for the explicit bounded refresh.' }, null, 2));
} else {
  const token = process.env.SOLANIME_ADMIN_TOKEN;
  if (!token || token.length < 32) throw new Error('Set the operator token privately in the process environment. It is never accepted in command arguments.');
  try {
    const response = await fetch(origin + '/api/admin/artwork/refresh', {
      method: 'POST', headers: { 'x-admin-token': token, origin, 'content-type': 'application/json' },
      body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(20_000),
    });
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel(); throw new Error('non_json_response'); }
    const result = JSON.parse(new TextDecoder().decode(await boundedArtworkBody(response, 64_000))) as { job?: { status?: string; runId?: number; runStatus?: string }; dispatch?: { dispatched?: number; status?: string; retryAt?: string }; error?: { code?: string } };
    const safe = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : null;
    console.log(JSON.stringify({ mode: 'execute', origin, httpStatus: response.status,
      ...(response.ok ? { job: { status: safe(result.job?.status), runId: Number.isSafeInteger(result.job?.runId) ? result.job?.runId : null, runStatus: safe(result.job?.runStatus) }, dispatch: { status: safe(result.dispatch?.status), dispatched: result.dispatch?.dispatched, retryAt: safe(result.dispatch?.retryAt) } } : { code: safe(result.error?.code), retryAfter: safe(response.headers.get('retry-after')) }),
    }, null, 2).replaceAll(token, '[redacted]'));
    if (response.status !== 202 || !Number.isSafeInteger(result.job?.runId)) process.exitCode = 2;
  } catch {
    console.error(JSON.stringify({ mode: 'execute', origin, status: 'request_failed', note: 'No credentials or upstream response body were retained. Reuse the same stable key after checking operator status.' }));
    process.exitCode = 2;
  }
}
