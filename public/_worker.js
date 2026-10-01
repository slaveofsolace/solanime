/** Pages routes API traffic through a private Worker service binding.
 * The fixed-origin mode remains available for existing self-hosted installations. */
const publicRead = /^\/api\/(?:health|meta\/filters|titles(?:\/[^/]+)?|episodes\/\d+\/(?:providers|comments))$/;
const reviewRead = /^\/api\/(?:health|meta\/filters|titles(?:\/[^/]+)?|episodes\/\d+\/providers)$/;
const operatorRead = /^\/api\/(?:admin\/(?:accounts\/pending|sources(?:\/[^/]+(?:\/(?:relationships|evidence))?)?|sources\/coverage|import\/status|sync\/status)|exports\/(?:catalogue\.json|catalogue\.csv|coverage\.csv))$/;
const operatorWrite = /^\/api\/admin\/(?:accounts\/[\w-]{1,128}\/(?:decision|retry-notice)|sources\/[^/]+\/review|providers\/\d+\/verification|sync\/(?:control|start)|artwork\/refresh|import\/(?:\d+\/(?:pause|resume|retry)|dispatch|batch|start))$/;
const resolvePath = /^\/api\/providers\/\d+\/resolve$/;
const accountRead = /^\/api\/account\/(?:session|sessions|export|profiles\/[\w-]{36}\/(?:data|mal\/(?:status|list)))$/;
const accountWrite =
  /^\/api\/account\/(?:register|login|logout|recover|password|recovery-code|delete|revoke-other-sessions|profiles(?:\/[\w-]{36}(?:\/(?:data|delete|mal\/(?:connect|complete|sync|update|disconnect)))?)?)$/;
const communityRead = /^\/api\/episodes\/\d+\/comments$/;
const communityCreate = /^\/api\/episodes\/\d+\/comments$/;
const communityItem = /^\/api\/episodes\/\d+\/comments\/[0-9a-f-]{36}$/i;
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
    if (url.pathname.startsWith('/__private-import/') || url.pathname.startsWith('/__private-baseline/')) return problem(404, 'NOT_FOUND', 'Route not found.');
    if (url.pathname === '/api') return problem(404, 'NOT_FOUND', 'API route not found.');
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (env.SOLANIME_REVIEW_MODE === 'youtube-official' && !(
      (request.method === 'GET' && reviewRead.test(url.pathname)) ||
      (request.method === 'POST' && resolvePath.test(url.pathname))
    )) return problem(404, 'NOT_FOUND', 'This API route is not exposed by the review gateway.');
    const bound = !!env.SOLANIME_API;
    const operatorRoute = bound && (operatorRead.test(url.pathname) || operatorWrite.test(url.pathname));
    const accountRoute = accountRead.test(url.pathname) || accountWrite.test(url.pathname) ||
      communityRead.test(url.pathname) || communityItem.test(url.pathname);
    const mutation =
      (request.method === 'POST' &&
        (resolvePath.test(url.pathname) || accountWrite.test(url.pathname) || communityCreate.test(url.pathname) || (bound && operatorWrite.test(url.pathname)))) ||
      ((request.method === 'PATCH' || request.method === 'DELETE') && communityItem.test(url.pathname));
    if (
      !(
        request.method === 'GET' &&
        (publicRead.test(url.pathname) || accountRead.test(url.pathname) || (bound && operatorRead.test(url.pathname)))
      ) &&
      !mutation
    )
      return problem(404, 'NOT_FOUND', 'This API route is not exposed by the public gateway.');
    let origin;
    try {
      origin = bound ? url.origin : apiOrigin(env.SOLANIME_API_ORIGIN, url.origin);
    } catch {
      return problem(
        503,
        'API_NOT_CONFIGURED',
        'The application API binding is missing. Check the Pages deployment configuration.',
      );
    }
    const headers = new Headers({ accept: 'application/json' });
    if (operatorRoute) {
      const token = request.headers.get('x-admin-token');
      if (!token || token.length > 256) return problem(401, 'UNAUTHORIZED', 'An operator token is required.');
      headers.set('x-admin-token', token);
    }
    if (bound) headers.set('cf-connecting-ip', request.headers.get('cf-connecting-ip') ?? 'unknown');
    if (!operatorRoute && url.pathname !== '/api/health') {
      const cookies = (request.headers.get('cookie') ?? '')
        .split(';')
        .map((value) => value.trim())
        .filter((value) => /^(?:__Host-)?solanime_session=[\w-]{43}$/.test(value));
      if (cookies.length === 1) headers.set('cookie', cookies[0]);
    }
    if (accountRoute) {
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
    const bodyLimit = accountRoute ? limit : operatorRoute ? 60_000 : 16 * 1024;
    let body;
    if (mutation) {
      const caller = request.headers.get('origin');
      const site = request.headers.get('sec-fetch-site');
      if (
        ((bound || accountRoute || operatorRoute) && !caller) ||
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
      const init = {
        method: request.method,
        headers,
        body,
        // Workers supports manual/follow Request modes. Manual also ensures
        // upstream redirects are rejected by the JSON response contract below.
        redirect: 'manual',
        signal: request.signal
          ? AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      };
      const target = `${origin}${url.pathname}${url.search}`;
      const upstream = bound
        ? await env.SOLANIME_API.fetch(new Request(target, init))
        : await fetch(target, init);
      const type = upstream.headers.get('content-type') ?? '';
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return problem(502, 'INVALID_UPSTREAM', 'The configured API returned an unexpected redirect.');
      }
      const csvExport = operatorRoute && url.pathname.endsWith('.csv') && type.includes('text/csv');
      if (!type.includes('application/json') && !csvExport) {
        await upstream.body?.cancel();
        return problem(
          502,
          'INVALID_UPSTREAM',
          'The configured API did not return JSON. Check its origin and reverse-proxy routing.',
        );
      }
      const responseHeaders = new Headers({
        'content-type': csvExport ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
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
      if (csvExport) for (const name of ['x-export-schema-version', 'x-next-cursor']) {
        const value = upstream.headers.get(name);
        if (value !== null) responseHeaders.set(name, value);
      }
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      console.error(JSON.stringify({ event: 'api_gateway_failure', errorType: error instanceof Error ? error.name : 'UnknownError' }));
      return problem(
        502,
        'UPSTREAM_UNAVAILABLE',
        'The application API could not be reached. Try again shortly.',
      );
    }
  },
};
