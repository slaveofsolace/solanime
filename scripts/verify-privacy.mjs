#!/usr/bin/env node
// Scans a build for things that tie the site to its operator: email addresses,
// local machine paths, source maps and any private terms listed in
// privacy-terms.local.json (git-ignored; see privacy-terms.example.json).
// Exits non-zero on any finding. Usage: node scripts/verify-privacy.mjs [dist]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.argv[2] ?? 'dist';
if (!existsSync(root)) {
  console.error(`No build at ${root}. Run pnpm build first.`);
  process.exit(2);
}
const local = 'privacy-terms.local.json';
const terms = existsSync(local) ? JSON.parse(readFileSync(local, 'utf8')).terms ?? [] : [];
if (!Array.isArray(terms) || terms.some((term) => typeof term !== 'string' || term.length < 3))
  throw new Error(`${local} must be { "terms": ["at least three characters", ...] }`);

const text = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.txt', '.svg', '.xml', '.map', '']);
// Addresses that are part of the product or tests, not a person.
const allowedEmail = /@(?:example\.(?:com|org|net|test)|solanime\.invalid)$/i;
const checks = [
  ['email address', /[\w.+-]{1,64}@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, (match) => !allowedEmail.test(match)],
  ['local path', /(?:\/Users\/[\w.-]+|\/home\/[\w.-]+|[A-Z]:\\{1,2}Users\\{1,2}[\w.-]+)/g, () => true],
  ['source map reference', /[#@] sourceMappingURL=/g, () => true],
];

const findings = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    const file = relative(root, path);
    if (extname(name) === '.map') findings.push(`${file}: source map shipped`);
    const bytes = readFileSync(path);
    const body = text.has(extname(name).toLowerCase()) ? bytes.toString('utf8') : bytes.toString('latin1');
    for (const [label, pattern, keep] of checks)
      for (const match of body.match(pattern) ?? []) if (keep(match)) findings.push(`${file}: ${label} "${match}"`);
    const lower = body.toLowerCase();
    for (const term of terms) if (lower.includes(term.toLowerCase())) findings.push(`${file}: private term #${terms.indexOf(term) + 1}`);
  }
};
walk(root);

if (findings.length) {
  console.error(`Privacy scan found ${findings.length} issue(s):\n` + [...new Set(findings)].map((line) => `  ${line}`).join('\n'));
  process.exit(1);
}
console.log(`Privacy scan passed for ${root} (${terms.length} private term${terms.length === 1 ? '' : 's'} checked).`);
