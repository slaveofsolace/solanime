import { AppError } from '../../errors.ts';
import type { CatalogueDatabase } from './catalogue.ts';

type Row = Record<string, unknown>;
export interface SourceBrowseParams { q?: string; category?: string; kind?: string; status?: string; page?: number; pageSize?: number; }
export function createResearchRepository(db: CatalogueDatabase) {
  async function browseSources(params: SourceBrowseParams = {}) {
    const page = params.page ?? 1; const pageSize = params.pageSize ?? 30;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || (params.q?.length ?? 0) > 200)
      throw new AppError(400, 'INVALID_QUERY', 'Invalid source search or page.');
    const where = ['1=1']; const values: unknown[] = [];
    if (params.q) { where.push('(INSTR(LOWER(r.name),LOWER(?))>0 OR INSTR(LOWER(COALESCE(r.url,\'\')),LOWER(?))>0 OR r.source_id=?)'); values.push(params.q, params.q, params.q); }
    if (params.category) { where.push('EXISTS (SELECT 1 FROM research_categories c WHERE c.record_id=r.id AND c.category=?)'); values.push(params.category); }
    if (params.kind) { where.push('r.kind=?'); values.push(params.kind); }
    if (params.status) { where.push('r.research_status=?'); values.push(params.status); }
    const from = `FROM research_records r WHERE ${where.join(' AND ')}`;
    const result = await db.batch<Row>([
      db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...values),
      db.prepare(`SELECT r.id,r.source_id AS sourceId,r.name,r.kind,r.url,r.collection,r.research_status AS researchStatus,r.evidence_class AS evidenceClass,r.observation_date AS observedAt,r.canonical_id AS canonicalId,r.provenance_path AS provenancePath,(SELECT action FROM research_reviews v WHERE v.record_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1) AS reviewState,EXISTS(SELECT 1 FROM research_capabilities c WHERE c.record_id=r.id AND c.implementation_state='implemented') AS hasImplementedCapability ${from} ORDER BY r.name COLLATE NOCASE,r.id LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize),
    ]);
    const total = Number(result[0].results[0].count);
    return { items: result[1].results, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }
  async function getSource(id: string) {
    const record = await db.prepare('SELECT * FROM research_records WHERE id=?').bind(id).first<Row>();
    if (!record) throw new AppError(404, 'NOT_FOUND', 'Research source was not found.');
    const result = await db.batch<Row>([
      db.prepare('SELECT category FROM research_categories WHERE record_id=? ORDER BY category').bind(id),
      db.prepare('SELECT * FROM research_relationships WHERE source_id=? OR target_id=? ORDER BY id LIMIT 101').bind(id, id),
      db.prepare('SELECT * FROM research_aliases WHERE alias_id=? OR canonical_id=? ORDER BY alias_id').bind(id, id),
      db.prepare('SELECT capability,implementation_state AS implementationState,runtime_verified AS runtimeVerified,evidence_json AS evidence,updated_at AS updatedAt FROM research_capabilities WHERE record_id=? ORDER BY capability').bind(id),
      db.prepare('SELECT id,action,note,actor_id AS actorId,created_at AS createdAt FROM research_reviews WHERE record_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(id),
    ]);
    const { record_json, ...summary } = record;
    return { source: summary, evidence: JSON.parse(String(record_json)), categories: result[0].results.map(row => row.category), relationships: result[1].results.slice(0, 100), relationshipsTruncated: result[1].results.length > 100, aliases: result[2].results, capabilities: result[3].results, reviews: result[4].results };
  }
  async function relationships(id: string, afterId = '', limit = 100) {
    if (limit < 1 || limit > 100 || !Number.isSafeInteger(limit)) throw new AppError(400, 'INVALID_QUERY', 'Invalid relationship page size.');
    const result = await db.prepare('SELECT * FROM research_relationships WHERE (source_id=? OR target_id=?) AND id>? ORDER BY id LIMIT ?').bind(id, id, afterId, limit + 1).all<Row>();
    const items = result.results.slice(0, limit);
    return { items, nextCursor: result.results.length > limit ? items.at(-1)?.id : null };
  }
  async function evidenceFragments(id: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError(400, 'INVALID_QUERY', 'Invalid evidence fragment offset.');
    const result = await db.prepare('SELECT fragment_index AS fragmentIndex,content FROM research_record_fragments WHERE record_id=? AND fragment_index>=? ORDER BY fragment_index LIMIT 5').bind(id, offset).all<Row>();
    const items = result.results.slice(0, 4);
    return { items, nextOffset: result.results.length > 4 ? Number(items.at(-1)?.fragmentIndex) + 1 : null, format: 'Concatenate content in fragment order, then parse as JSON. Only restricted operator routes may return this evidence.' };
  }
  async function reviewSource(id: string, action: string, actor: string, note = '') {
    if (!['reviewed', 'needs_investigation', 'blocked', 'rejected'].includes(action) || !actor || actor.length > 200 || note.length > 2000)
      throw new AppError(400, 'INVALID_REVIEW', 'Choose a review action and a note under 2,000 characters. Reviews do not enable providers.');
    if (!await db.prepare('SELECT id FROM research_records WHERE id=?').bind(id).first()) throw new AppError(404, 'NOT_FOUND', 'Research source was not found.');
    const reviewId = crypto.randomUUID(); const timestamp = new Date().toISOString();
    await db.prepare('INSERT INTO research_reviews(id,record_id,action,note,actor_id,created_at) VALUES(?,?,?,?,?,?)').bind(reviewId, id, action, note, actor, timestamp).run();
    return { id: reviewId, sourceId: id, action, note, createdAt: timestamp, capabilitiesChanged: false };
  }
  async function coverage() {
    const result = await db.batch<Row>([
      db.prepare('SELECT collection,kind,COUNT(*) AS count FROM research_records GROUP BY collection,kind ORDER BY collection,kind'),
      db.prepare('SELECT research_status AS status,COUNT(*) AS count FROM research_records GROUP BY research_status ORDER BY research_status'),
      db.prepare('SELECT category,COUNT(*) AS count FROM research_categories GROUP BY category ORDER BY category'),
      db.prepare('SELECT (SELECT COUNT(*) FROM research_relationships) AS relationships,(SELECT COUNT(*) FROM research_aliases) AS aliases,(SELECT COUNT(*) FROM research_documents) AS evidenceFiles,(SELECT COUNT(*) FROM research_capabilities WHERE implementation_state=\'implemented\') AS implementedCapabilities,(SELECT COUNT(*) FROM research_capabilities WHERE capability=\'playback\' AND runtime_verified=1) AS verifiedPlaybackCapabilities'),
      db.prepare('SELECT id,source,content_hash AS contentHash,counts_json AS counts,observation_date AS observationDate,imported_at AS importedAt FROM cloud_snapshot_sources ORDER BY id'),
    ]);
    return { collections: result[0].results, statuses: result[1].results, categories: result[2].results, counts: result[3].results[0], snapshots: result[4].results, denominatorScope: 'FMHY pinned listing occurrences; supplemental records and evidence overlap and are not added to the listing denominator.' };
  }
  return { browseSources, getSource, relationships, evidenceFragments, reviewSource, coverage };
}
