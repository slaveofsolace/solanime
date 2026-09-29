import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEpisodeComment,
  deleteEpisodeComment,
  episodeComments,
  setAccountCsrf,
  updateEpisodeComment,
} from '../src/account/api';

const comment = {
  id: '00000000-0000-4000-a000-000000000003',
  episodeId: '10',
  author: { name: 'Viewer', avatar: 'ruby' as const },
  body: 'A real comment',
  revision: 1,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
  ownedByViewer: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  setAccountCsrf(null);
});

describe('episode community client contract', () => {
  it('reads a bounded page and sends profile context only as a query parameter', async () => {
    const send = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ items: [comment], total: 1, page: 2, pageSize: 10, pages: 2 }));
    vi.stubGlobal('fetch', send);
    await expect(episodeComments('10', { profileId: 'profile-id', page: 2, pageSize: 10 }))
      .resolves.toMatchObject({ items: [{ id: comment.id }], total: 1 });
    const [path, init] = send.mock.calls[0];
    expect(path).toBe('/api/episodes/10/comments?profile=profile-id&page=2&pageSize=10');
    expect(init).toMatchObject({ credentials: 'same-origin' });
    expect(new Headers(init?.headers).has('x-csrf-token')).toBe(false);
  });

  it('uses the account CSRF boundary for create, update, and delete', async () => {
    setAccountCsrf('test-csrf');
    const send = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'DELETE' ? Response.json({ deleted: true, id: comment.id }) :
        Response.json({ comment: { ...comment, revision: init?.method === 'PATCH' ? 2 : 1 } }, { status: init?.method === 'POST' ? 201 : 200 }));
    vi.stubGlobal('fetch', send);
    await createEpisodeComment('10', 'profile-id', 'A real comment');
    await updateEpisodeComment('10', comment.id, 'profile-id', 'Edited', 1);
    await deleteEpisodeComment('10', comment.id, 'profile-id', 2);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'PATCH', 'DELETE']);
    for (const [, init] of send.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-solanime-intent')).toBe('account');
      expect(headers.get('x-csrf-token')).toBe('test-csrf');
      expect(headers.get('content-type')).toBe('application/json');
      expect(init?.credentials).toBe('same-origin');
    }
  });

  it('rejects incomplete public and mutation responses instead of inventing comments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ id: 'only-an-id' }], total: 1, page: 1, pageSize: 20, pages: 1 })));
    await expect(episodeComments('10')).rejects.toThrow('community response is incomplete');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ comment: null })));
    await expect(createEpisodeComment('10', 'profile-id', 'Body')).rejects.toThrow('comment response is incomplete');
  });
});
