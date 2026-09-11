import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { Episode, RelatedTitle, TitleDetail, TitleSummary } from '../types';
import { CoverArt, InlineNotice, StatusPanel, TitleCard } from '../components/ui';
import { useAppState } from '../state';

function episodeName(episode: Episode): string {
  return episode.label ?? episode.title ?? (episode.number !== null && episode.number !== undefined
    ? `Episode ${episode.number}`
    : 'Special');
}

function isLinkedRelated(item: RelatedTitle): item is RelatedTitle & Pick<TitleSummary, 'id' | 'slug' | 'name'> {
  return Boolean(item.id && item.slug && item.name);
}

export default function TitlePage() {
  const { slug = '' } = useParams();
  const { watchlist, history, preferences, watched } = useAppState();
  const [preference] = preferences;
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [aliases, setAliases] = useState<Array<{ name?: string; value?: string; language?: string | null }>>([]);
  const [related, setRelated] = useState<RelatedTitle[]>([]);
  const [language, setLanguage] = useState('');
  const [episodeQuery, setEpisodeQuery] = useState('');
  const [episodeRange, setEpisodeRange] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.title(slug, controller.signal)
      .then((result) => {
        const merged = {
          ...result.title,
          aliases: result.aliases ?? result.title.aliases ?? [],
          genres: result.genres ?? result.title.genres ?? [],
          related: result.related ?? result.title.related ?? [],
          episodes: result.episodes ?? result.title.episodes ?? [],
        };
        setTitle(merged);
        setEpisodes(merged.episodes ?? []);
        setAliases(merged.aliases ?? []);
        setRelated(merged.related ?? []);
        const languages = Array.from(new Set((merged.episodes ?? []).flatMap((episode) => episode.versions.map((version) => version.language))));
        setLanguage(languages.includes(preference.preferredLanguage) ? preference.preferredLanguage : languages[0] ?? '');
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => controller.abort();
  }, [slug, preference.preferredLanguage]);

  const languages = useMemo(() => Array.from(new Set(episodes.flatMap((episode) => episode.versions.map((version) => version.language)))), [episodes]);
  const languageEpisodes = useMemo(() => episodes.filter((episode) => !language || episode.versions.some((version) => version.language === language)), [episodes, language]);
  const episodeRanges = useMemo(() => Array.from({ length: Math.ceil(languageEpisodes.length / 50) }, (_, index) => ({ index, start: index * 50, end: Math.min(languageEpisodes.length, (index + 1) * 50) })), [languageEpisodes.length]);
  const visibleEpisodes = useMemo(() => languageEpisodes.filter((episode, index) => {
    const hasLanguage = !language || episode.versions.some((version) => version.language === language);
    const haystack = `${episode.number ?? ''} ${episode.label ?? ''} ${episode.title ?? ''}`.toLocaleLowerCase();
    const inRange = Boolean(episodeQuery) || index >= episodeRange * 50 && index < (episodeRange + 1) * 50;
    return hasLanguage && inRange && haystack.includes(episodeQuery.toLocaleLowerCase());
  }), [languageEpisodes, language, episodeQuery, episodeRange]);

  if (loading) return <StatusPanel eyebrow="OPENING RECORD" title="Loading title…" busy><p>Retrieving episodes and language versions.</p></StatusPanel>;
  if (error || !title) return (
    <StatusPanel eyebrow="TITLE UNAVAILABLE" title="This record could not be opened." action={<Link className="button button--primary" to="/catalogue">Return to catalogue</Link>}>
      <p>{error ?? 'The title was not found in the synchronized catalogue.'}</p>
    </StatusPanel>
  );

  const name = title.name ?? title.title ?? 'Untitled record';
  const genres = (title.genres ?? []).map((genre) => typeof genre === 'string' ? genre : genre.name);
  const saved = watchlist.has(title.id);
  const linkedRelated = related.filter(isLinkedRelated);
  const unresolvedRelated = related.filter((item) => !isLinkedRelated(item));
  const recent = history.entries.find((entry) => entry.titleId === title.id && episodes.some((item) => item.id === entry.episodeId));
  const firstEpisode = languageEpisodes[0];

  return (
    <div className="title-page">
      <section className="title-hero">
        <div className="title-hero__art"><CoverArt title={{ ...title, name }} eager /></div>
        <div className="title-hero__content">
          <nav className="crumbs" aria-label="Breadcrumb"><Link to="/catalogue">Catalogue</Link><span>/</span><span aria-current="page">{name}</span></nav>
          <p className="eyebrow">{title.type ?? title.format ?? 'CATALOGUE TITLE'} · {title.releaseYear ?? title.year ?? 'YEAR UNKNOWN'}</p>
          <h1>{name}</h1>
          {title.englishTitle && title.englishTitle !== name && <p className="title-hero__alternate">{title.englishTitle}</p>}
          <div className="tag-list" aria-label="Genres">{genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
          <p className="title-hero__synopsis">{title.synopsis ?? title.description ?? 'No description has been imported for this title.'}</p>
          <div className="title-hero__actions">
            {recent ? <Link className="button button--primary" to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(recent.episodeId)}?language=${encodeURIComponent(recent.language)}`}>Continue {recent.episodeLabel} <span aria-hidden="true">▶</span></Link> : firstEpisode ? <Link className="button button--primary" to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(firstEpisode.id)}?language=${encodeURIComponent(language)}`}>Start watching <span aria-hidden="true">▶</span></Link> : null}
            <button className="button button--outline" type="button" aria-pressed={saved} onClick={() => watchlist.toggle(title.id, { ...title, name })}>{saved ? 'Remove from watchlist' : 'Add to watchlist'}</button>
          </div>
          <dl className="title-facts">
            <div><dt>Status</dt><dd>{title.status ?? 'Unknown'}</dd></div>
            <div><dt>Episodes</dt><dd>{episodes.length || 'None imported'}</dd></div>
            <div><dt>Versions</dt><dd>{languages.join(' / ') || 'None imported'}</dd></div>
          </dl>
          {aliases.length > 0 && <p className="aliases"><strong>Also known as</strong> {aliases.map((alias) => alias.name ?? alias.value).filter(Boolean).join(' · ')}</p>}
        </div>
      </section>

      <section className="episode-section" aria-labelledby="episodes-title">
        <header className="section-heading">
          <div><p className="eyebrow">EPISODE DIRECTORY</p><h2 id="episodes-title">Watch order</h2></div>
          <p>{visibleEpisodes.length} of {episodes.length} episodes</p>
        </header>
        {languages.length > 0 && (
          <div className="language-tabs" role="group" aria-label="Language version">
            {languages.map((item) => <button type="button" key={item} aria-pressed={item === language} onClick={() => { setLanguage(item); setEpisodeRange(0); }}>{item}</button>)}
          </div>
        )}
        {episodeRanges.length > 1 && !episodeQuery && <div className="episode-ranges" role="group" aria-label="Episode range">{episodeRanges.map((range) => <button type="button" key={range.index} aria-pressed={range.index === episodeRange} onClick={() => setEpisodeRange(range.index)}>{range.start + 1}–{range.end}</button>)}</div>}
        {episodes.length > 16 && (
          <label className="episode-search"><span>Find an episode</span><input type="search" value={episodeQuery} onChange={(event) => setEpisodeQuery(event.target.value)} placeholder="Number or title" /></label>
        )}
        {episodes.length === 0 ? <InlineNotice tone="warning">No episodes have been imported for this title yet. The catalogue record remains available while synchronization catches up.</InlineNotice> : visibleEpisodes.length === 0 ? <InlineNotice>No episodes match this language and search combination.</InlineNotice> : (
          <ol className="episode-grid">
            {visibleEpisodes.map((episode) => {
              const version = episode.versions.find((item) => item.language === language);
              const isWatched = watched.isWatched(episode.id, language);
              return (
                <li key={episode.id}>
                  <Link to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(episode.id)}?language=${encodeURIComponent(language)}`}><span className="episode-number">{episode.number ?? 'SP'}</span><strong>{episodeName(episode)}</strong><small>{version?.providerCount ?? 0} server{version?.providerCount === 1 ? '' : 's'} · {language}</small><span className="episode-play" aria-hidden="true">▶</span></Link>
                  <button className="watched-toggle" type="button" aria-pressed={isWatched} onClick={() => watched.toggle(episode.id, language)}>{isWatched ? '✓ Watched' : 'Mark watched'}</button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {related.length > 0 && (
        <section className="related-section" aria-labelledby="related-title">
          <header className="section-heading"><div><p className="eyebrow">RELATED RECORDS</p><h2 id="related-title">Keep the thread</h2></div></header>
          {linkedRelated.length > 0 && <div className="title-grid title-grid--compact">{linkedRelated.slice(0, 6).map((item, index) => <TitleCard title={item} index={index} key={item.id} />)}</div>}
          {unresolvedRelated.length > 0 && (
            <ul className="related-unresolved" aria-label="Related records not present in the local catalogue">
              {unresolvedRelated.map((item) => <li key={`${item.relationshipType}:${item.sourceId}`}><span>{item.relationshipType}</span><strong>{item.label ?? item.sourceId}</strong><small>Observed relation · local title unavailable</small></li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
