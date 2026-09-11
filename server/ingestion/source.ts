import { AppError } from '../errors.ts';
import { validatePublicSourceUrl } from '../security.ts';

const DEFAULT_DELAY_MS = 1200;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;
const ABSOLUTE_MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class SourceRequestError extends AppError {
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: 'BLOCKED' | 'UNAVAILABLE' | 'UPSTREAM_CHANGED';
      httpStatus?: number;
      retryAfterMs?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(options.httpStatus === 403 ? 403 : 502, options.code ?? 'UNAVAILABLE', message);
    this.httpStatus = options.httpStatus;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? true;
  }
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function retryAfter(response: Response, maxRetryAfterMs: number): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Math.min(Number(raw) * 1000, maxRetryAfterMs);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? Math.max(0, Math.min(timestamp - Date.now(), maxRetryAfterMs))
    : undefined;
}

export class AnikotoSourceClient {
  private nextRequestAt = 0;
  private requestGate: Promise<void> = Promise.resolve();
  readonly delayMs = positiveInteger(
    process.env.SOLANIME_SOURCE_DELAY_MS,
    DEFAULT_DELAY_MS,
    250,
    60_000,
  );
  readonly timeoutMs = positiveInteger(
    process.env.SOLANIME_SOURCE_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1000,
    120_000,
  );
  readonly maxRetryAfterMs = positiveInteger(
    process.env.SOLANIME_MAX_RETRY_AFTER_MS,
    DEFAULT_MAX_RETRY_AFTER_MS,
    60_000,
    ABSOLUTE_MAX_RETRY_AFTER_MS,
  );

  private waitTurn(signal?: AbortSignal): Promise<void> {
    const turn = this.requestGate.then(async () => {
      const delay = Math.max(0, this.nextRequestAt - Date.now());
      if (delay)
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Source request cancelled', 'AbortError'));
            },
            { once: true },
          );
        });
      if (signal?.aborted) throw new DOMException('Source request cancelled', 'AbortError');
      this.nextRequestAt = Date.now() + this.delayMs;
    });
    this.requestGate = turn.catch(() => undefined);
    return turn;
  }

  async text(
    pathOrUrl: string,
    accept: 'html' | 'json',
    signal?: AbortSignal,
  ): Promise<{ body: string; response: Response }> {
    let url = validatePublicSourceUrl(new URL(pathOrUrl, 'https://anikototv.to').toString());
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      for (let redirects = 0; ; redirects++) {
        await this.waitTurn(signal);
        response = await fetch(url, {
          redirect: 'manual',
          signal: combined,
          headers: {
            accept:
              accept === 'json'
                ? 'application/json, text/javascript;q=0.9'
                : 'text/html,application/xhtml+xml',
            'accept-language': 'en-US,en;q=0.8',
            'user-agent':
              'Mozilla/5.0 (compatible; SolAnimeSchoolProject/0.1; +local-documentary-research)',
            ...(accept === 'json'
              ? { 'x-requested-with': 'XMLHttpRequest', referer: 'https://anikototv.to/' }
              : {}),
          },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        if (redirects >= 5)
          throw new SourceRequestError('The public source exceeded the redirect safety limit.', {
            code: 'UPSTREAM_CHANGED',
            retryable: false,
          });
        const location = response.headers.get('location');
        if (!location)
          throw new SourceRequestError(
            'The public source returned a redirect without a destination.',
            { code: 'UPSTREAM_CHANGED', retryable: false },
          );
        try {
          url = validatePublicSourceUrl(new URL(location, url).toString());
        } catch {
          throw new SourceRequestError(
            'The public source redirected outside the configured allowlist.',
            { code: 'UPSTREAM_CHANGED', retryable: false },
          );
        }
      }
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Source request cancelled', 'AbortError');
      if (timeout.aborted)
        throw new SourceRequestError('The public source request timed out.', { retryable: true });
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof SourceRequestError) throw error;
      throw new SourceRequestError(
        error instanceof Error ? error.message : 'The public source request failed.',
        { retryable: true },
      );
    }
    if (response.status === 403 || response.status === 401 || response.status === 451) {
      throw new SourceRequestError(
        `The public source refused the request with HTTP ${response.status}; no bypass was attempted.`,
        { code: 'BLOCKED', httpStatus: response.status, retryable: false },
      );
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfterMs = retryAfter(response, this.maxRetryAfterMs);
      if (retryAfterMs != null)
        this.nextRequestAt = Math.max(this.nextRequestAt, Date.now() + retryAfterMs);
      throw new SourceRequestError(
        `The public source returned retryable HTTP ${response.status}.`,
        { httpStatus: response.status, retryAfterMs, retryable: true },
      );
    }
    if (!response.ok)
      throw new SourceRequestError(`The public source returned HTTP ${response.status}.`, {
        httpStatus: response.status,
        retryable: false,
      });
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES)
      throw new SourceRequestError(
        'The public source response exceeded the configured safety limit.',
        { code: 'UPSTREAM_CHANGED', retryable: false },
      );
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Source request cancelled', 'AbortError');
      if (timeout.aborted)
        throw new SourceRequestError('The public source response timed out.', { retryable: true });
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new SourceRequestError(
        error instanceof Error ? error.message : 'The public source response could not be read.',
        { retryable: true },
      );
    }
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES)
      throw new SourceRequestError(
        'The public source response exceeded the configured safety limit.',
        { code: 'UPSTREAM_CHANGED', retryable: false },
      );
    if (!body.trim())
      throw new SourceRequestError('The public source returned an empty response.', {
        code: 'UPSTREAM_CHANGED',
        retryable: true,
      });
    return { body, response };
  }

  async json<T>(pathOrUrl: string, signal?: AbortSignal): Promise<T> {
    const { body } = await this.text(pathOrUrl, 'json', signal);
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new SourceRequestError('The public source response was not valid JSON.', {
        code: 'UPSTREAM_CHANGED',
        retryable: true,
      });
    }
  }
}
