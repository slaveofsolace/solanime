import Icon from '../components/Icon';
import EpisodeBrowser from '../components/EpisodeBrowser';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { Episode, RelatedTitle, TitleDetail, TitleSummary } from '../types';
import { CoverArt, InlineNotice, StatusPanel, TitleCard } from '../components/ui';
import { useAppState } from '../state';

function episodeName(episode: Episode): string {
  return (
    episode.label ??
    episode.title ??
    (episode.number !== null && episode.number !== undefined
      ? `Episode ${episode.number}`
      : 'Special')
  );
}

function isLinkedRelated(
  item: RelatedTitle,
): item is RelatedTitle & Pick<TitleSummary, 'id' | 'slug' | 'name'> {
  return Boolean(item.id && item.slug && item.name);
}

export default function TitlePage() {
  const { slug = '' } = useParams();
  return <TitleSession key={slug} />;
}

function TitleSession() {
  const { slug = '' } = useParams();
  const { watchlist, history, preferences, watched } = useAppState();
  const [preference] = preferences;
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [aliases, setAliases] = useState<
    Array<{ name?: string; value?: string; language?: string | null }>
  >([]);
  const [related, setRelated] = useState<RelatedTitle[]>([]);
  const [language, setLanguage] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .title(slug, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
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
        const languages = Array.from(
          new Set(
            (merged.episodes ?? []).flatMap((episode) =>
              episode.versions.map((version) => version.language),
            ),
          ),
        );
        setLanguage(
          languages.includes(preference.preferredLanguage)
            ? preference.preferredLanguage
            : (languages[0] ?? ''),
        );
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => controller.abort();
  }, [slug, preference.preferredLanguage]);

  const languages = useMemo(
    () =>
      Array.from(
        new Set(episodes.flatMap((episode) => episode.versions.map((version) => version.language))),
      ),
    [episodes],
  );
  const languageEpisodes = useMemo(
    () =>
      episodes.filter(
        (episode) => !language || episode.versions.some((version) => version.language === language),
      ),
    [episodes, language],
  );

  if (loading)
    return (
      <StatusPanel eyebrow="" title="Loading title…" busy>
        <p>Retrieving episodes and language versions.</p>
      </StatusPanel>
    );
  if (error || !title)
    return (
      <StatusPanel
        eyebrow=""
        title="Title unavailable"
        action={
          <Link className="button button--primary" to="/catalogue">
            Return to catalogue
          </Link>
        }
      >
        <p>{error ?? 'The title was not found in the synchronized catalogue.'}</p>
      </StatusPanel>
    );

  const name = title.name ?? title.title ?? 'Untitled record';
  const genres = (title.genres ?? []).map((genre) =>
    typeof genre === 'string' ? genre : genre.name,
  );
  const saved = watchlist.has(title.id);
  const linkedRelated = related.filter(isLinkedRelated);
  const unresolvedRelated = related.filter((item) => !isLinkedRelated(item));
  const recent = history.entries.find(
    (entry) =>
      entry.titleId === title.id &&
      entry.language === language &&
      episodes.some((item) => item.id === entry.episodeId),
  );
  const firstEpisode = languageEpisodes[0];

  return (
    <div className="title-page">
      <section className="title-hero">
        <div className="title-hero__art">
          <CoverArt title={{ ...title, name }} eager />
        </div>
        <div className="title-hero__content">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to="/catalogue">Catalogue</Link>
            <span>/</span>
            <span aria-current="page">{name}</span>
          </nav>
          <p className="eyebrow">
            {title.type ?? title.format ?? 'CATALOGUE TITLE'} ·{' '}
            {title.releaseYear ?? title.year ?? 'YEAR UNKNOWN'}
          </p>
          <h1>{name}</h1>
          {title.englishTitle && title.englishTitle !== name && (
            <p className="title-hero__alternate">{title.englishTitle}</p>
          )}
          <div className="tag-list" aria-label="Genres">
            {genres.map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
          <p className="title-hero__synopsis">
            {title.synopsis ??
              title.description ??
              'No description has been imported for this title.'}
          </p>
          <div className="title-hero__actions">
            {recent ? (
              <Link
                className="button button--primary"
                to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(recent.episodeId)}?language=${encodeURIComponent(recent.language)}`}
              >
                Continue {recent.episodeLabel} <Icon name="play" />
              </Link>
            ) : firstEpisode ? (
              <Link
                className="button button--primary"
                to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(firstEpisode.id)}?language=${encodeURIComponent(language)}`}
              >
                Open first episode <Icon name="play" />
              </Link>
            ) : null}
            <button
              className="button button--outline"
              type="button"
              aria-pressed={saved}
              onClick={() => watchlist.toggle(title.id, { ...title, name })}
            >
              {saved ? 'Remove from watchlist' : 'Add to watchlist'}
            </button>
          </div>
          <dl className="title-facts">
            <div>
              <dt>Status</dt>
              <dd>{title.status ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Episodes</dt>
              <dd>{episodes.length || 'None imported'}</dd>
            </div>
            <div>
              <dt>Versions</dt>
              <dd>{languages.join(' / ') || 'None imported'}</dd>
            </div>
          </dl>
          {aliases.length > 0 && (
            <p className="aliases">
              <strong>Also known as</strong>{' '}
              {aliases
                .map((alias) => alias.name ?? alias.value)
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
      </section>

      <section className="episode-section" aria-labelledby="episodes-title">
        <header className="section-heading">
          <div>
            <h2 id="episodes-title">Episodes</h2>
          </div>
          <p>{languageEpisodes.length} episodes</p>
        </header>
        {languages.length > 0 && (
          <div className="language-tabs" role="group" aria-label="Language version">
            {languages.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={item === language}
                onClick={() => {
                  setLanguage(item);
                }}
              >
                {item}
              </button>
            ))}
          </div>
        )}
        <EpisodeBrowser episodes={episodes} slug={slug} language={language} />
      </section>

      {related.length > 0 && (
        <section className="related-section" aria-labelledby="related-title">
          <header className="section-heading">
            <div>
              <h2 id="related-title">Related titles</h2>
            </div>
          </header>
          {linkedRelated.length > 0 && (
            <div className="title-grid title-grid--compact">
              {linkedRelated.slice(0, 6).map((item, index) => (
                <TitleCard title={item} index={index} key={item.id} />
              ))}
            </div>
          )}
          {unresolvedRelated.length > 0 && (
            <ul
              className="related-unresolved"
              aria-label="Related records not present in the local catalogue"
            >
              {unresolvedRelated.map((item) => (
                <li key={`${item.relationshipType}:${item.sourceId}`}>
                  <span>{item.relationshipType}</span>
                  <strong>{item.label ?? item.sourceId}</strong>
                  <small>Observed relation · local title unavailable</small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
