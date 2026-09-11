import type {
  ApiProblem,
  CatalogueFacets,
  CatalogueResponse,
  PlaybackResolution,
  ProvidersResponse,
  TitleDetailResponse,
  ImportStatus,
} from '../types';

export class ApiError extends Error {
  readonly problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.message);
    this.name = 'ApiError';
    this.problem = problem;
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body = isJson
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const source = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const nested = source.error && typeof source.error === 'object'
      ? source.error as Record<string, unknown>
      : source;
    throw new ApiError({
      status: response.status,
      code: String(nested.code ?? `HTTP_${response.status}`),
      message: String(nested.message ?? source.message ?? response.statusText ?? 'Request failed'),
      details: nested.details ?? source,
    });
  }

  if (isJson && body === null) {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: 'The application API returned an incomplete JSON response.',
    });
  }

  return body as T;
}

async function request<T>(
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  return readResponse<T>(response);
}

export interface CatalogueQuery {
  q?: string;
  genre?: string;
  type?: string;
  status?: string;
  language?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export const api = {
  catalogue(query: CatalogueQuery, signal?: AbortSignal) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return request<CatalogueResponse>(`/api/titles?${params}`, { signal });
  },

  filters(signal?: AbortSignal) {
    return request<CatalogueFacets>('/api/meta/filters', { signal });
  },

  title(slug: string, signal?: AbortSignal) {
    return request<TitleDetailResponse>(`/api/titles/${encodeURIComponent(slug)}`, { signal });
  },

  providers(episodeId: string, language: string, signal?: AbortSignal) {
    const params = new URLSearchParams({ language });
    return request<ProvidersResponse>(
      `/api/episodes/${encodeURIComponent(episodeId)}/providers?${params}`,
      { signal },
    );
  },

  resolve(mappingId: string, language: string, signal?: AbortSignal) {
    return request<PlaybackResolution>(
      `/api/providers/${encodeURIComponent(mappingId)}/resolve`,
      { method: 'POST', body: JSON.stringify({ language }), signal },
    );
  },

  importStatus(token: string, signal?: AbortSignal) {
    return request<ImportStatus>('/api/admin/import/status', { headers: { 'x-admin-token': token }, signal });
  },

  importAction(runId: number, action: 'pause' | 'resume' | 'retry', token: string, signal?: AbortSignal) {
    return request<{ runId: number; status?: string; retried?: number }>(`/api/admin/import/${runId}/${action}`, { method: 'POST', headers: { 'x-admin-token': token }, signal });
  },

  backup(token: string, signal?: AbortSignal) {
    return request<{ path: string; schemaVersion: number }>('/api/admin/backup', { method: 'POST', headers: { 'x-admin-token': token }, signal });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.problem.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong while loading this view.';
}
