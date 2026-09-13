import { verifyDailymotionPublicEmbed } from '../server/providers/dailymotionPublicEmbed.ts';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const videoId = option('video');
const ownerId = option('owner-id');
const ownerName = option('owner-name');
const ownerUrl = option('owner-url');
const expectedTitle = option('title');
const minimumDurationSeconds = Number(option('minimum-duration') ?? '900');

if (!videoId || !ownerId || !ownerName || !ownerUrl)
  throw new Error(
    'Usage: --video=<public id> --owner-id=<exact id> --owner-name=<exact name> --owner-url=<exact profile URL> [--title=<exact title>] [--minimum-duration=<seconds>]',
  );

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 12_000);
try {
  const result = await verifyDailymotionPublicEmbed({
    videoId,
    expectedTitle,
    minimumDurationSeconds,
    publisher: { ownerId, name: ownerName, profileUrl: ownerUrl },
  }, fetch, controller.signal);

  console.log(JSON.stringify({
    mode: 'read-only-probe',
    rightsApproved: false,
    catalogueMapped: false,
    note: 'Technical embeddability and exact uploader identity only; independent rights-holder and catalogue review is still required.',
    result,
  }, null, 2));
} catch (error) {
  process.exitCode = 1;
  console.error(JSON.stringify({
    mode: 'read-only-probe',
    verified: false,
    error: error instanceof Error ? error.message : 'DAILYMOTION_PROBE_FAILED',
  }, null, 2));
} finally {
  clearTimeout(timeout);
}
