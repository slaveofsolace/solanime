import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { listSourcePaths, shouldIncludeSourcePath } from '../scripts/package-source.mjs';

describe('publication-safe source archive', () => {
  it('uses the reviewed allowlist in CI instead of archiving every historical Git blob', () => {
    const workflow = readFileSync('.github/workflows/quality.yml', 'utf8');
    expect(workflow).toContain('pnpm package:source --include-research --out=review-source.zip');
    expect(workflow).not.toContain("'cat-file', 'blob'");
    expect(workflow).not.toContain('zipfile.ZipFile');
  });
  it('uses an explicit source allowlist and excludes private, runtime, data, evidence and historical Guard paths', () => {
    expect(shouldIncludeSourcePath('src/App.tsx')).toBe(true);
    expect(shouldIncludeSourcePath('branding.html')).toBe(true);
    expect(shouldIncludeSourcePath('src/branding/timeline.ts')).toBe(true);
    expect(shouldIncludeSourcePath('public/fonts/manrope-latin-400-normal.woff2')).toBe(true);
    expect(shouldIncludeSourcePath('public/fonts/manrope-OFL.txt')).toBe(true);
    expect(shouldIncludeSourcePath('.env.example')).toBe(true);
    expect(shouldIncludeSourcePath('.env.production')).toBe(false);
    expect(shouldIncludeSourcePath('.dev.vars')).toBe(false);
    expect(shouldIncludeSourcePath('data/solanime.sqlite')).toBe(false);
    expect(shouldIncludeSourcePath('data/private/accounts.sqlite')).toBe(false);
    expect(shouldIncludeSourcePath('evidence/screenshots/watch.png')).toBe(false);
    expect(shouldIncludeSourcePath('extensions/solanime-guard/manifest.json')).toBe(false);
    expect(shouldIncludeSourcePath('tests/guard/extension.spec.mjs')).toBe(false);
    expect(shouldIncludeSourcePath('tests/theme-player.test.ts')).toBe(false);
    expect(shouldIncludeSourcePath('docs/IMPLEMENTATION_CHECKLIST.md')).toBe(true);
    expect(shouldIncludeSourcePath('docs/RESOURCE_REGISTRY.json')).toBe(true);
    expect(shouldIncludeSourcePath('docs/cloud-release-checklist.md')).toBe(true);
    expect(shouldIncludeSourcePath('dist/index.html')).toBe(false);
  });

  it('makes reviewed research material an explicit opt-in without admitting runtime data', () => {
    expect(shouldIncludeSourcePath('data-dump/README.md')).toBe(false);
    expect(shouldIncludeSourcePath('data-dump/README.md', { includeResearch: true })).toBe(true);
    expect(shouldIncludeSourcePath('data/private/accounts.sqlite', { includeResearch: true })).toBe(false);
  });

  it('selects required project source and font licenses from the working tree', () => {
    // Extracted source archives intentionally have no Git metadata. Selection is
    // verified while packaging from the maintained checkout.
    if (!existsSync('.git')) return;
    const paths = listSourcePaths();
    expect(paths).toContain('package.json');
    expect(paths).toContain('src/App.tsx');
    for (const weight of [200, 300, 400, 500, 600, 700, 800]) {
      expect(paths).toContain(`public/fonts/manrope-latin-${weight}-normal.woff2`);
    }
    expect(paths).toContain('public/fonts/manrope-OFL.txt');
    expect(paths.some((path) => path.startsWith('data/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('data-dump/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('extensions/'))).toBe(false);
  });
});
