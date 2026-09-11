/** Optional Cloudflare Pages gateway. SQLite remains on the Node host. */
const publicRead = /^\/api\/(?:health|meta\/filters|titles(?:\/[^/]+)?|episodes\/\d+\/providers)$/;
const resolvePath = /^\/api\/providers\/\d+\/resolve$/;
const accountRead = /^\/api\/account\/(?:session|sessions|export|profiles\/[\w-]{36}\/data)$/;
const accountWrite =
  /^\/api\/account\/(?:register|login|logout|recover|password|recovery-code|delete|revoke-other-sessions|profiles(?:\/[\w-]{36}(?:\/(?:data|delete))?)?)$/;
const limit = 256 * 1024;
function problem(status, code, message) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
export function apiOrigin(value, ownOrigin) {
  const target = new URL(value);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.port ||
    target.pathname !== '/' ||
    target.search ||
    target.hash ||
    target.origin === ownOrigin
  )
    throw new Error('Invalid API origin');
  if (
    /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(
      target.hostname,
    )
  )
    throw new Error('Private API origin');
  return target.origin;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const accountRoute = accountRead.test(url.pathname) || accountWrite.test(url.pathname);
    const mutation =
      request.method === 'POST' &&
      (resolvePath.test(url.pathname) || accountWrite.test(url.pathname));
    if (
      !(
        request.method === 'GET' &&
        (publicRead.test(url.pathname) || accountRead.test(url.pathname))
      ) &&
      !mutation
    )
      return problem(404, 'NOT_FOUND', 'This API route is not exposed by the public gateway.');
    let origin;
    try {
      origin = apiOrigin(env.SOLANIME_API_ORIGIN, url.origin);
    } catch {
      return problem(
        503,
        'API_NOT_CONFIGURED',
        'Configure SOLANIME_API_ORIGIN with the HTTPS origin of your running Solanime Node API.',
      );
    }
    const headers = new Headers({ accept: 'application/json' });
    if (accountRoute) {
      const cookies = (request.headers.get('cookie') ?? '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => /^(?:__Host-)?solanime_session=[\w-]{43}$/.test(value));
      if (cookies.length === 1) headers.set('cookie', cookies[0]);
      for (const name of ['x-csrf-token', 'x-solanime-intent']) {
        const value = request.headers.get(name);
        if (value && value.length <= 256) headers.set(name, value);
      }
      // Never trust a caller-supplied forwarding secret or IP header.
      if (env.SOLANIME_GATEWAY_TOKEN) {
        headers.set('x-solanime-gateway', env.SOLANIME_GATEWAY_TOKEN);
        headers.set('x-solanime-client-ip', request.headers.get('cf-connecting-ip') ?? '');
      }
    }
    const bodyLimit = accountRoute ? limit : 16 * 1024;
    let body;
    if (mutation) {
      const caller = request.headers.get('origin');
      const site = request.headers.get('sec-fetch-site');
      if (
        (accountRoute && !caller) ||
        (caller && caller !== url.origin) ||
        (site && site !== 'same-origin')
      )
        return problem(403, 'UNAUTHORIZED', 'Cross-origin playback requests are not accepted.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
        return problem(415, 'BAD_REQUEST', 'Use an application/json request body.');
      if (Number(request.headers.get('content-length') ?? 0) > bodyLimit)
        return problem(413, 'BAD_REQUEST', 'Request body is too large.');
      const reader = request.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > bodyLimit) {
              await reader.cancel();
              return problem(413, 'BAD_REQUEST', 'Request body is too large.');
            }
            chunks.push(value);
          }
        } catch {
          return problem(400, 'BAD_REQUEST', 'Request body could not be read.');
        }
      }
      body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      headers.set('content-type', 'application/json');
      headers.set('origin', url.origin);
      headers.set('sec-fetch-site', 'same-origin');
    }
    try {
      const upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(55_000),
      });
      if (!upstream.headers.get('content-type')?.includes('application/json')) {
        await upstream.body?.cancel();
        return problem(
          502,
          'INVALID_UPSTREAM',
          'The configured API did not return JSON. Check its origin and reverse-proxy routing.',
        );
      }
      const responseHeaders = new Headers({
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
      if (accountRoute) {
        const cookies =
          upstream.headers.getSetCookie?.() ??
          (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
        for (const cookie of cookies)
          if (/^__Host-solanime_session=[\w-]*;/.test(cookie) && !/;\s*Domain=/i.test(cookie))
            responseHeaders.append('set-cookie', cookie);
        const disposition = upstream.headers.get('content-disposition');
        if (disposition) responseHeaders.set('content-disposition', disposition);
      }
      const retry = upstream.headers.get('retry-after');
      if (retry) responseHeaders.set('retry-after', retry);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return problem(
        502,
        'UPSTREAM_UNAVAILABLE',
        'The catalogue API could not be reached. Check that the Node API is running.',
      );
    }
  },
};
