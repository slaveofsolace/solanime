import { backup, DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { firebaseImportArguments, firebaseUser, MigrationError, sha256, STANDARD_SCRYPT, validatePrivateState, validProject } from './format.ts';

const runFile = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** Fresh private artifacts only. Existing directories, public folders, and junction escapes are rejected. */
export async function privateOutputDirectory(path: string) {
  const privateRoot = resolve(projectRoot, 'data/private');
  const output = resolve(path);
  const rel = relative(privateRoot, output);
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
    throw new MigrationError('Put migration artifacts in a new folder inside data/private.');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const realRoot = await realpath(projectRoot), realParent = await realpath(dirname(output));
  const realRel = relative(realRoot, realParent);
  const privatePrefix = ['data', 'private'].join(sep);
  if (realRel !== privatePrefix && !realRel.startsWith(privatePrefix + sep))
    throw new MigrationError('The private output parent does not resolve inside this checkout\'s data/private directory.');
  try { await mkdir(output, { mode: 0o700 }); }
  catch { throw new MigrationError('The output folder already exists or cannot be created. Choose a new private folder.'); }
  if (process.platform === 'win32') {
    // Apply a restrictive ACL to this newly created directory before any credential-bearing file exists.
    const identity = await runFile('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = identity.stdout.match(/"(S-1-[\d-]+)"/)?.[1];
    if (!sid) throw new MigrationError('Could not determine the Windows account SID for the private-folder ACL.');
    try { await runFile('icacls.exe', [output, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true }); }
    catch { throw new MigrationError('Could not restrict the private output ACL. No account data was written.'); }
  }
  return output;
}
export async function prepareMigration(source: string, out: string, firebaseProjectId: string) {
  if (!validProject(firebaseProjectId) || !isAbsolute(source)) throw new MigrationError('Supply an absolute private source path and an exact Firebase project ID.');
  if (!(await stat(source)).isFile()) throw new MigrationError('The private account database does not exist.');
  const output = await privateOutputDirectory(out);
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  const snapshotPath = resolve(output, 'source-accounts.sqlite');
  try { await backup(sourceDb, snapshotPath); } finally { sourceDb.close(); }
  await chmod(snapshotPath, 0o600);
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' || snapshot.prepare('PRAGMA foreign_key_check').all().length)
      throw new MigrationError('The private account snapshot failed database integrity checks.');
    snapshot.exec('BEGIN');
    const accounts = snapshot.prepare('SELECT id,email,password_hash,recovery_hash,email_verified,created_at FROM accounts ORDER BY id').all();
    const profiles = snapshot.prepare('SELECT id,account_id,name,avatar,created_at FROM profiles ORDER BY account_id,created_at,id').all();
    const profileData = snapshot.prepare('SELECT profile_id,key,value,revision,updated_at FROM profile_data ORDER BY profile_id,key').all();
    const hasComments = Boolean(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='episode_comments'").get());
    const episodeComments = hasComments ? snapshot.prepare(`SELECT id,episode_id,profile_id,body,revision,moderation_state,created_at,updated_at
      FROM episode_comments ORDER BY profile_id,created_at,id`).all() : [];
    const users = accounts.map(firebaseUser);
    const state = validatePrivateState({ schemaVersion: 1, firebaseProjectId, sourceBackupSha256: await fileHash(snapshotPath),
      accounts: accounts.map(({ password_hash: _password, ...account }) => ({ ...account, firebase_uid: account.id })),
      profiles, profileData, episodeComments });
    const files = { 'firebase-users.json': JSON.stringify({ users }), 'private-state.json': JSON.stringify(state) };
    for (const [name, data] of Object.entries(files)) await writeFile(resolve(output, name), data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const manifest = { schemaVersion: 1, firebaseProjectId, preparedAt: new Date().toISOString(), passwordHashAlgorithm: STANDARD_SCRYPT,
      sourceBackupSha256: state.sourceBackupSha256, accounts: accounts.length, profiles: profiles.length,
      profileValues: profileData.length, episodeComments: episodeComments.length,
      sessionsMigrated: 0, requiresFreshSignIn: true,
      files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { bytes: Buffer.byteLength(data), sha256: sha256(data) }])),
      firebaseCommand: ['firebase', ...firebaseImportArguments(resolve(output, 'firebase-users.json'), firebaseProjectId)],
      privacy: 'Every file in this directory is private. Never commit, publish, or add it to a source release archive.' };
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return { output, accounts: accounts.length, profiles: profiles.length,
      profileValues: profileData.length, episodeComments: episodeComments.length };
  } finally { snapshot.close(); }
}
async function main() {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' }, project: { type: 'string' } }, strict: true });
  if (!values.source || !values.out || !values.project) throw new MigrationError('Usage: prepare.ts --source <absolute-private-accounts.sqlite> --out <new-data/private/folder> --project <firebase-project-id>');
  const result = await prepareMigration(values.source, values.out, values.project);
  console.log(JSON.stringify({ ...result, imported: false, next: 'Follow scripts/cloud-auth/README.md. No remote account or database was changed.' }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof MigrationError ? error.message : 'Private account preparation failed. Check the source and private output; no credentials were printed.');
    process.exitCode = 1;
  });
}
