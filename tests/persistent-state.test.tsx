// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { StorageScopeContext, profileStorage } from '../src/account/storageScope';
import { usePersistentState } from '../src/lib/storage';
afterEach(() => cleanup());
describe('profile read and write separation', () => {
  it('does not save untouched defaults on mount or rerender', () => {
    const commit = vi.fn(async () => 1);
    const scope = profileStorage({ values: {}, revisions: {} }, commit, () => {});
    const wrapper = ({ children }: PropsWithChildren) => (
      <StorageScopeContext.Provider value={scope}>{children}</StorageScopeContext.Provider>
    );
    const { rerender } = renderHook(() => usePersistentState<string[]>('history', []), { wrapper });
    rerender();
    expect(commit).not.toHaveBeenCalled();
    expect(scope.hasPending()).toBe(false);
  });
  it('persists an actual edit once and does not rewrite it on a matching rerender', async () => {
    const commit = vi.fn(async () => 1);
    const scope = profileStorage({ values: {}, revisions: {} }, commit, () => {});
    const wrapper = ({ children }: PropsWithChildren) => (
      <StorageScopeContext.Provider value={scope}>{children}</StorageScopeContext.Provider>
    );
    const { result, rerender } = renderHook(() => usePersistentState<any[]>('history', []), {
      wrapper,
    });
    const entry = {
      titleId: '1',
      slug: 'paper',
      title: 'Paper',
      episodeId: '1',
      episodeLabel: '1',
      language: 'sub',
      watchedAt: '2026-09-12',
    };
    await act(async () => {
      result.current[1]([entry]);
    });
    await scope.flush();
    rerender();
    expect(commit).toHaveBeenCalledOnce();
  });
});
