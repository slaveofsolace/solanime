import { AppError } from '../../errors.ts';

/** Cloudflare Turnstile. The site key is public; the secret stays a Worker secret. */
export type HumanCheckConfig = {
  siteKey: string;
  secret: string;
  /** Page hostnames a solved challenge may come from. */
  hostnames: string[];
  fetcher?: typeof fetch;
};
export type HumanCheckAction = 'register' | 'recover';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const failed = () => new AppError(400, 'BAD_REQUEST', 'Complete the verification check and try again.', { reason: 'HUMAN_CHECK_FAILED' });

export function humanCheckConfig(siteKey: string | undefined, secret: string | undefined, origins: string[], fetcher?: typeof fetch): HumanCheckConfig | undefined {
  if (!siteKey || !secret) return;
  return { siteKey, secret, hostnames: origins.map((origin) => new URL(origin).hostname), fetcher };
}

export async function verifyHumanCheck(config: HumanCheckConfig, token: unknown, action: HumanCheckAction, ip: string) {
  // Turnstile tokens are at most 2048 characters and valid once.
  if (typeof token !== 'string' || !token || token.length > 2048) throw failed();
  const form = new FormData();
  form.set('secret', config.secret);
  form.set('response', token);
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const response = await (config.fetcher ?? fetch)(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(String(response.status));
    result = await response.json();
  } catch {
    throw new AppError(503, 'UNAVAILABLE', 'The verification service could not be reached. Try again shortly.', { reason: 'HUMAN_CHECK_UNAVAILABLE' });
  }
  // A token solved for another action or site is not accepted here.
  if (result.success !== true || result.action !== action || !config.hostnames.includes(result.hostname ?? '')) throw failed();
}
