export function parseImportStatusDatabasePath(args: string[]): string | undefined {
  let databasePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;

    let candidate: string | undefined;
    if (argument === '--db') {
      candidate = args[index + 1];
      index += 1;
    } else if (argument.startsWith('--db=')) {
      candidate = argument.slice('--db='.length);
    } else {
      throw new Error(`Unknown import status option: ${argument}`);
    }

    if (!candidate || candidate.startsWith('--')) {
      throw new Error('Import status --db requires a non-empty database path.');
    }
    if (databasePath !== undefined) {
      throw new Error('Import status accepts only one --db database path.');
    }
    databasePath = candidate;
  }

  return databasePath;
}
