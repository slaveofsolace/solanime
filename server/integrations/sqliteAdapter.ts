import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { AccountDatabase, AccountStatement } from '../cloud/auth/types.ts';

export function sqliteAccountAdapter(db: DatabaseSync): AccountDatabase {
  class Statement implements AccountStatement {
    constructor(readonly sql: string, readonly values: unknown[] = []) {}
    bind(...values: unknown[]) { return new Statement(this.sql, values); }
    async first<T>(column?: string) {
      const row = db.prepare(this.sql).get(...this.values as SQLInputValue[]);
      return (row ? column ? row[column] : row : null) as T | null;
    }
    async all<T>() { return { results: db.prepare(this.sql).all(...this.values as SQLInputValue[]) as T[], success: true }; }
    async run() { return { success: true, meta: { changes: Number(db.prepare(this.sql).run(...this.values as SQLInputValue[]).changes) } }; }
  }
  return { prepare: sql => new Statement(sql), async batch(statements) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => {
        const local = statement as Statement;
        return { success: true, meta: { changes: Number(db.prepare(local.sql).run(...local.values as SQLInputValue[]).changes) } };
      });
      db.exec('COMMIT'); return results;
    }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
}
