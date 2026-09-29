import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  initializeResolutionState,
  resolutionStatus,
  runEpisodeSourceResolution,
  setResolutionPaused,
} from '../server/ingestion/episodeSourceResolution.ts';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function integer(name: string, fallback: number): number {
  const value = Number(option(name) ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer.`);
  return value;
}

const action = option('action') ?? 'run';
const cataloguePath = resolve(option('db') ?? process.env.SOLANIME_DB_PATH ?? 'data/solanime.sqlite');
const statePath = resolve(option('state-db') ?? `${cataloguePath}.source-resolution.sqlite`);
mkdirSync(dirname(statePath), { recursive: true });

if (action === 'init') {
  console.log(JSON.stringify({ inserted: initializeResolutionState(statePath, cataloguePath), status: resolutionStatus(statePath, cataloguePath) }, null, 2));
} else if (action === 'status') {
  console.log(JSON.stringify(resolutionStatus(statePath, cataloguePath), null, 2));
} else if (action === 'pause') {
  setResolutionPaused(statePath, true);
  console.log(JSON.stringify(resolutionStatus(statePath, cataloguePath), null, 2));
} else if (action === 'resume') {
  setResolutionPaused(statePath, false);
  console.log(JSON.stringify(resolutionStatus(statePath, cataloguePath), null, 2));
} else if (action === 'run') {
  const result = await runEpisodeSourceResolution({
    cataloguePath,
    statePath,
    concurrency: integer('concurrency', 10),
    startSpacingMs: integer('start-spacing-ms', 75),
    maxJobs: integer('max-jobs', 0),
    progress(value) { console.log(JSON.stringify({ observedAt: new Date().toISOString(), ...value })); },
  });
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error('--action must be init, status, pause, resume, or run.');
}
