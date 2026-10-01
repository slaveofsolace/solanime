import { pathToFileURL } from 'node:url';

/** Check the anonymous release boundary without creating an account or resolving media. */
export async function inspectPrivateApproval(address, fetcher = fetch) {
  const target = new URL(address);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password ||
      target.search || target.hash || target.pathname !== '/')
    throw Error('Use an HTTP(S) site origin without credentials, query, path or fragment.');
  const origin = target.origin;
  const get = (path) => fetcher(origin + path, {
    headers: { 'cache-control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const paths = ['/api/titles?pageSize=1', '/api/meta/filters',
    '/api/episodes/124554/providers?language=sub'];
  const [session, ...protectedResponses] = await Promise.all([
    get('/api/account/session'), ...paths.map(get),
    fetcher(origin + '/api/providers/0/resolve', {
      method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin',
        'content-type': 'application/json', 'cache-control': 'no-cache' },
      body: '{"language":"sub"}', redirect: 'error', signal: AbortSignal.timeout(15000),
    }),
  ]);
  const sessionBody = session.headers.get('content-type')?.includes('application/json')
    ? await session.json().catch(() => null) : null;
  const checks = {
    sessionAvailable: session.status === 200,
    privateSite: sessionBody?.privateSite === true,
    approvalRequired: sessionBody?.approvalRequired === true,
    anonymousSession: sessionBody?.account === null && sessionBody?.csrfToken === null,
    anonymousCatalogueDenied: protectedResponses[0].status === 401,
    anonymousFiltersDenied: protectedResponses[1].status === 401,
    anonymousProvidersDenied: protectedResponses[2].status === 401,
    anonymousResolveDenied: protectedResponses[3].status === 401,
  };
  return { origin, checks, passed: Object.values(checks).every(Boolean),
    statuses: Object.fromEntries([...paths, 'POST /api/providers/0/resolve']
      .map((path, index) => [path, protectedResponses[index].status])),
    note: 'This verifies the anonymous approval boundary. Approved and pending account flows require separate checks.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const address = process.argv.slice(2).find(arg => arg !== '--');
    if (!address) throw Error('Usage: pnpm verify:private-approval -- https://your-site.example');
    const result = await inspectPrivateApproval(address);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
