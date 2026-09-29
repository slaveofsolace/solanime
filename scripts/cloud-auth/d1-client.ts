import { object } from '../../server/accounts/validation.ts';
import { boundedJson } from '../../server/cloud/auth/http.ts';
import { MigrationError } from './format.ts';

export type PrivateD1Result = { results: Record<string, unknown>[]; meta: { rows_written: number; rows_read: number } };
/** Local operator tooling only. Workers use the direct D1 binding, not this REST client. */
export class PrivateD1Client {
  private readonly base: string;
  constructor(readonly accountId: string, readonly databaseId: string, readonly databaseName: string,
    private readonly secret: string, private readonly request: typeof fetch = fetch) {
    if (!/^[\da-f]{32}$/i.test(accountId) || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(databaseId) ||
      !/^solanime[-\w]*accounts[-\w]*$/.test(databaseName) || !secret || /[\s\u0000-\u001f]/.test(secret))
      throw new MigrationError('Supply the exact Solanime private-accounts D1 target and a scoped operator API token.');
    this.base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}`;
  }
  private async call(path: '' | '/query', sql?: string, params?: unknown[]) {
    try {
      const response = await this.request(this.base + path, { method: sql ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${this.secret}`, Accept: 'application/json', ...(sql ? { 'Content-Type': 'application/json' } : {}) },
        ...(sql ? { body: JSON.stringify({ sql, params }) } : {}) });
      const value = await boundedJson(response, 4 * 1024 * 1024, 30000);
      if (!response.ok || value.success !== true) {
        if (response.status === 429) throw new MigrationError('Cloudflare quota/rate limit reached. Preserve the checkpoint and resume in an available quota window; no billing upgrade was requested.');
        throw new MigrationError('Cloudflare did not confirm the private database operation. Resume from the checkpoint after checking its status.');
      }
      return value.result;
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      throw new MigrationError('The private database request was interrupted. Resume from the saved checkpoint; no credential details were logged.');
    }
  }
  async verifyTarget() {
    const metadata = await this.call('');
    if (!object(metadata) || metadata.name !== this.databaseName || metadata.uuid !== this.databaseId)
      throw new MigrationError('Cloudflare returned a different database identity. Nothing was imported.');
    const schema = await this.query('SELECT version FROM account_schema ORDER BY version DESC LIMIT 1');
    if (schema.results[0]?.version !== 1) throw new MigrationError('Apply the private D1 account migration before importing account data.');
    const columns = await this.query('PRAGMA table_info(accounts)');
    if (!columns.results.some((column) => column.name === 'firebase_uid') || columns.results.some((column) => column.name === 'password_hash'))
      throw new MigrationError('The selected D1 database is not the managed private-account schema.');
  }
  async query(sql: string, params: unknown[] = []): Promise<PrivateD1Result> {
    if (Buffer.byteLength(sql) > 90000 || params.length > 90) throw new MigrationError('A private import query exceeds its explicit SQL budget.');
    const result = await this.call('/query', sql, params);
    if (!Array.isArray(result) || result.length !== 1 || !object(result[0]) || result[0].success !== true ||
      !Array.isArray(result[0].results) || !result[0].results.every(object) || !object(result[0].meta))
      throw new MigrationError('Cloudflare returned an invalid private database response. The checkpoint was preserved.');
    const meta = result[0].meta;
    if (!Number.isSafeInteger(meta.rows_written) || Number(meta.rows_written) < 0 || !Number.isSafeInteger(meta.rows_read) || Number(meta.rows_read) < 0)
      throw new MigrationError('Cloudflare omitted quota accounting. Import stopped before the next write.');
    return { results: result[0].results, meta: { rows_written: Number(meta.rows_written), rows_read: Number(meta.rows_read) } };
  }
}
