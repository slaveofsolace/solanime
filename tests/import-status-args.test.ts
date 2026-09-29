import { describe, expect, it } from 'vitest';
import { parseImportStatusDatabasePath } from '../scripts/import-status-args.ts';

describe('import status database selection', () => {
  it('keeps the default when no database is selected', () => {
    expect(parseImportStatusDatabasePath([])).toBeUndefined();
    expect(parseImportStatusDatabasePath(['--'])).toBeUndefined();
  });

  it('accepts both supported db option forms after a package-manager sentinel', () => {
    expect(parseImportStatusDatabasePath(['--db=E:/crawl/catalogue.sqlite'])).toBe(
      'E:/crawl/catalogue.sqlite',
    );
    expect(parseImportStatusDatabasePath(['--', '--db', 'E:/crawl/catalogue.sqlite'])).toBe(
      'E:/crawl/catalogue.sqlite',
    );
  });

  it('fails closed for empty, duplicate, or unknown options', () => {
    expect(() => parseImportStatusDatabasePath(['--db='])).toThrow(/non-empty database path/);
    expect(() => parseImportStatusDatabasePath(['--db'])).toThrow(/non-empty database path/);
    expect(() => parseImportStatusDatabasePath(['--db=a.sqlite', '--db=b.sqlite'])).toThrow(
      /only one --db/,
    );
    expect(() => parseImportStatusDatabasePath(['--run-id=2'])).toThrow(/Unknown/);
  });
});
