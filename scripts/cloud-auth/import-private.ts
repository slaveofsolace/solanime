import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { object } from '../../server/accounts/validation.ts';
import { MigrationError, sha256, validatePrivateState, type PrivateState } from './format.ts';
import { PrivateD1Client } from './d1-client.ts';

type Row = { table: 'accounts' | 'profiles' | 'profile_data'; columns: string[]; keys: string[]; values: (string | number)[]; estimatedWrites: number };
export function privateImportRows(state: PrivateState): Row[] {
  return [
    ...state.accounts.map((row): Row => ({ table: 'accounts', keys: ['id'], columns: ['id', 'firebase_uid', 'email', 'recovery_hash', 'email_verified', 'created_at'],
      values: [row.id, row.firebase_uid, row.email, row.recovery_hash, row.email_verified, row.created_at], estimatedWrites: 4 })),
    ...state.profiles.map((row): Row => ({ table: 'profiles', keys: ['id'], columns: ['id', 'account_id', 'name', 'avatar', 'created_at'],
      values: [row.id, row.account_id, row.name, row.avatar, row.created_at], estimatedWrites: 3 })),
    ...state.profileData.map((row): Row => ({ table: 'profile_data', keys: ['profile_id', 'key'], columns: ['profile_id', 'key', 'value', 'revision', 'updated_at'],
      values: [row.profile_id, row.key, row.value, row.revision, row.updated_at], estimatedWrites: 2 })),
  ];
}
type Checkpoint = { schemaVersion: 1; artifactSha256: string; databaseId: string; nextRecord: number; completed: boolean };
export async function importPrivateState(client: Pick<PrivateD1Client, 'query'>, state: PrivateState, writeBudget: number,
  nextRecord = 0, save: (next: number, complete: boolean) => Promise<void> = async () => {}) {
  if (!Number.isSafeInteger(writeBudget) || writeBudget < 1 || writeBudget > 100000)
    throw new MigrationError('Set an explicit written-row budget between 1 and 100000 after reserving capacity for application traffic.');
  const rows = privateImportRows(state);
  if (!Number.isSafeInteger(nextRecord) || nextRecord < 0 || nextRecord > rows.length) throw new MigrationError('Invalid private import checkpoint.');
  let writtenRows = 0, readRows = 0, skipped = 0;
  for (let index = nextRecord; index < rows.length; index++) {
    const row = rows[index];
    const keyValues = row.keys.map((key) => row.values[row.columns.indexOf(key)]);
    const existing = await client.query(`SELECT ${row.columns.join(',')} FROM ${row.table} WHERE ${row.keys.map((key) => key + '=?').join(' AND ')}`, keyValues);
    readRows += existing.meta.rows_read;
    if (existing.results.length) {
      if (existing.results.length !== 1 || row.columns.some((key, column) => existing.results[0][key] !== row.values[column]))
        throw new MigrationError(`Existing private record ${index} differs from the snapshot. It was preserved; do not overwrite a live account.`);
      skipped++;
    } else {
      if (writtenRows + row.estimatedWrites > writeBudget) {
        await save(index, false);
        return { completed: false, nextRecord: index, totalRecords: rows.length, writtenRows, readRows, skipped, reason: 'write-budget' };
      }
      const result = await client.query(`INSERT INTO ${row.table}(${row.columns.join(',')}) VALUES(${row.columns.map(() => '?').join(',')})`, row.values);
      writtenRows += result.meta.rows_written; readRows += result.meta.rows_read;
      if (result.meta.rows_written < 1) throw new MigrationError('Cloudflare did not confirm the private record write. The checkpoint was preserved.');
    }
    await save(index + 1, index + 1 === rows.length);
  }
  await save(rows.length, true);
  return { completed: true, nextRecord: rows.length, totalRecords: rows.length, writtenRows, readRows, skipped };
}
async function main() {
  const { values } = parseArgs({ options: { artifact: { type: 'string' }, 'account-id': { type: 'string' },
    'database-id': { type: 'string' }, 'database-name': { type: 'string' }, 'write-budget': { type: 'string' } }, strict: true });
  if (!values.artifact || !values['account-id'] || !values['database-id'] || !values['database-name'] || !values['write-budget'])
    throw new MigrationError('Usage: import-private.ts --artifact <private-state.json> --account-id <id> --database-id <id> --database-name <solanime-accounts-name> --write-budget <reserved-row-budget>');
  const artifact = resolve(values.artifact), text = await readFile(artifact, 'utf8'), state = validatePrivateState(JSON.parse(text));
  const artifactSha256 = sha256(text), checkpointPath = resolve(dirname(artifact), `private-import-${values['database-id']}.checkpoint.json`);
  let next = 0;
  try {
    const prior: unknown = JSON.parse(await readFile(checkpointPath, 'utf8'));
    if (!object(prior) || prior.schemaVersion !== 1 || prior.artifactSha256 !== artifactSha256 || prior.databaseId !== values['database-id'] || !Number.isSafeInteger(prior.nextRecord))
      throw new MigrationError('Checkpoint identity differs from this private artifact or database. Import stopped.');
    next = Number(prior.nextRecord);
  } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
  const client = new PrivateD1Client(values['account-id'], values['database-id'], values['database-name'], process.env.SOLANIME_PRIVATE_D1_API_TOKEN ?? '');
  await client.verifyTarget();
  const save = async (nextRecord: number, completed: boolean) => {
    const checkpoint: Checkpoint = { schemaVersion: 1, artifactSha256, databaseId: values['database-id']!, nextRecord, completed };
    const temporary = checkpointPath + '.next';
    await writeFile(temporary, JSON.stringify(checkpoint, null, 2), { mode: 0o600 });
    await rename(temporary, checkpointPath);
  };
  const result = await importPrivateState(client, state, Number(values['write-budget']), next, save);
  console.log(JSON.stringify({ ...result, checkpoint: checkpointPath, firebaseAccountsImported: false }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof MigrationError ? error.message : 'Private account import stopped. Check the artifact and target configuration; no credentials were logged.');
    process.exitCode = 1;
  });
}
