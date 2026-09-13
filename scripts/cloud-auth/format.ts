import { createHash } from 'node:crypto';
import { object, emailAddress, profileInput, validateData } from '../../server/accounts/validation.ts';

export class MigrationError extends Error {}
export const STANDARD_SCRYPT = { algorithm: 'STANDARD_SCRYPT', memoryCost: 131072, parallelization: 1, blockSize: 8, derivedKeyLength: 64 } as const;
export type PrivateAccount = { id: string; firebase_uid: string; email: string; recovery_hash: string; email_verified: number; created_at: number };
export type PrivateProfile = { id: string; account_id: string; name: string; avatar: string; created_at: number };
export type PrivateProfileData = { profile_id: string; key: string; value: string; revision: number; updated_at: number };
export type PrivateState = { schemaVersion: 1; firebaseProjectId: string; sourceBackupSha256: string;
  accounts: PrivateAccount[]; profiles: PrivateProfile[]; profileData: PrivateProfileData[] };
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{36}$/.test(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const validProject = (value: string) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);

export function convertScryptHash(stored: unknown) {
  if (typeof stored !== 'string') throw new MigrationError('An account has no supported password hash.');
  const fields = stored.split('$');
  if (fields.length !== 7 || fields.slice(0, 5).join('$') !== 'scrypt$1$131072$8$1' ||
    !/^[a-f0-9]{32}$/.test(fields[5]) || !/^[a-f0-9]{128}$/.test(fields[6]))
    throw new MigrationError('An account uses an unknown hash format. Migration stopped without downgrading it.');
  return { passwordHash: Buffer.from(fields[6], 'hex').toString('base64'), salt: Buffer.from(fields[5], 'hex').toString('base64') };
}
export function firebaseUser(row: unknown) {
  if (!object(row) || !id(row.id) || typeof row.email !== 'string' || !integer(row.created_at) || ![0, 1].includes(Number(row.email_verified)))
    throw new MigrationError('An account has invalid identity or timestamp fields.');
  return { localId: row.id, email: emailAddress(row.email), emailVerified: row.email_verified === 1,
    ...convertScryptHash(row.password_hash), createdAt: String(row.created_at) };
}
export function validatePrivateState(value: unknown): PrivateState {
  try {
    if (!object(value) || value.schemaVersion !== 1 || typeof value.firebaseProjectId !== 'string' || !validProject(value.firebaseProjectId) ||
      typeof value.sourceBackupSha256 !== 'string' || !/^[\da-f]{64}$/.test(value.sourceBackupSha256) ||
      !Array.isArray(value.accounts) || !Array.isArray(value.profiles) || !Array.isArray(value.profileData)) throw new Error();
    const accountIds = new Set<string>(), emails = new Set<string>();
    const accounts = value.accounts.map((row): PrivateAccount => {
      if (!object(row) || !id(row.id) || row.firebase_uid !== row.id || typeof row.email !== 'string' ||
        typeof row.recovery_hash !== 'string' || !/^[\da-f]{64}$/.test(row.recovery_hash) || !integer(row.created_at) ||
        (row.email_verified !== 0 && row.email_verified !== 1) || Object.hasOwn(row, 'password_hash') || Object.hasOwn(row, 'passwordHash')) throw new Error();
      const email = emailAddress(row.email);
      if (accountIds.has(row.id) || emails.has(email)) throw new Error();
      accountIds.add(row.id); emails.add(email);
      return { id: row.id, firebase_uid: row.id, email, recovery_hash: row.recovery_hash, email_verified: row.email_verified, created_at: row.created_at };
    });
    const profileIds = new Set<string>(), counts = new Map<string, number>();
    const profiles = value.profiles.map((row): PrivateProfile => {
      if (!object(row) || !id(row.id) || profileIds.has(row.id) || typeof row.account_id !== 'string' || !accountIds.has(row.account_id) || !integer(row.created_at)) throw new Error();
      const input = profileInput(row);
      profileIds.add(row.id); counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1);
      return { id: row.id, account_id: row.account_id, ...input, created_at: row.created_at };
    });
    if (accounts.some((account) => !counts.get(account.id) || counts.get(account.id)! > 5)) throw new Error();
    const dataKeys = new Set<string>(), dataCounts = new Map<string, number>(), dataBytes = new Map<string, number>();
    const profileData = value.profileData.map((row): PrivateProfileData => {
      if (!object(row) || typeof row.profile_id !== 'string' || !profileIds.has(row.profile_id) || typeof row.key !== 'string' ||
        typeof row.value !== 'string' || !integer(row.revision) || row.revision < 1 || !integer(row.updated_at)) throw new Error();
      const key = row.profile_id + ':' + row.key;
      if (dataKeys.has(key)) throw new Error();
      dataKeys.add(key);
      validateData(row.key, JSON.parse(row.value));
      dataCounts.set(row.profile_id, (dataCounts.get(row.profile_id) ?? 0) + 1);
      dataBytes.set(row.profile_id, (dataBytes.get(row.profile_id) ?? 0) + Buffer.byteLength(row.value));
      if (dataCounts.get(row.profile_id)! > 2005 || dataBytes.get(row.profile_id)! > 2 * 1024 * 1024) throw new Error();
      return { profile_id: row.profile_id, key: row.key, value: row.value, revision: row.revision, updated_at: row.updated_at };
    });
    return { schemaVersion: 1, firebaseProjectId: value.firebaseProjectId, sourceBackupSha256: value.sourceBackupSha256, accounts, profiles, profileData };
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('Private migration data failed identity, ownership, quota, or schema validation. Nothing was imported.');
  }
}
export function firebaseImportArguments(file: string, projectId: string) {
  if (!validProject(projectId)) throw new MigrationError('Specify the exact Firebase project ID.');
  return ['auth:import', file, '--project', projectId, '--hash-algo=STANDARD_SCRYPT', '--mem-cost=131072',
    '--parallelization=1', '--block-size=8', '--dk-len=64'];
}
