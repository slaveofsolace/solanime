import { describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generatedTestApiKey } from './helpers/auth-material';

describe('Firebase transport in the actual Worker runtime', () => {
  it('calls the global fetch implementation without an illegal receiver and rejects redirects', async () => {
    // tsx supplies this installed compiler; bundle only for workerd, in memory.
    // No Firebase SDK, real credential or external network is used by this test.
    const buildModule: unknown = createRequire(import.meta.resolve('tsx'))('esbuild');
    if (!buildModule || typeof buildModule !== 'object' || !('build' in buildModule) || typeof buildModule.build !== 'function')
      throw Error('tsx compiler is unavailable for the Worker runtime test');
    const built: { outputFiles: Array<{ text: string }> } = await buildModule.build({
      stdin: { contents: `import { FirebaseRestIdentity } from './server/cloud/auth/firebase.ts';
        export default { async fetch(request) {
          const explicit = new URL(request.url).searchParams.has('explicit');
          const identity = new FirebaseRestIdentity({ apiKey: ${JSON.stringify(generatedTestApiKey())}, projectId: 'solanime-runtime-test' }, explicit ? fetch : undefined);
          try { await identity.signIn(new URL(request.url).searchParams.has('redirect') ? 'redirect@example.test' : 'nobody@example.test', 'test-only passphrase');
            return Response.json({ unexpected: true });
          } catch (error) { return Response.json({ status: error.status, reason: error.details?.reason }); }
        } };`, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
      write: false, bundle: true, platform: 'neutral', format: 'esm', target: 'es2022', external: ['node:*'], logLevel: 'silent',
    });
    const root = fileURLToPath(new URL('../.cache/cloud-auth-runtime/', import.meta.url));
    mkdirSync(root, { recursive: true });
    const runtime = new Miniflare({ ...convertV4MiniflareOptions({ workers: [
      { name: 'test-auth-runtime', modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], outboundService: 'test-google' },
      { name: 'test-google', modules: true, compatibilityDate: '2026-09-12', script: `export default { async fetch(request) {
        const input = await request.json();
        if (input.email === 'redirect@example.test') return Response.redirect('https://unexpected.example.test', 302);
        return Response.json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, { status: 400 });
      } };` },
    ] }), resourceTmpPath: mkdtempSync(root + 'runtime-') });
    try {
      const rejected = await runtime.dispatchFetch('https://runtime.example.test/');
      expect(await rejected.json()).toEqual({ status: 401, reason: 'AUTH_CREDENTIAL_REJECTED' });
      const explicit = await runtime.dispatchFetch('https://runtime.example.test/?explicit');
      expect(await explicit.json()).toEqual({ status: 401, reason: 'AUTH_CREDENTIAL_REJECTED' });
      const redirected = await runtime.dispatchFetch('https://runtime.example.test/?redirect');
      expect(await redirected.json()).toEqual({ status: 502, reason: 'AUTH_UPSTREAM_REDIRECT' });
    } finally { await runtime.dispose(); }
  }, 30000);
});
