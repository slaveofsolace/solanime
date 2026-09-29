import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

describe('Wikipedia import CLI', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('prints its bounded metadata-only contract without creating the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'solanime-wikipedia-help-'));
    directories.push(directory);
    const database = join(directory, 'must-not-exist.sqlite');
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', resolve('scripts/import-wikipedia.ts'), '--help', `--db=${database}`],
      { cwd: resolve('.'), encoding: 'utf8' },
    );
    expect(output).toContain('--media=movie|tv');
    expect(output).toContain('stores no episodes, playback providers, embeds, or playback media URLs');
    expect(existsSync(database)).toBe(false);
  });
});
