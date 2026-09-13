import { createContext, useContext } from 'react';
import type { ProfileData } from './types';
export type StorageScope = {
  read: (key: string) => unknown;
  write: (key: string, value: unknown) => void;
  subscribe: (key: string, listener: () => void) => () => void;
  flush: () => Promise<void>;
  hasPending: () => boolean;
  dispose: () => void;
};
export const StorageScopeContext = createContext<StorageScope | null>(null);
export const useStorageScope = () => useContext(StorageScopeContext);
/**
 * Ephemeral, deliberately read-only storage used while account restoration is unresolved.
 * Rendering the public catalogue must not depend on the account service, but treating an
 * unresolved session as a guest would leak private intent into device-level guest storage.
 */
export function readOnlyStorage(): StorageScope {
  return {
    read: () => undefined,
    write: () => {},
    subscribe: () => () => {},
    flush: async () => {},
    hasPending: () => false,
    dispose: () => {},
  };
}
/** Ordered compare-and-swap writes: no localStorage credentials or cross-profile data cache. */
export function profileStorage(
  initial: ProfileData,
  commit: (key: string, value: unknown, revision: number) => Promise<number>,
  onStatus: (error: string | null, busy: boolean) => void,
): StorageScope {
  const values = { ...initial.values },
    revisions = { ...initial.revisions };
  const listeners = new Map<string, Set<() => void>>();
  const pending = new Map<string, unknown>();
  let running: Promise<void> | null = null,
    failure: Error | null = null,
    disposed = false;
  function pump() {
    if (running || failure || disposed) return;
    running = (async () => {
      onStatus(null, true);
      while (pending.size && !disposed) {
        const [key, value] = pending.entries().next().value!;
        pending.delete(key);
        try {
          revisions[key] = await commit(key, value, revisions[key] ?? 0);
        } catch (e) {
          failure = e instanceof Error ? e : new Error('Profile sync failed.');
          if (!pending.has(key)) pending.set(key, value);
          onStatus(failure.message, false);
          break;
        }
      }
    })().finally(() => {
      running = null;
      if (!failure && !disposed) {
        if (pending.size) pump();
        else onStatus(null, false);
      }
    });
  }
  return {
    read: (key) => values[key],
    write: (key, value) => {
      if (disposed || JSON.stringify(values[key]) === JSON.stringify(value)) return;
      values[key] = value;
      pending.set(key, value);
      listeners.get(key)?.forEach((fn) => fn());
      pump();
    },
    subscribe: (key, fn) => {
      const set = listeners.get(key) ?? new Set();
      set.add(fn);
      listeners.set(key, set);
      return () => {
        set.delete(fn);
      };
    },
    flush: async () => {
      while (!disposed && (running || pending.size)) {
        if (failure) throw failure;
        pump();
        if (running) await running;
      }
      if (failure) throw failure;
    },
    hasPending: () => pending.size > 0 || running !== null,
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  };
}
