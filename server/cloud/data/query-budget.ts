import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { AppError } from '../../errors.ts';
import type { CatalogueDatabase } from './catalogue.ts';

export interface QueryCounter { used: number; maximum: number; }
/** Counts statements, including each statement inside D1.batch; wrappers share one invocation counter. */
export function withQueryBudget(database: CatalogueDatabase, counter: QueryCounter): CatalogueDatabase {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  function charge(count: number) {
    if (counter.used + count > counter.maximum) throw new AppError(422, 'UPSTREAM_CHANGED', 'The bounded import reached its per-invocation query ceiling before a further query was issued.');
    counter.used += count;
  }
  function wrapped(statement: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(statement, { get(target, key) {
      if (key === 'bind') return (...args: unknown[]) => wrapped(target.bind(...args));
      const value = Reflect.get(target, key, target);
      if (['run', 'all', 'first', 'raw'].includes(String(key)) && typeof value === 'function') return (...args: unknown[]) => { charge(1); return Reflect.apply(value, target, args); };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    originals.set(proxy, statement); return proxy;
  }
  return {
    prepare: query => wrapped(database.prepare(query)),
    batch: async statements => { charge(statements.length); return database.batch(statements.map(statement => originals.get(statement) ?? statement)); },
  };
}
