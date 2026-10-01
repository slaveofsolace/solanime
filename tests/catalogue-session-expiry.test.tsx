// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { api, request } from '../src/lib/api';

afterEach(() => vi.unstubAllGlobals());

it('returns a stale catalogue session to the private account gate without treating a failed login as expiry', async () => {
  const expired = vi.fn();
  window.addEventListener('solanime:session-expired', expired);
  try {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' },
    }, { status: 401 })));
    await expect(api.catalogue({ scope: 'anime' })).rejects.toMatchObject({
      problem: { status: 401, code: 'UNAUTHORIZED' },
    });
    expect(expired).toHaveBeenCalledOnce();
    await expect(request('/api/account/login', {
      method: 'POST', body: JSON.stringify({ email: 'invalid', password: 'invalid' }),
    })).rejects.toMatchObject({ problem: { status: 401 } });
    await expect(request('/api/admin/import/status')).rejects.toMatchObject({ problem: { status: 401 } });
    expect(expired).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener('solanime:session-expired', expired);
  }
});
