import { describe, expect, it } from 'vitest';
// @ts-expect-error The release verifier runs directly in Node without a TypeScript build.
import { inspectPrivateApproval } from '../scripts/verify-private-approval.mjs';

const origin = 'https://solanime.example.test';
const response = (session: Record<string, unknown>, catalogueStatus = 401) =>
  async (url: string) => Response.json(url.endsWith('/api/account/session') ? session : {}, {
    status: url.endsWith('/api/account/session') ? 200 : url.includes('/api/titles?') ? catalogueStatus : 401,
  });

describe('deployed private approval verifier', () => {
  it('passes only when the session flags and every protected read deny anonymous access', async () => {
    const result = await inspectPrivateApproval(origin, response({
      account: null, csrfToken: null, privateSite: true, approvalRequired: true,
    }));
    expect(result.passed).toBe(true);
    expect(result.checks.anonymousProvidersDenied).toBe(true);
  });

  it('rejects an old deployment that exposes catalogue despite the local configuration', async () => {
    const result = await inspectPrivateApproval(origin, response({ account: null, csrfToken: null }, 200));
    expect(result.passed).toBe(false);
    expect(result.checks.privateSite).toBe(false);
    expect(result.checks.approvalRequired).toBe(false);
    expect(result.checks.anonymousCatalogueDenied).toBe(false);
  });

  it('rejects non-origin URLs', async () => {
    await expect(inspectPrivateApproval(origin + '/watch/episode', response({}))).rejects.toThrow('site origin');
  });
});
