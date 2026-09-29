import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage, request } from '../lib/api';
import { InlineNotice } from '../components/ui';
import '../styles/sources.css';

type Source = { id: string; name: string; kind: string; url: string | null; researchStatus: string; evidenceClass: string; observedAt: string | null; provenancePath: string; reviewState: string | null; hasImplementedCapability: number };
type Listing = { items: Source[]; total: number; page: number; pages: number };
type Relationship = Record<string, unknown> & { id?: string };
type Detail = { source: Record<string, unknown>; evidence: unknown; categories: string[]; relationships: Relationship[]; relationshipsTruncated: boolean; capabilities: { capability: string; implementationState: string; runtimeVerified: number }[]; reviews: { id: string; action: string; note: string; createdAt: string }[] };
type RelationshipPage = { items: Relationship[]; nextCursor: string | null };
type EvidenceFragment = { fragmentIndex: number; content: string };
type EvidencePage = { items: EvidenceFragment[]; nextOffset: number | null; format: string };
type Coverage = { categories: { category: string; count: number }[]; statuses: { status: string; count: number }[]; counts: Record<string, number>; denominatorScope: string };

const lastId = (items: Relationship[]) => {
  const id = items.at(-1)?.id;
  return typeof id === 'string' ? id : null;
};

export default function AdminSourcesPage() {
  const [params, setParams] = useSearchParams();
  const [draftToken, setDraftToken] = useState('');
  const [token, setToken] = useState('');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [listing, setListing] = useState<Listing | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState<Source | null>(null);
  const [listingError, setListingError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [relationshipError, setRelationshipError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [listingBusy, setListingBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [relationshipsBusy, setRelationshipsBusy] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [relationshipCursor, setRelationshipCursor] = useState<string | null>(null);
  const [evidenceFragments, setEvidenceFragments] = useState<EvidenceFragment[]>([]);
  const [evidenceOffset, setEvidenceOffset] = useState<number | null>(0);
  const [evidenceLoaded, setEvidenceLoaded] = useState(false);
  const [evidenceError, setEvidenceError] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('reviewed');
  const [revision, setRevision] = useState(0);
  const detailAbort = useRef<AbortController | null>(null);
  const relationshipAbort = useRef<AbortController | null>(null);
  const evidenceAbort = useRef<AbortController | null>(null);
  const reviewAbort = useRef<AbortController | null>(null);
  const selectedId = useRef<string | null>(null);
  const detailGeneration = useRef(0);
  const authorizationGeneration = useRef(0);
  const queryString = params.toString();

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const generation = authorizationGeneration.current;
    setListingBusy(true);
    setListingError('');
    void Promise.all([
      request<Listing>(`/api/admin/sources?${queryString}`, { headers: { 'x-admin-token': token }, signal: controller.signal }),
      request<Coverage>('/api/admin/sources/coverage', { headers: { 'x-admin-token': token }, signal: controller.signal }),
    ]).then(([rows, counts]) => {
      if (!controller.signal.aborted && generation === authorizationGeneration.current) { setListing(rows); setCoverage(counts); }
    }).catch(cause => {
      if (!controller.signal.aborted && generation === authorizationGeneration.current) setListingError(errorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted && generation === authorizationGeneration.current) setListingBusy(false);
    });
    return () => controller.abort();
  }, [token, queryString, revision]);

  useEffect(() => () => {
    detailAbort.current?.abort(); relationshipAbort.current?.abort(); evidenceAbort.current?.abort(); reviewAbort.current?.abort();
  }, []);

  useEffect(() => {
    detailGeneration.current++;
    selectedId.current = null;
    detailAbort.current?.abort();
    relationshipAbort.current?.abort();
    evidenceAbort.current?.abort();
    reviewAbort.current?.abort();
    setSelected(null);
    setDetail(null);
    setDetailError('');
    setRelationshipError('');
    setReviewError('');
    setRelationshipCursor(null);
    setEvidenceFragments([]);
    setEvidenceOffset(0);
    setEvidenceLoaded(false);
    setEvidenceError('');
    setDetailBusy(false);
    setRelationshipsBusy(false);
    setEvidenceBusy(false);
    setReviewBusy(false);
  }, [queryString]);

  const loadDetail = async (source: Source, newSelection: boolean) => {
    detailAbort.current?.abort(); relationshipAbort.current?.abort(); evidenceAbort.current?.abort();
    if (newSelection) reviewAbort.current?.abort();
    const controller = new AbortController(); detailAbort.current = controller;
    const generation = ++detailGeneration.current;
    if (newSelection) {
      selectedId.current = source.id;
      setSelected(source);
      setNote('');
      setReviewError('');
      setReviewBusy(false);
      setRelationshipsBusy(false);
      setEvidenceBusy(false);
      setEvidenceFragments([]);
      setEvidenceOffset(0);
      setEvidenceLoaded(false);
      setEvidenceError('');
    }
    setDetail(null); setDetailError(''); setRelationshipError(''); setRelationshipCursor(null); setDetailBusy(true);
    try {
      const result = await request<Detail>(`/api/admin/sources/${encodeURIComponent(source.id)}`, { headers: { 'x-admin-token': token }, signal: controller.signal });
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === source.id) {
        setDetail(result);
        setRelationshipCursor(result.relationshipsTruncated ? lastId(result.relationships) : null);
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === source.id) setDetailError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === source.id) setDetailBusy(false);
    }
  };

  const loadMoreRelationships = async () => {
    const id = selectedId.current, cursor = relationshipCursor;
    if (!id || !cursor || relationshipsBusy) return;
    relationshipAbort.current?.abort();
    const controller = new AbortController(); relationshipAbort.current = controller;
    const generation = detailGeneration.current;
    setRelationshipsBusy(true); setRelationshipError('');
    try {
      const page = await request<RelationshipPage>(`/api/admin/sources/${encodeURIComponent(id)}/relationships?after=${encodeURIComponent(cursor)}&limit=100`, { headers: { 'x-admin-token': token }, signal: controller.signal });
      if (controller.signal.aborted || generation !== detailGeneration.current || selectedId.current !== id) return;
      setDetail(current => current ? {
        ...current,
        relationships: [...current.relationships, ...page.items.filter(item => !item.id || !current.relationships.some(existing => existing.id === item.id))],
        relationshipsTruncated: page.nextCursor !== null,
      } : current);
      setRelationshipCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === id) setRelationshipError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === id) setRelationshipsBusy(false);
    }
  };

  const loadEvidenceFragments = async () => {
    const id = selectedId.current, offset = evidenceOffset;
    if (!id || offset === null || evidenceBusy) return;
    evidenceAbort.current?.abort();
    const controller = new AbortController(); evidenceAbort.current = controller;
    const generation = detailGeneration.current;
    setEvidenceBusy(true); setEvidenceError('');
    try {
      const page = await request<EvidencePage>(`/api/admin/sources/${encodeURIComponent(id)}/evidence?offset=${offset}`, { headers: { 'x-admin-token': token }, signal: controller.signal });
      if (controller.signal.aborted || generation !== detailGeneration.current || selectedId.current !== id) return;
      setEvidenceFragments(current => [...current, ...page.items.filter(item => !current.some(existing => existing.fragmentIndex === item.fragmentIndex))]);
      setEvidenceOffset(page.nextOffset);
      setEvidenceLoaded(true);
    } catch (cause) {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === id) setEvidenceError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === id) setEvidenceBusy(false);
    }
  };

  const filter = (name: string, value: string) => {
    const next = new URLSearchParams(params); next.delete('page');
    if (value) next.set(name, value); else next.delete(name);
    setParams(next);
  };
  const lock = () => {
    authorizationGeneration.current++; detailGeneration.current++; selectedId.current = null;
    detailAbort.current?.abort(); relationshipAbort.current?.abort(); evidenceAbort.current?.abort(); reviewAbort.current?.abort();
    setToken(''); setDraftToken(''); setListing(null); setCoverage(null); setSelected(null); setDetail(null); setRelationshipCursor(null);
    setEvidenceFragments([]); setEvidenceOffset(0); setEvidenceLoaded(false);
    setListingError(''); setDetailError(''); setRelationshipError(''); setEvidenceError(''); setReviewError('');
    setListingBusy(false); setDetailBusy(false); setRelationshipsBusy(false); setEvidenceBusy(false); setReviewBusy(false);
  };

  const saveReview = async () => {
    const current = selected;
    if (!current || reviewBusy) return;
    reviewAbort.current?.abort();
    const controller = new AbortController(); reviewAbort.current = controller;
    const generation = detailGeneration.current;
    setReviewBusy(true); setReviewError('');
    try {
      await request(`/api/admin/sources/${encodeURIComponent(current.id)}/review`, { method: 'POST', headers: { 'x-admin-token': token }, body: JSON.stringify({ action, note }), signal: controller.signal });
      if (controller.signal.aborted || generation !== detailGeneration.current || selectedId.current !== current.id) return;
      setNote('');
      await loadDetail(current, false);
      setRevision(value => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted && generation === detailGeneration.current && selectedId.current === current.id) setReviewError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted && selectedId.current === current.id) setReviewBusy(false);
    }
  };

  return <div className="sources-page">
    <header className="sources-heading"><div><p className="eyebrow">OPERATOR ACCESS</p><h1>Source browser</h1></div><Link to="/admin" className="text-button">Import diagnostics</Link></header>
    {!token ? <form className="admin-login sources-login" onSubmit={event => { event.preventDefault(); authorizationGeneration.current++; setToken(draftToken.trim()); setDraftToken(''); }}>
      <p>Research evidence and review controls. The token is kept in memory only and does not enable playback providers.</p>
      <label>Operator token<input type="password" autoComplete="off" required value={draftToken} onChange={event => setDraftToken(event.target.value)} /></label>
      <button className="button button--primary">Unlock sources</button>
    </form> : <>
      <div className="sources-tools">
        <form role="search" onSubmit={event => { event.preventDefault(); filter('q', query.trim()); }}><label className="sr-only" htmlFor="source-query">Search sources</label><input id="source-query" placeholder="Search names, hosts or source IDs" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /><button className="button button--outline">Search</button></form>
        <label>Category<select value={params.get('category') ?? ''} onChange={event => filter('category', event.target.value)}><option value="">All categories</option>{coverage?.categories.map(item => <option key={item.category} value={item.category}>{item.category} ({item.count})</option>)}</select></label>
        <label>Research status<select value={params.get('status') ?? ''} onChange={event => filter('status', event.target.value)}><option value="">All statuses</option>{coverage?.statuses.map(item => <option key={item.status} value={item.status}>{item.status} ({item.count})</option>)}</select></label>
        <button type="button" className="text-button" onClick={lock}>Lock</button>
      </div>
      {listingError && <InlineNotice tone="error">{listingError} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry source list</button></InlineNotice>}
      {coverage && <p className="sources-scope">{coverage.denominatorScope}</p>}
      <p role="status" aria-live="polite">{listingBusy ? 'Loading sources…' : listing ? `${listing.total.toLocaleString()} matching records` : 'No records loaded.'}</p>
      <div className="sources-workspace">
        <section aria-label="Research sources" aria-busy={listingBusy}>
          <ul className="source-list">{listing?.items.map(source => <li key={source.id}><button type="button" aria-pressed={source.id === selected?.id} onClick={() => void loadDetail(source, true)}><strong>{source.name}</strong><span>{source.kind} · {source.researchStatus}</span><small>{source.url ?? source.provenancePath}</small><span className="source-state">{source.hasImplementedCapability ? 'Has implemented capability' : 'Research only'}{source.reviewState ? ` · ${source.reviewState.replaceAll('_', ' ')}` : ''}</span></button></li>)}</ul>
          {listing && <nav className="sources-pagination" aria-label="Source pages"><button type="button" disabled={listingBusy || listing.page <= 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(listing.page - 1)); setParams(next); }}>Previous</button><span>{listing.page} / {Math.max(1, listing.pages)}</span><button type="button" disabled={listingBusy || listing.page >= listing.pages} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(listing.page + 1)); setParams(next); }}>Next</button></nav>}
        </section>
        <section className="source-detail" aria-label="Selected source evidence" aria-busy={detailBusy}>
          {!selected ? <p>Select a source to inspect its evidence and review history.</p> : <><h2>{selected.name}</h2><p>{selected.evidenceClass} · {selected.observedAt ? new Date(selected.observedAt).toLocaleDateString() : 'Date not recorded'}</p><code>{selected.id}</code>
            {detailBusy && <p role="status">Loading source evidence…</p>}
            {detailError && <InlineNotice tone="error">Could not load source evidence: {detailError} <button type="button" onClick={() => void loadDetail(selected, false)}>Retry details</button></InlineNotice>}
            {detail && <>
              <h3>Capabilities</h3>{detail.capabilities.length ? <ul>{detail.capabilities.map(capability => <li key={capability.capability}>{capability.capability}: {capability.implementationState}{capability.runtimeVerified ? ' · runtime verified' : ' · not runtime verified'}</li>)}</ul> : <p>No enabled capability is recorded.</p>}
              <details><summary>Source evidence</summary><pre>{JSON.stringify(detail.evidence, null, 2)}</pre></details>
              <details className="source-fragments"><summary>Extended evidence fragments{evidenceLoaded ? ` (${evidenceFragments.length})` : ''}</summary>
                <p>Large evidence is loaded in bounded chunks only when requested.</p>
                {!evidenceLoaded && !evidenceError && <button type="button" className="button button--outline" disabled={evidenceBusy} onClick={() => void loadEvidenceFragments()}>{evidenceBusy ? 'Loading evidence…' : 'Load evidence fragments'}</button>}
                {evidenceFragments.length > 0 && <pre aria-label="Loaded evidence fragments">{evidenceFragments.map(item => item.content).join('')}</pre>}
                {evidenceError && <InlineNotice tone="error">Could not load evidence fragments: {evidenceError} <button type="button" onClick={() => void loadEvidenceFragments()}>Retry evidence fragments</button></InlineNotice>}
                {evidenceLoaded && evidenceOffset !== null && <button type="button" className="button button--outline evidence-more" disabled={evidenceBusy} onClick={() => void loadEvidenceFragments()}>{evidenceBusy ? 'Loading evidence…' : 'Load next evidence fragments'}</button>}
                {evidenceLoaded && evidenceOffset === null && <p className="relationships-complete">All evidence fragments loaded.</p>}
              </details>
              <details><summary>Relationships ({detail.relationships.length}{detail.relationshipsTruncated ? '+' : ''})</summary><pre>{JSON.stringify(detail.relationships, null, 2)}</pre>
                {relationshipError && <InlineNotice tone="error">Could not load more relationships: {relationshipError} <button type="button" onClick={() => void loadMoreRelationships()}>Retry relationships</button></InlineNotice>}
                {relationshipCursor && <button type="button" className="button button--outline relationships-more" disabled={relationshipsBusy} onClick={() => void loadMoreRelationships()}>{relationshipsBusy ? 'Loading relationships…' : 'Load more relationships'}</button>}
                {!relationshipCursor && detail.relationships.length > 0 && <p className="relationships-complete">All relationships loaded.</p>}
              </details>
              <form className="source-review" onSubmit={event => { event.preventDefault(); void saveReview(); }}>
                <label>Review<select value={action} onChange={event => setAction(event.target.value)}><option value="reviewed">Reviewed</option><option value="needs_investigation">Needs investigation</option><option value="blocked">Blocked</option><option value="rejected">Rejected</option></select></label>
                <label>Review note<textarea maxLength={2000} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
                {reviewError && <InlineNotice tone="error">Review was not saved: {reviewError}. Your note is still available; try again.</InlineNotice>}
                <button className="button button--primary" disabled={reviewBusy}>{reviewBusy ? 'Saving review…' : 'Save review'}</button><small>Reviews never enable provider capabilities.</small>
              </form>
              <h3>Recent reviews</h3>{detail.reviews.length ? <ul>{detail.reviews.map(review => <li key={review.id}><strong>{review.action.replaceAll('_', ' ')}</strong><p>{review.note}</p><small>{new Date(review.createdAt).toLocaleString()}</small></li>)}</ul> : <p>No reviews yet.</p>}
            </>}
          </>}
        </section>
      </div>
    </>}
  </div>;
}
