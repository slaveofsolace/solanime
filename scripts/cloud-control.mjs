const action = process.argv[2] ?? 'status';
const origin = process.argv.find(value => value.startsWith('--origin='))?.slice(9);
if (!origin || !['https://cloud-release.solanime.pages.dev', 'https://solanime.pages.dev'].includes(origin)) throw new Error('Supply the exact reviewed preview or production --origin.');
const token = process.env.SOLANIME_ADMIN_TOKEN;
if (!token || token.length < 32) throw new Error('Set SOLANIME_ADMIN_TOKEN privately in the current shell.');
const routes = { status: '/api/admin/import/status', start: '/api/admin/import/start', refresh: '/api/admin/sync/start', dispatch: '/api/admin/import/dispatch' };
if (!Object.hasOwn(routes, action)) throw new Error('Choose status, start, refresh, or dispatch. Use the operator UI for individual run controls.');
const response = await fetch(origin + routes[action], {
  method: action === 'status' ? 'GET' : 'POST',
  headers: { 'x-admin-token': token, Origin: origin, 'Content-Type': 'application/json' },
  ...(action === 'status' ? {} : { body: '{}' }),
  redirect: 'manual', signal: AbortSignal.timeout(30_000),
});
if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`The application returned a non-JSON response (${response.status}).`);
const result = await response.json();
if (!response.ok) { console.error(JSON.stringify({ status: response.status, code: result.error?.code ?? 'UNKNOWN', retryAfter: response.headers.get('retry-after') })); process.exitCode = 1; }
else if (action === 'status') console.log(JSON.stringify({ origin, counts: result.counts, budget: result.cloudBudget, dispatchAllowance: result.dispatchAllowance, syncEnabled: result.syncEnabled, sourceRefreshEnabled: result.sourceRefreshEnabled, snapshot: result.snapshot, stages: result.taskStages }, null, 2));
else console.log(JSON.stringify({ origin, action, result }, null, 2));
