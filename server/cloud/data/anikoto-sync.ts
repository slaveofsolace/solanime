import { load } from 'cheerio';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { CatalogueDatabase } from './catalogue.ts';
import { SyncSourceError, type SyncHandlers, type SyncPlan, type SyncTask } from './sync.ts';
import { createAnikotoRefreshHandlers } from './anikoto-refresh.ts';

const ORIGIN = 'https://anikototv.to';
const USER_AGENT = 'SolAnimeSchoolProject/0.6 (public catalogue synchronization)';
type ServerObservation = { language: string; label: string; providerId: string; resource: string; mappingHash: string };
type RobotsPolicy = { rules: Array<{ path: string; allow: boolean }>; delayMs: number };
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function parseRobotsPolicy(body: string): RobotsPolicy {
  const groups: Array<{ agents: string[]; rules: RobotsPolicy['rules']; delayMs: number }> = [];
  let current: typeof groups[number] | null = null; let directives = false;
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*(?:#.*)?$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase(); const value = match[2];
    if (key === 'user-agent') {
      if (!current || directives) { current = { agents: [], rules: [], delayMs: 2500 }; groups.push(current); directives = false; }
      if (value) current.agents.push(value.toLowerCase()); continue;
    }
    if (!current) continue; directives = true;
    if ((key === 'allow' || key === 'disallow') && value) current.rules.push({ path: value, allow: key === 'allow' });
    if (key === 'crawl-delay' && Number.isFinite(Number(value)) && Number(value) >= 0) {
      const delayMs = Math.max(2500, Math.ceil(Number(value) * 1000));
      if (!Number.isSafeInteger(delayMs) || delayMs > 604_800_000) throw new SyncSourceError('The source crawl delay exceeds the supported scheduling window. No content request will be made.', 'BLOCKED', false);
      current.delayMs = delayMs;
    }
  }
  const named = groups.filter(group => group.agents.some(agent => agent !== '*' && USER_AGENT.toLowerCase().includes(agent)));
  const chosen = named.length ? named : groups.filter(group => group.agents.includes('*'));
  return { rules: chosen.flatMap(group => group.rules), delayMs: Math.max(2500, ...chosen.map(group => group.delayMs)) };
}
export function robotsAllows(policy: RobotsPolicy, path: string) {
  const matching = policy.rules.filter(rule => new RegExp(`^${rule.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}${rule.path.endsWith('$') ? '' : '.*'}`).test(path)).sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return matching[0]?.allow ?? true;
}
async function boundedBody(response: Response, maxBytes: number) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new SyncSourceError('Source response exceeded the bounded size limit.', 'UPSTREAM_CHANGED', false);
  if (!response.body) throw new SyncSourceError('Source response had no body.', 'UPSTREAM_CHANGED', true);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new SyncSourceError('Source response exceeded the bounded size limit.', 'UPSTREAM_CHANGED', false); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}
export function parseServerObservations(html: string): Omit<ServerObservation, 'mappingHash'>[] {
  const $ = load(html); const buttons = $('[data-link-id]');
  if (!buttons.length) {
    if (/loading|spinner|skeleton|please\s+wait/i.test(html)) throw new SyncSourceError('Server list is still loading. Existing mappings were preserved.', 'UNAVAILABLE', true, 60);
    if (/you(?:'|’)?re\s+watching\s+episode/i.test($.root().text())) return [];
    throw new SyncSourceError('Server list schema changed or its empty state was not recognizable.', 'UPSTREAM_CHANGED', false);
  }
  const records: Omit<ServerObservation, 'mappingHash'>[] = [];
  $('.type[data-type]').each((_index, group) => {
    const language = clean($(group).attr('data-type') ?? '').toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(language)) return;
    $(group).find('[data-link-id]').each((_offset, element) => {
      const label = clean($(element).text()); const resource = clean($(element).attr('data-link-id') ?? '');
      if (!label || label.length > 100 || !resource || resource.length > 4000) return;
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'unnamed';
      records.push({ language, label, resource, providerId: ['vidstream-2', 'hd-1', 'hd-2', 'vidplay-1', 'kiwi', 'megaplay'].includes(slug) ? slug : `observed-${slug}` });
    });
  });
  if (records.length !== buttons.length || records.length > 100) throw new SyncSourceError('Not every observed server option passed schema validation. Existing mappings were preserved.', 'UPSTREAM_CHANGED', false);
  return records;
}
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

/** Only observed source routes are allowed; this is not an arbitrary URL fetcher. */
export function createAnikotoSyncHandlers(db: CatalogueDatabase, options: { fetch?: typeof fetch; now?: () => number } = {}): SyncHandlers {
  const send = options.fetch ?? fetch; const clock = options.now ?? Date.now;
  async function request(path: string, accept: string, delayMs = 2500) {
    await db.prepare("INSERT INTO cloud_source_policy(hostname) VALUES('anikototv.to') ON CONFLICT DO NOTHING").run();
    let url = new URL(path, ORIGIN); const signal = AbortSignal.timeout(20_000);
    try {
      for (let redirects = 0; redirects <= 2; redirects++) {
        const allowed = ['/robots.txt', '/ajax/server/list', '/filter', '/sitemap.xml'].includes(url.pathname) || /^\/watch\/[^/]+\/?$/.test(url.pathname) || /^\/ajax\/episode\/list\/[^/]+$/.test(url.pathname) || /^\/sitemap\/[a-zA-Z0-9/_-]+\.xml$/.test(url.pathname);
        if (url.origin !== ORIGIN || !allowed || url.username || url.password) throw new SyncSourceError('Source redirect left the verified route allowlist.', 'BLOCKED', false);
        const current = clock();
        const turn = await db.prepare("UPDATE cloud_source_policy SET next_allowed_at=MAX(next_allowed_at,?)+? WHERE hostname='anikototv.to' AND next_allowed_at<=? RETURNING next_allowed_at").bind(current, delayMs, current + 20_000).first<{ next_allowed_at: number }>();
        if (!turn) {
          const next = await db.prepare("SELECT next_allowed_at FROM cloud_source_policy WHERE hostname='anikototv.to'").first<{ next_allowed_at: number }>();
          throw new SyncSourceError('Source request window is busy. The durable task will resume later.', 'UNAVAILABLE', true, Math.max(30, Math.ceil(((next?.next_allowed_at ?? clock() + 30_000) - clock()) / 1000)));
        }
        const waitMs = Math.max(0, turn.next_allowed_at - delayMs - clock());
        if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
        const response = await send(url, { method: 'GET', headers: { accept, 'user-agent': USER_AGENT, ...(accept === 'application/json' ? { 'x-requested-with': 'XMLHttpRequest', referer: `${ORIGIN}/` } : {}) }, redirect: 'manual', signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const destination = response.headers.get('location'); await response.body?.cancel();
          if (!destination || redirects === 2) throw new SyncSourceError('Source redirect was malformed or exceeded its limit.', 'UPSTREAM_CHANGED', false);
          url = new URL(destination, url); continue;
        }
        if ([401, 403, 451].includes(response.status)) {
          await response.body?.cancel();
          const until = new Date(clock() + 6 * 60 * 60_000).toISOString();
          await db.prepare("UPDATE cloud_source_policy SET policy_json=?,expires_at=? WHERE hostname='anikototv.to'").bind(JSON.stringify({ rules: [{ path: '/', allow: false }], delayMs: 2500, blockedUntil: until, blockedStatus: response.status }), until).run();
          throw new SyncSourceError('Source refused access. No bypass was attempted.', 'BLOCKED', false, 0, response.status);
        }
        if (response.status === 429 || response.status >= 500) {
          const raw = response.headers.get('retry-after'); const retryAt = raw && /^\d+$/.test(raw) ? Number(raw) : raw ? Math.ceil((Date.parse(raw) - clock()) / 1000) : 60;
          const retrySeconds = Number.isFinite(retryAt) ? Math.max(1, Math.min(604_800, retryAt)) : 60;
          await response.body?.cancel();
          await db.prepare("UPDATE cloud_source_policy SET next_allowed_at=MAX(next_allowed_at,?) WHERE hostname='anikototv.to'").bind(clock() + retrySeconds * 1000).run();
          throw new SyncSourceError('Source is rate limited or temporarily unavailable.', 'UNAVAILABLE', true, retrySeconds, response.status);
        }
        if (url.pathname === '/robots.txt' && response.status === 404) { await response.body?.cancel(); return ''; }
        if (!response.ok) { await response.body?.cancel(); throw new SyncSourceError('The requested public resource is unavailable.', 'UNAVAILABLE', false, 0, response.status); }
        const body = await boundedBody(response, url.pathname === '/robots.txt' ? 64_000 : url.pathname === '/ajax/server/list' ? 512_000 : 5_000_000);
        if (/captcha|cf-chl-|just a moment|access denied/i.test(body)) throw new SyncSourceError('Source returned an access challenge. No bypass was attempted.', 'BLOCKED', false);
        return body;
      }
    } catch (error) { if (error instanceof SyncSourceError) throw error; throw new SyncSourceError(signal.aborted ? 'Source request timed out.' : 'Source request failed.', 'UNAVAILABLE', true); }
    throw new SyncSourceError('Source request did not settle.', 'UNAVAILABLE', true);
  }
  async function policy(): Promise<RobotsPolicy> {
    const stored = await db.prepare("SELECT policy_json,expires_at FROM cloud_source_policy WHERE hostname='anikototv.to'").first<{ policy_json: string; expires_at: string | null }>();
    if (stored?.expires_at && Date.parse(stored.expires_at) > clock()) {
      const cached = JSON.parse(stored.policy_json) as RobotsPolicy & { blockedUntil?: string; blockedStatus?: number };
      if (cached.blockedUntil && Date.parse(cached.blockedUntil) > clock()) throw new SyncSourceError('A source access refusal is still active; no further network request was made.', 'BLOCKED', false, 0, cached.blockedStatus);
      return cached;
    }
    const parsed = parseRobotsPolicy(await request('/robots.txt', 'text/plain'));
    await db.prepare("UPDATE cloud_source_policy SET policy_json=?,expires_at=? WHERE hostname='anikototv.to'").bind(JSON.stringify(parsed), new Date(clock() + 6 * 60 * 60_000).toISOString()).run();
    return parsed;
  }
  async function episodeServers(task: SyncTask): Promise<SyncPlan> {
    const titleSourceId = task.payload.titleSourceId; const episodeSourceId = task.payload.episodeSourceId; const serversRef = task.payload.serversRef;
    if (typeof titleSourceId !== 'string' || typeof episodeSourceId !== 'string' || typeof serversRef !== 'string' || !serversRef || serversRef.length > 12_000) throw new SyncSourceError('The persisted server task identifiers are invalid.', 'UPSTREAM_CHANGED', false);
    const episode = await db.prepare("SELECT e.id,(SELECT COUNT(*) FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id WHERE v.episode_id=e.id AND m.mapping_origin='native') AS existingMappings FROM episodes e JOIN titles t ON t.id=e.title_id WHERE t.source='anikoto' AND t.source_id=? AND e.source_id=?").bind(titleSourceId, episodeSourceId).first<{ id: number; existingMappings: number }>();
    if (!episode) throw new SyncSourceError('The episode has not been imported yet. Its task is retained.', 'UNAVAILABLE', true, 3600);
    let records: ServerObservation[];
    let observedAt = typeof task.checkpoint.observedAt === 'string' ? task.checkpoint.observedAt : new Date(clock()).toISOString();
    let offset = Number(task.checkpoint.offset ?? 0);
    if (Array.isArray(task.checkpoint.records)) {
      records = task.checkpoint.records as ServerObservation[];
      if (records.some(record => !record || !/^[a-z][a-z0-9_-]{0,31}$/.test(record.language) || typeof record.resource !== 'string' || typeof record.providerId !== 'string' || typeof record.label !== 'string' || !/^[a-f0-9]{64}$/.test(record.mappingHash)) || !Number.isSafeInteger(offset) || offset < 0 || offset > records.length) throw new SyncSourceError('The persisted server checkpoint is malformed.', 'UPSTREAM_CHANGED', false);
    } else {
      const path = `/ajax/server/list?servers=${encodeURIComponent(serversRef)}`;
      const rules = await policy();
      if (!robotsAllows(rules, path)) throw new SyncSourceError('The source robots policy excludes this server-list route.', 'BLOCKED', false);
      let envelope: unknown;
      try { envelope = JSON.parse(await request(path, 'application/json', rules.delayMs)); } catch (error) { if (error instanceof SyncSourceError) throw error; throw new SyncSourceError('The source server-list response was not valid JSON.', 'UPSTREAM_CHANGED', false); }
      if (!envelope || typeof envelope !== 'object' || !('status' in envelope) || envelope.status !== 200 || !('result' in envelope) || typeof envelope.result !== 'string') throw new SyncSourceError('The source server-list envelope changed.', 'UPSTREAM_CHANGED', false);
      records = await Promise.all(parseServerObservations(envelope.result).map(async record => ({ ...record, mappingHash: await digest(`${record.language}\0${record.label}\0${record.resource}`) })));
      offset = 0; observedAt = new Date(clock()).toISOString();
    }
    const selected = records.slice(offset, offset + 4); const statements: D1PreparedStatement[] = [];
    for (const record of selected) {
      statements.push(db.prepare("INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,capabilities_json,observed_limitation,evidence_class,first_seen_at,last_seen_at,updated_at) VALUES(?,?,'confirmed','unknown','unavailable','{}','Visible server label; native playback support has not been established.','public_response',?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at WHERE julianday(excluded.updated_at)>=julianday(providers.updated_at)").bind(record.providerId, record.label, observedAt, observedAt, observedAt));
      statements.push(db.prepare("INSERT INTO provider_aliases(provider_id,alias,alias_type) VALUES(?,?,'visible_label') ON CONFLICT DO NOTHING").bind(record.providerId, record.label));
      statements.push(db.prepare("INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,first_seen_at,last_seen_at,last_successful_import_at) VALUES((SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM episode_versions),?,?,?,?,?,?,?) ON CONFLICT(episode_id,source_id,language) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at WHERE episode_versions.last_successful_import_at IS NULL OR julianday(excluded.last_successful_import_at)>=julianday(episode_versions.last_successful_import_at)").bind(episode.id, `${episodeSourceId}:${record.language}`, record.language, record.language.toUpperCase(), observedAt, observedAt, observedAt));
      statements.push(db.prepare("INSERT INTO episode_provider_mappings(id,version_id,provider_id,source_mapping_id,provider_resource_id,mapping_origin,public_export_allowed,availability_state,first_seen_at,last_seen_at,last_successful_import_at,updated_at) VALUES((SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM episode_provider_mappings),(SELECT id FROM episode_versions WHERE episode_id=? AND source_id=? AND language=?),?,?,?,'native',0,'observed',?,?,?,?) ON CONFLICT(version_id,provider_id,source_mapping_id) DO UPDATE SET provider_resource_id=excluded.provider_resource_id,last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,updated_at=excluded.updated_at,availability_state=CASE WHEN episode_provider_mappings.resolution_evidence_state='playback_verified' THEN episode_provider_mappings.availability_state ELSE 'observed' END,unavailable_reason=NULL WHERE julianday(excluded.updated_at)>=julianday(episode_provider_mappings.updated_at)").bind(episode.id, `${episodeSourceId}:${record.language}`, record.language, record.providerId, record.mappingHash, record.resource, observedAt, observedAt, observedAt, observedAt));
    }
    const nextOffset = offset + selected.length; const complete = nextOffset >= records.length;
    if (complete) {
      statements.push(db.prepare("UPDATE episode_provider_mappings SET availability_state='stale',unavailable_reason='Not present in the latest successfully parsed source server list.',updated_at=? WHERE mapping_origin='native' AND julianday(last_seen_at)<julianday(?) AND julianday(updated_at)<=julianday(?) AND version_id IN (SELECT id FROM episode_versions WHERE episode_id=?) AND NOT EXISTS(SELECT 1 FROM providers p WHERE p.id=episode_provider_mappings.provider_id AND p.evidence_class='approved_native_resource')").bind(observedAt, observedAt, observedAt, episode.id));
      statements.push(db.prepare("INSERT INTO verification_observations(id,entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at) VALUES((SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM verification_observations),'episode',?,'observed',?,'SOURCE_SERVER_LIST','public_response',?,?)").bind(String(episode.id), records.length ? 'provider_inventory_imported' : 'empty_provider_inventory', JSON.stringify({ mappingButtons: records.length, playbackVerified: false }), observedAt));
    }
    return { statements, estimatedWrittenRows: selected.length * 32 + (complete ? episode.existingMappings * 5 + 8 : 0), complete, checkpoint: { observedAt, offset: nextOffset, ...(complete ? { mappingsObserved: records.length } : { records }) } };
  }
  return { episode_servers: episodeServers, ...createAnikotoRefreshHandlers(db, {
    now: clock,
    read: async (path, accept) => {
      const rules = await policy();
      const url = new URL(path, ORIGIN);
      if (!robotsAllows(rules, `${url.pathname}${url.search}`)) throw new SyncSourceError('The source robots policy excludes this discovery route.', 'BLOCKED', false);
      return request(path, accept, rules.delayMs);
    },
  }) };
}
