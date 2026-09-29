import { readFileSync } from 'node:fs';

const reportPath = process.argv[2];
if (!reportPath) throw new Error('Usage: node scripts/inspect-provider-report.mjs <report.json>');

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const failed = report.results.filter((result) => result.status !== 'passed');
const byProvider = {};
for (const result of report.results) {
  byProvider[result.providerId] ??= { passed: 0, failed: 0 };
  byProvider[result.providerId][result.status === 'passed' ? 'passed' : 'failed'] += 1;
}
console.log(JSON.stringify({
  summary: {
    attempted: report.attempted,
    passed: report.passed,
    failed: report.failed,
    byProvider,
  },
  failed: failed.map((result) => ({
    mappingId: result.mappingId,
    providerId: result.providerId,
    language: result.language,
    episodeId: result.episodeId,
    title: result.title,
    reason: result.reason,
    watchUrl: result.watchUrl,
    providerFrameUrl: result.providerFrameUrl,
    providerTitle: result.providerTitle,
    providerText: result.providerText,
    progressFrom: result.progressFrom,
    progressTo: result.progressTo,
    unexpectedPages: result.unexpectedPages,
  })),
}, null, 2));
