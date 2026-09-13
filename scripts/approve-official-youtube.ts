import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { migrate, openDatabase, projectRoot } from '../server/db.ts';
import {
  applyOfficialYouTubeApproval,
  locateOfficialYouTubeEpisode,
  REMOW_EPISODE_APPROVALS,
  verifyOfficialYouTubeOEmbed,
} from '../server/ingestion/youtubeOfficial.ts';

const apply = process.argv.includes('--apply');
const pathArgument = process.argv.find((value) => value.startsWith('--db='))?.slice(5);
if (apply && !pathArgument)
  throw new Error('Refusing to mutate the default catalogue. Supply both --apply and --db=<reviewed database path>.');
const databasePath = resolve(projectRoot, pathArgument ?? process.env.SOLANIME_DB_PATH ?? 'data/solanime.sqlite');
const db = apply ? openDatabase(databasePath) : new DatabaseSync(databasePath, { readOnly: true });

try {
  if (apply) migrate(db);
  const results = [];
  for (const approval of REMOW_EPISODE_APPROVALS) {
    const identity = locateOfficialYouTubeEpisode(db, approval);
    const provider = await verifyOfficialYouTubeOEmbed(approval);
    results.push({
      approvalId: approval.id,
      identity,
      provider,
      ...(apply ? { applied: applyOfficialYouTubeApproval(db, approval) } : { applied: false }),
    });
  }
  console.log(JSON.stringify({ databasePath, mode: apply ? 'applied' : 'dry-run', results }, null, 2));
} finally {
  db.close();
}
