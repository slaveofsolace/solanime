import type {
  ApiProblem,
  CatalogueFacets,
  CatalogueResponse,
  PlaybackResolution,
  ProvidersResponse,
  TitleDetailResponse,
  ImportStatus,
} from '../types';
import type { CatalogueScope } from '../../shared/catalogue-scope';

export class ApiError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.message);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

function isViewerResource(path: string): boolean {
  return path.startsWith('/api/titles?') ||
    path.startsWith('/api/titles/') ||
    path === '/api/meta/filters' ||
    path.startsWith('/api/episodes/') ||
    path.startsWith('/api/providers/');
}

export async function readResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body = isJson
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const nested =
      source.error && typeof source.error === 'object'
        ? (source.error as Record<string, unknown>)
        : source;
    throw new ApiError({
      status: response.status,
      code: String(nested.code ?? `HTTP_${response.status}`),
      message: String(nested.message ?? source.message ?? response.statusText ?? 'Request failed'),
      details: nested.details ?? source,
    });
  }

  if (!isJson) {
    throw new ApiError({
      status: response.status,
      code: 'API_NOT_CONFIGURED',
      message:
        'The catalogue API is not connected. This server returned a web page instead of data. Check the API deployment configuration.',
    });
  }
  if (body === null || typeof body !== 'object') {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: 'The application API returned an incomplete JSON response.',
    });
  }

  return body as T;
}

export async function request<T>(
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body) headers.set('content-type', 'application/json');
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    60_000,
  );
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      headers,
      credentials: 'same-origin',
    });
    // A protected data read can discover an expired session before the next
    // account refresh. Move the viewer back through the private-site gate
    // instead of leaving each page on an unrelated catalogue error.
    if (
      response.status === 401 &&
      isViewerResource(path) &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new Event('solanime:session-expired'));
    }
    return await readResponse<T>(response);
  } catch (error) {
    if (options.signal?.aborted || error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError({
        status: 0,
        code: 'TIMEOUT',
        message: 'The server took too long to respond. Try again.',
      });
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message:
        'Cannot reach the catalogue API. Check your connection and that the API server is running.',
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export interface CatalogueQuery {
  q?: string;
  scope?: CatalogueScope;
  genre?: string;
  type?: string;
  status?: string;
  language?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

function invalidResponse(kind: string): never {
  throw new ApiError({
    status: 200,
    code: 'INVALID_RESPONSE',
    message: `${kind} data is incomplete. Try again or check the API version.`,
  });
}
function validEpisode(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as { id?: unknown; versions?: unknown };
  return (
    typeof item.id === 'string' &&
    Array.isArray(item.versions) &&
    item.versions.every((version: unknown) => {
      if (!version || typeof version !== 'object') return false;
      const record = version as { id?: unknown; language?: unknown; providerCount?: unknown };
      return (
        typeof record.id === 'string' &&
        typeof record.language === 'string' &&
        Number.isFinite(record.providerCount)
      );
    })
  );
}

export const api = {
  async catalogue(query: CatalogueQuery, signal?: AbortSignal) {
    const params = new URLSearchParams({ facets: 'false' });
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const result = await request<CatalogueResponse>(`/api/titles?${params}`, { signal });
    if (
      !Array.isArray(result.items) ||
      !Number.isFinite(result.total) ||
      !Number.isFinite(result.pages) ||
      !result.items.every(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.slug === 'string' &&
          typeof item.name === 'string',
      )
    ) {
      throw new ApiError({
        status: 200,
        code: 'INVALID_RESPONSE',
        message: 'The catalogue response is incomplete. Try again or check the API version.',
      });
    }
    return result;
  },

  async filters(signal?: AbortSignal) {
    const result = await request<CatalogueFacets>('/api/meta/filters', { signal });
    for (const key of ['genres', 'types', 'statuses', 'languages'] as const) {
      if (
        !Array.isArray(result[key]) ||
        !result[key]!.every(
          (item) => item && typeof item.value === 'string' && typeof item.label === 'string',
        )
      )
        invalidResponse('Filter');
    }
    return result;
  },

  async title(slug: string, signal?: AbortSignal) {
    const result = await request<TitleDetailResponse>(`/api/titles/${encodeURIComponent(slug)}`, {
      signal,
    });
    if (
      !result.title ||
      typeof result.title.id !== 'string' ||
      typeof result.title.name !== 'string' ||
      !Array.isArray(result.episodes) ||
      !result.episodes.every(validEpisode)
    )
      invalidResponse('Title');
    for (const key of ['aliases', 'genres', 'related'] as const)
      if (!Array.isArray(result[key])) invalidResponse('Title');
    return result;
  },

  async providers(episodeId: string, language: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ language });
    const result = await request<ProvidersResponse>(
      `/api/episodes/${encodeURIComponent(episodeId)}/providers?${params}`,
      { signal },
    );
    if (
      !validEpisode(result.episode) ||
      !result.version ||
      typeof result.version.language !== 'string' ||
      !Array.isArray(result.providers) ||
      !result.providers.every(
        (item) =>
          item &&
          typeof item.mappingId === 'string' &&
          typeof item.providerId === 'string' &&
          typeof item.label === 'string',
      )
    )
      invalidResponse('Provider');
    return result;
  },

  resolve(mappingId: string, language: string, signal?: AbortSignal) {
    return request<PlaybackResolution>(`/api/providers/${encodeURIComponent(mappingId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ language }),
      signal,
    });
  },

  importStatus(token: string, signal?: AbortSignal) {
    return request<ImportStatus>('/api/admin/import/status', {
      headers: { 'x-admin-token': token },
      signal,
    });
  },

  importAction(
    runId: number,
    action: 'pause' | 'resume' | 'retry',
    token: string,
    signal?: AbortSignal,
  ) {
    return request<{ runId: number; status?: string; retried?: number }>(
      `/api/admin/import/${runId}/${action}`,
      { method: 'POST', headers: { 'x-admin-token': token }, signal },
    );
  },

  startCloudImport(token: string, signal?: AbortSignal) {
    return request<{ job: { id: string; runId: number; created: boolean }; dispatch: unknown }>(
      '/api/admin/import/start',
      {
        method: 'POST',
        headers: { 'x-admin-token': token },
        body: '{}',
        signal,
      },
    );
  },

  backup(token: string, signal?: AbortSignal) {
    return request<{ file: string; schemaVersion: number }>('/api/admin/backup', {
      method: 'POST',
      headers: { 'x-admin-token': token },
      signal,
    });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong while loading this view.';
}
