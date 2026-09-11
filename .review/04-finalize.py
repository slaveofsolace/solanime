from pathlib import Path
r=Path.cwd()
p=r/'src/lib/api.ts';s=p.read_text();s=s.replace("  filters(signal?: AbortSignal) {\n    return request<CatalogueFacets>('/api/meta/filters', { signal });\n  },", """  async filters(signal?: AbortSignal) {
    const result = await request<CatalogueFacets>('/api/meta/filters', { signal });
    for (const key of ['genres', 'types', 'statuses', 'languages'] as const) {
      if (!Array.isArray(result[key]) || !result[key]!.every((item) => item && typeof item.value === 'string' && typeof item.label === 'string')) invalidResponse('Filter');
    }
    return result;
  },""");s=s.replace("  title(slug: string, signal?: AbortSignal) {\n    return request<TitleDetailResponse>(`/api/titles/${encodeURIComponent(slug)}`, { signal });\n  },", """  async title(slug: string, signal?: AbortSignal) {
    const result = await request<TitleDetailResponse>(`/api/titles/${encodeURIComponent(slug)}`, { signal });
    if (!result.title || typeof result.title.id !== 'string' || typeof result.title.name !== 'string' || !Array.isArray(result.episodes) || !result.episodes.every(validEpisode)) invalidResponse('Title');
    for (const key of ['aliases', 'genres', 'related'] as const) if (!Array.isArray(result[key])) invalidResponse('Title');
    return result;
  },""");s=s.replace("  providers(episodeId: string, language: string, signal?: AbortSignal) {", "  async providers(episodeId: string, language: string, signal?: AbortSignal) {");s=s.replace("    return request<ProvidersResponse>(", "    const result = await request<ProvidersResponse>(");s=s.replace("      { signal },\n    );\n  },\n\n  resolve", """      { signal },
    );
    if (!validEpisode(result.episode) || !result.version || typeof result.version.language !== 'string' || !Array.isArray(result.providers) || !result.providers.every((item) => item && typeof item.mappingId === 'string' && typeof item.providerId === 'string' && typeof item.label === 'string')) invalidResponse('Provider');
    return result;
  },

  resolve""");s=s.replace('export const api = {',"""function invalidResponse(kind: string): never {
  throw new ApiError({ status: 200, code: 'INVALID_RESPONSE', message: `${kind} data is incomplete. Try again or check the API version.` });
}
function validEpisode(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as { id?: unknown; versions?: unknown };
  return typeof item.id === 'string' && Array.isArray(item.versions) && item.versions.every((version: unknown) => {
    if (!version || typeof version !== 'object') return false;
    const record = version as { id?: unknown; language?: unknown; providerCount?: unknown };
    return typeof record.id === 'string' && typeof record.language === 'string' && Number.isFinite(record.providerCount);
  });
}

export const api = {""");p.write_text(s)
p=r/'src/pages/WatchPage.tsx';s=p.read_text();s=s.replace("const [loadingProviders, setLoadingProviders] = useState(false);", "const [loadingProviders, setLoadingProviders] = useState(false);\n  const [providerRetry, setProviderRetry] = useState(0);");s=s.replace('[episode, language, requestedLanguage, setParams]);','[episode, language, requestedLanguage, setParams, providerRetry]);');s=s.replace('}, [episode, history, language, setParams, slug, title]);','}, [episode, episodeId, language, setParams]);');s=s.replace("""      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('language', language);
        next.set('server', provider.mappingId);
        return next;
      }, { replace: replaceHistory });
""",'');s=s.replace('if (selected) void selectProvider(selected, true);','if (selected) void selectProvider(selected, true); else setProviderRetry((value) => value + 1);');p.write_text(s)
p=r/'src/pages/TitlePage.tsx';s=p.read_text();a=s.index('  const episodeRanges =');b=s.index('\n\n  if (loading)',a);s=s[:a]+"""  const matchingEpisodes = useMemo(() => {
    const query = episodeQuery.trim().toLocaleLowerCase();
    return languageEpisodes.filter((episode) => `${episode.number ?? ''} ${episode.label ?? ''} ${episode.title ?? ''}`.toLocaleLowerCase().includes(query));
  }, [languageEpisodes, episodeQuery]);
  const episodeRanges = useMemo(() => Array.from({ length: Math.ceil(matchingEpisodes.length / 50) }, (_, index) => ({ index, start: index * 50, end: Math.min(matchingEpisodes.length, (index + 1) * 50) })), [matchingEpisodes.length]);
  const visibleEpisodes = matchingEpisodes.slice(episodeRange * 50, (episodeRange + 1) * 50);"""+s[b:];s=s.replace('{episodeRanges.length > 1 && !episodeQuery &&','{episodeRanges.length > 1 &&');s=s.replace('onChange={(event) => setEpisodeQuery(event.target.value)}','onChange={(event) => { setEpisodeQuery(event.target.value); setEpisodeRange(0); }}');p.write_text(s)
p=r/'src/pages/AdminPage.tsx';s=p.read_text().replace('useEffect, useState','useEffect, useRef, useState');s=s.replace("const [message, setMessage] = useState<string | null>(null);", "const [message, setMessage] = useState<string | null>(null);\n  const refreshController = useRef<AbortController | null>(null);");s=s.replace("    setBusy(true); setError(null);\n    try { setStatus(await api.importStatus(activeToken)); }\n    catch (cause) { setStatus(null); setError(errorMessage(cause)); }\n    finally { setBusy(false); }", """    refreshController.current?.abort();
    const controller = new AbortController(); refreshController.current = controller;
    setBusy(true); setError(null);
    try { const result = await api.importStatus(activeToken, controller.signal); if (!controller.signal.aborted) setStatus(result); }
    catch (cause) { if (!controller.signal.aborted) { setStatus(null); setError(errorMessage(cause)); } }
    finally { if (!controller.signal.aborted) setBusy(false); }""");s=s.replace("useEffect(() => { if (token) void refresh(token); }, [token, refresh]);", "useEffect(() => { if (token) void refresh(token); return () => refreshController.current?.abort(); }, [token, refresh]);");s=s.replace("storeToken(''); setToken(''); setStatus(null);", "refreshController.current?.abort(); storeToken(''); setToken(''); setDraftToken(''); setStatus(null); setBusy(false); setMessage(null); setError(null);");s=s.replace('Administrative controls are local-only and require the API token configured for this process.', 'Administrative controls require the API token configured for this server.');p.write_text(s)
p=r/'tests/api.test.ts';s=p.read_text();s=s.replace("    const exported = JSON.stringify(await fetch(`${origin}/api/exports/catalogue.json`).then((response) => response.json()));", """    expect((await fetch(`${origin}/api/exports/catalogue.json`)).status).toBe(503);
    vi.stubEnv('SOLANIME_ADMIN_TOKEN', 'export-test-token');
    expect((await fetch(`${origin}/api/exports/catalogue.csv`)).status).toBe(401);
    const exported = JSON.stringify(await fetch(`${origin}/api/exports/catalogue.json`, { headers: { 'x-admin-token': 'export-test-token' } }).then((response) => response.json()));""");p.write_text(s)
p=r/'index.html';s=p.read_text().replace('content="dark"','content="dark light"').replace('#11100e','#111315');s=s.replace('<title>', '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n    <title>');p.write_text(s)
(r/'public/favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#111315"/><path d="M33 13H20a7 7 0 000 14h8a4 4 0 010 8H15" fill="none" stroke="#ffad69" stroke-width="5" stroke-linecap="round"/><path d="m22 15 9 6-9 6V15Z" fill="#fff"/></svg>\n')
