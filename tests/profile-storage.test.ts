import { describe, it, expect, vi } from 'vitest';
import { profileStorage } from '../src/account/storageScope';
describe('profile write coordination', () => {
  it('orders updates with server revisions', async () => {
    const commit = vi.fn(async (_key: string, _value: unknown, revision: number) => revision + 1),
      state = profileStorage({ values: {}, revisions: {} }, commit, () => {});
    state.write('preferences', { accent: '#112233' });
    state.write('preferences', { accent: '#445566' });
    await state.flush();
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls.map((args) => args[2])).toEqual([0, 1]);
    expect(state.read('preferences')).toEqual({ accent: '#445566' });
  });
  it('does not overwrite a newer server collection when a conflict occurs', async () => {
    const state = profileStorage(
      { values: { history: [] }, revisions: { history: 3 } },
      async () => {
        throw Error('changed elsewhere');
      },
      () => {},
    );
    state.write('history', [{ episodeId: '1' }]);
    await expect(state.flush()).rejects.toThrow('changed elsewhere');
    expect(state.read('history')).toEqual([{ episodeId: '1' }]);
    expect(state.hasPending()).toBe(true);
  });
  it('keeps profile instances separate and stops writes after disposal', async () => {
    const commit = vi.fn(async () => 1),
      a = profileStorage({ values: {}, revisions: {} }, commit, () => {}),
      b = profileStorage({ values: {}, revisions: {} }, commit, () => {});
    a.write('history', ['one']);
    await a.flush();
    expect(b.read('history')).toBeUndefined();
    a.dispose();
    a.write('history', ['two']);
    expect(commit).toHaveBeenCalledTimes(1);
  });
  it('does not queue identical snapshots', async () => {
    const commit = vi.fn(async () => 1),
      state = profileStorage(
        { values: { history: [] }, revisions: { history: 1 } },
        commit,
        () => {},
      );
    state.write('history', []);
    await state.flush();
    expect(commit).not.toHaveBeenCalled();
  });
});
