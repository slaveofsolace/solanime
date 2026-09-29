import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('TVmaze import CLI', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prints help without opening or creating the requested database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'solanime-tvmaze-help-'));
    temporaryDirectories.push(directory);
    const database = join(directory, 'must-not-exist.sqlite');
    const script = resolve('scripts/import-tvmaze.ts');

    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', script, '--help', `--db=${database}`],
      { cwd: resolve('.'), encoding: 'utf8' },
    );

    expect(output).toContain('Usage:');
    expect(output).toContain('--page-limit=<number>');
    expect(existsSync(database)).toBe(false);
    expect(existsSync(`${database}-wal`)).toBe(false);
  });
});
