export const LIVE_CHECK_PREVIEW_ORIGIN = 'https://cloud-release.solanime.pages.dev';
export const LIVE_CHECK_PRODUCTION_ORIGIN = 'https://solanime.pages.dev';

export type LiveCheckOptions = {
  origin: typeof LIVE_CHECK_PREVIEW_ORIGIN | typeof LIVE_CHECK_PRODUCTION_ORIGIN;
  execute: boolean;
  holdOnFailure: boolean;
  allowProduction: boolean;
};

/** Pure validation, called before constructing a client or making any request.
 * Do not URL-normalize input: ports, paths, credentials, aliases and lookalike
 * hosts must not turn into a permitted origin through normalization.
 */
export function parseLiveCheckOptions(args: readonly string[]): LiveCheckOptions {
  let selectedOrigin = LIVE_CHECK_PREVIEW_ORIGIN as string;
  let execute = false, holdOnFailure = false, allowProduction = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (!['--origin', '--execute', '--hold-on-failure', '--allow-production'].includes(argument) || seen.has(argument)) {
      throw new Error('Live check arguments must use each supported option at most once.');
    }
    seen.add(argument);
    if (argument === '--origin') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('The --origin option requires an exact permitted HTTPS origin.');
      selectedOrigin = value;
    } else if (argument === '--execute') execute = true;
    else if (argument === '--hold-on-failure') holdOnFailure = true;
    else allowProduction = true;
  }
  if (selectedOrigin !== LIVE_CHECK_PREVIEW_ORIGIN && selectedOrigin !== LIVE_CHECK_PRODUCTION_ORIGIN) {
    throw new Error('Live checks are restricted to the exact Solanime preview or canonical production origin.');
  }
  if (selectedOrigin === LIVE_CHECK_PRODUCTION_ORIGIN && !allowProduction) {
    throw new Error('Canonical production checks additionally require the explicit --allow-production flag.');
  }
  if (allowProduction && selectedOrigin !== LIVE_CHECK_PRODUCTION_ORIGIN) {
    throw new Error('The --allow-production flag is valid only with the exact canonical production origin.');
  }
  return { origin: selectedOrigin, execute, holdOnFailure, allowProduction };
}
