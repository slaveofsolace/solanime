import { migrate, openDatabase } from '../server/db.ts';
import { listProviderAdapters } from '../server/providers/adapters.ts';
import type { StoredProviderMapping } from '../server/providers/contract.ts';

const db = openDatabase();
const results: Array<Record<string, unknown>> = [];

try {
  migrate(db);
  for (const adapter of listProviderAdapters()) {
    if (adapter.playbackType === 'unknown' || adapter.playbackType === 'download') {
      results.push({ providerId: adapter.id, label: adapter.label, adapter: 'unavailable', playbackType: adapter.playbackType, resolution: 'not-attempted', playbackVerified: false });
      continue;
    }
    const mappingForLanguage = db.prepare(`SELECT m.id AS mappingId,m.provider_id AS providerId,p.label,v.language,m.provider_resource_id AS providerResourceId,m.canonical_embed_url AS canonicalEmbedUrl,m.availability_state AS availability,m.unavailable_reason AS unavailableReason
      FROM episode_provider_mappings m JOIN providers p ON p.id=m.provider_id JOIN episode_versions v ON v.id=m.version_id
      WHERE m.provider_id=? AND v.language=? AND m.availability_state IN ('observed','available') AND (m.provider_resource_id IS NOT NULL OR m.canonical_embed_url IS NOT NULL)
      ORDER BY m.last_seen_at DESC,m.id DESC LIMIT 1`);
    for (const language of ['sub', 'dub']) {
      const mapping = mappingForLanguage.get(adapter.id, language) as StoredProviderMapping | undefined;
      if (!mapping) {
        results.push({ providerId: adapter.id, label: adapter.label, adapter: 'implemented', language, playbackType: adapter.playbackType, resolution: 'no-current-mapping', playbackVerified: false });
        continue;
      }
      const resolution = await adapter.resolve(mapping);
      const observedAt = new Date().toISOString();
      let hostname: string | null = null;
      const resolvedUrl = resolution.embedUrl ?? resolution.url;
      if (resolvedUrl) hostname = new URL(resolvedUrl).hostname;
      db.prepare(`INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at)
        VALUES ('mapping',?,?,?,?,?,?,?)`).run(String(mapping.mappingId), resolution.status === 'resolved' ? 'source_resolved' : 'failed', resolution.status, resolution.error?.code ?? null, 'local_runtime', JSON.stringify({ providerId: adapter.id, language, playbackType: resolution.playbackType, hostname, playbackVerified: false }), observedAt);
      if (resolution.status === 'resolved') db.prepare("UPDATE episode_provider_mappings SET last_successful_resolution_at=?,resolution_evidence_state='resolved',updated_at=? WHERE id=?").run(observedAt, observedAt, mapping.mappingId);
      results.push({ providerId: adapter.id, label: adapter.label, adapter: 'implemented', mappingId: mapping.mappingId, language: mapping.language, playbackType: resolution.playbackType, resolution: resolution.status, hostname, errorCode: resolution.error?.code ?? null, playbackVerified: false, observedAt });
    }
  }
  console.log(JSON.stringify({ ok: results.every((result) => result.adapter !== 'implemented' || result.resolution === 'resolved'), note: 'Resolution is verified separately from player load or media playback. Temporary URLs and opaque resource references are omitted.', results }, null, 2));
} finally { db.close(); }
