import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type OfficialYouTubeDiscoveryConfig,
  type OfficialYouTubeReviewCandidate,
  type SourceInventoryCheckpoint,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';
import type { OfficialYouTubeBatchApprovalPlan } from '../server/ingestion/youtubeOfficialBatchApproval.ts';
import { auditCatalogueExternalIds, buildOfficialPublisherReview, buildOfficialSeriesApprovalProposals } from '../server/ingestion/youtubeOfficialPublisherReview.ts';

const option = (name: string): string | undefined => process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const requiredOption = (name: string): string => {
  const value = option(name)?.trim();
  if (!value) throw new Error(`MISSING_${name.toUpperCase().replace('-', '_')}`);
  return value;
};
const runDir = resolve(requiredOption('run-dir'));
const batchDir = resolve(requiredOption('batch-dir'));
const configPath = resolve(option('config') ?? resolve(import.meta.dirname, '..', 'config', 'official-youtube-discovery.json'));
const databasePath = resolve(requiredOption('database'));
const output = resolve(option('out') ?? resolve(batchDir, 'publisher-review.json'));
for (const [name, value] of [['run-dir', runDir], ['batch-dir', batchDir], ['config', configPath], ['database', databasePath]]) {
  if (!value || !existsSync(value)) throw new Error(`MISSING_${name.toUpperCase().replace('-', '_')}`);
}
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const config = readJson<OfficialYouTubeDiscoveryConfig>(configPath);
const candidates = readJson<OfficialYouTubeReviewCandidate[]>(resolve(runDir, 'review-candidates.json'));
const approval = readJson<OfficialYouTubeBatchApprovalPlan>(resolve(batchDir, 'approval-ledger.json'));
const inventories = new Map<string, SourceInventoryCheckpoint>();
for (const source of config.sources) inventories.set(source.id, readJson(resolve(runDir, 'inventory', `${source.id}.json`)));
const database = new DatabaseSync(databasePath, { readOnly: true });
const reviewedAt = new Date().toISOString();
const report = buildOfficialPublisherReview(config, inventories, candidates, approval, auditCatalogueExternalIds(database), reviewedAt, buildOfficialSeriesApprovalProposals(config, candidates, database));
database.close();
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify({ output, sourceCount: report.sourceCount, authoritativeMatches: report.publishers.reduce((sum, publisher) => sum + publisher.catalogueMatches.authoritative.length, 0), eligible: report.publishers.reduce((sum, publisher) => sum + publisher.approval.eligible, 0), proposedSeries: report.seriesApprovalProposals.filter((series) => series.status === 'proposed-not-applied').map((series) => ({ seriesId: series.seriesId, episodes: series.entries.length })) })}\n`);
