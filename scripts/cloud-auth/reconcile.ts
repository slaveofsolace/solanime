import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FirebaseRestIdentity } from '../../server/cloud/auth/firebase.ts';
import { digest, randomToken } from '../../server/cloud/auth/crypto.ts';
import { PrivateD1Client } from './d1-client.ts';
import { MigrationError } from './format.ts';
import { privateOutputDirectory } from './prepare.ts';

async function main() {
  const { values } = parseArgs({ options: { 'account-id': { type: 'string' }, 'database-id': { type: 'string' },
    'database-name': { type: 'string' }, uid: { type: 'string' }, apply: { type: 'boolean', default: false },
    out: { type: 'string' }, 'confirm-remote-deleted': { type: 'string' } }, strict: true });
  if (!values['account-id'] || !values['database-id'] || !values['database-name'] || !values.uid ||
    !/^[\w-]{1,128}$/.test(values.uid))
    throw new MigrationError('Usage: reconcile.ts --account-id <CFid> --database-id <D1uuid> --database-name <solanime-accounts-name> --uid <stable-account-id> [--apply --out <new-data/private/folder>]');
  const client = new PrivateD1Client(values['account-id'], values['database-id'], values['database-name'], process.env.SOLANIME_PRIVATE_D1_API_TOKEN ?? '');
  await client.verifyTarget();
  const result = await client.query('SELECT id,firebase_uid,email,auth_state,operation_id,operation_started_at,operation_error FROM accounts WHERE id=?', [values.uid]);
  if (result.results.length !== 1) throw new MigrationError('The exact private account was not found.');
  const a = result.results[0];
  if (a.auth_state === 'active') { console.log(JSON.stringify({ requiresReconciliation: false, applied: false })); return; }
  if (typeof a.operation_id !== 'string' || typeof a.firebase_uid !== 'string' || typeof a.email !== 'string')
    throw new MigrationError('The pending account operation has invalid state. No data was changed.');
  if (!values.apply) {
    console.log(JSON.stringify({ requiresReconciliation: true, applied: false, state: a.auth_state,
      operationId: a.operation_id, reason: a.operation_error, sessionsRevoked: true, profilesPreserved: true,
      next: 'Review the matching Firebase account. See scripts/cloud-auth/README.md before an explicit --apply.' }));
    return;
  }
  if (!values.out) throw new MigrationError('An explicit reconciliation needs a new private receipt directory.');
  if (!Number.isSafeInteger(a.operation_started_at) || Date.now() - Number(a.operation_started_at) < 60000)
    throw new MigrationError('Wait at least one minute for the original upstream request to settle before reconciliation.');
  if (a.auth_state === 'deleting') {
    if (values['confirm-remote-deleted'] !== a.operation_id)
      throw new MigrationError('Verify the exact Firebase UID is deleted, then supply --confirm-remote-deleted with this operation ID. No automatic deletion is inferred.');
    const output = await privateOutputDirectory(values.out);
    const deleted = await client.query('DELETE FROM accounts WHERE id=? AND operation_id=? AND auth_state=\'deleting\'', [a.id, a.operation_id]);
    if (deleted.meta.rows_written < 1) throw new MigrationError('Deletion was not confirmed. Preserve the private state and inspect it again.');
    await writeFile(resolve(output, 'reconciliation.json'), JSON.stringify({ applied: true, operationId: a.operation_id, outcome: 'local-delete-after-operator-confirmed-Firebase-delete', at: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ applied: true, outcome: 'deleted-private-account', receipt: output }));
    return;
  }
  if (!['recovering', 'password-changing'].includes(String(a.auth_state))) throw new MigrationError('Unknown account operation. Nothing was changed.');
  const password = process.env.SOLANIME_RECONCILE_PASSWORD;
  if (!password || Buffer.byteLength(password) > 1024) throw new MigrationError('Provide the intended current Firebase password through SOLANIME_RECONCILE_PASSWORD, not a command-line argument.');
  const identity = new FirebaseRestIdentity({ apiKey: process.env.FIREBASE_API_KEY ?? '', projectId: process.env.FIREBASE_PROJECT_ID ?? '' });
  const credentials = await identity.signIn(a.email, password);
  const user = await identity.lookup(credentials);
  if (credentials.uid !== a.firebase_uid || user.uid !== a.firebase_uid || user.email !== a.email || user.disabled)
    throw new MigrationError('Firebase did not confirm the exact account identity. Nothing was changed.');
  const output = await privateOutputDirectory(values.out);
  const recoveryCode = a.auth_state === 'recovering' ? randomToken() : undefined;
  // Persist a one-time code before committing its hash, so interruption never makes it unrecoverable.
  const receiptPath = resolve(output, 'reconciliation.json');
  const receipt = { applied: false, operationId: a.operation_id, at: new Date().toISOString(), ...(recoveryCode ? { recoveryCode } : {}),
    privacy: 'Private account recovery material. Do not commit, publish, or share outside the account owner.' };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
  const updated = await client.query(`UPDATE accounts SET auth_state='active',recovery_hash=COALESCE(?,recovery_hash),
    operation_id=NULL,operation_started_at=NULL,operation_error=NULL
    WHERE id=? AND operation_id=? AND auth_state=?`, [recoveryCode ? await digest(recoveryCode) : null, a.id, a.operation_id, a.auth_state]);
  if (updated.meta.rows_written < 1) throw new MigrationError('The account state changed during reconciliation. The private receipt is not confirmed; inspect the account before using it.');
  await writeFile(receiptPath, JSON.stringify({ ...receipt, applied: true }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ applied: true, outcome: 'reconciled-managed-password', recoveryCodeWritten: !!recoveryCode, receipt: output, requiresFreshSignIn: true }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof MigrationError ? error.message : 'Account reconciliation stopped. Check the exact private account and managed credentials; no credential details were logged.');
    process.exitCode = 1;
  });
}
