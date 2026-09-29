import Icon from '../components/Icon';
import EpisodeBrowser from '../components/EpisodeBrowser';
import { SpotlightArtwork } from '../components/FeatureSpotlight';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { Episode, RelatedTitle, TitleDetail, TitleSummary } from '../types';
import { CoverArt, InlineNotice, StatusPanel, TitleCard } from '../components/ui';
import { useAppState } from '../state';
import { useInitialReadiness } from '../branding/ApplicationReadiness';
import { chooseWatchEntry, watchEntryPath } from '../lib/watchEntry';

function isLinkedRelated(
  item: RelatedTitle,
): item is RelatedTitle & Pick<TitleSummary, 'id' | 'slug' | 'name'> {
  return Boolean(item.id && item.slug && item.name);
}

function initialLanguage(episodes: Episode[], preferredLanguage: string): string {
  const languages = Array.from(
    new Set(episodes.flatMap((episode) => episode.versions.map((version) => version.language))),
  );
  const playableLanguages = languages.filter((candidate) =>
    episodes.some((episode) =>
      episode.versions.some(
        (version) =>
          version.language === candidate &&
          version.providerCount > 0 &&
          version.availability === 'available',
      ),
    ),
  );
  const mappedLanguages = languages.filter((candidate) =>
    episodes.some((episode) =>
      episode.versions.some(
        (version) => version.language === candidate && version.providerCount > 0,
      ),
    ),
  );
  if (playableLanguages.includes(preferredLanguage)) return preferredLanguage;
  if (playableLanguages.length > 0) return playableLanguages[0];
  if (mappedLanguages.includes(preferredLanguage)) return preferredLanguage;
  if (mappedLanguages.length > 0) return mappedLanguages[0];
  return languages.includes(preferredLanguage) ? preferredLanguage : (languages[0] ?? '');
}

function publicAttributionUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function languageLabel(value: string) {
  if (value.toLocaleLowerCase() === 'sub') return 'Subtitled';
  if (value.toLocaleLowerCase() === 'dub') return 'Dubbed';
  return value;
}

export default function TitlePage() {
  const { slug = '' } = useParams();
  return <TitleSession key={slug} />;
}

function TitleSession() {
  const { slug = '' } = useParams();
  const { watchlist, history, preferences } = useAppState();
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
  const [retry, setRetry] = useState(0);
  useInitialReadiness(!loading && !error, error, () => setRetry(value => value + 1));

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
          collectionState: result.collectionState ?? result.title.collectionState,
          aliases: result.aliases ?? result.title.aliases ?? [],
          genres: result.genres ?? result.title.genres ?? [],
          related: result.related ?? result.title.related ?? [],
          episodes: result.episodes ?? result.title.episodes ?? [],
        };
        setTitle(merged);
        setEpisodes(merged.episodes ?? []);
        setAliases(merged.aliases ?? []);
        setRelated(merged.related ?? []);
        setLanguage(initialLanguage(merged.episodes ?? [], preference.preferredLanguage));
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(cause));
        setLoading(false);
      });
    return () => controller.abort();
  }, [slug, preference.preferredLanguage, retry]);

  const languages = useMemo(
    () =>
      Array.from(
        new Set(episodes.flatMap((episode) => episode.versions.map((version) => version.language))),
      ),
    [episodes],
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
          <div className="button-row">
            <button className="button button--primary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button>
            <Link className="button button--outline" to="/catalogue">Return to catalogue</Link>
          </div>
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
  const primaryEntry = chooseWatchEntry(title.id, episodes, history.entries, language);
  const episodeInventoryPending =
    episodes.length === 0 && title.collectionState !== 'complete';
  const synopsis = (title.synopsis ?? title.description)?.replace(/\s*\[more\]\s*$/i, '');

  return (
    <div className={`title-page series-page${title.backdropUrl ? ' series-page--backdrop' : ' series-page--poster'}`}>
      <section className="title-hero" aria-labelledby="title-name">
        <SpotlightArtwork title={{ ...title, name }} className="title-hero__art" />
        <div className="title-hero__content">
          <div className="title-hero__name-block">
            <div className="title-hero__mobile-art" aria-hidden="true">
              <CoverArt title={{ ...title, name }} eager />
            </div>
            <p className="feature-meta">
              {[title.type ?? title.format, title.releaseYear ?? title.year]
                .filter((value) => value !== null && value !== undefined && value !== '')
                .join(' · ')}
            </p>
            <h1 id="title-name">{name}</h1>
            {title.englishTitle && title.englishTitle !== name && (
              <p className="title-hero__alternate">{title.englishTitle}</p>
            )}
          </div>
          <div className="title-hero__actions">
            {primaryEntry ? (
              <Link
                className="button button--primary"
                to={watchEntryPath(slug, primaryEntry)}
                aria-label={`${primaryEntry.label}: ${primaryEntry.episode.title || primaryEntry.episode.label || `Episode ${primaryEntry.episode.number ?? 1}`}`}
              >
                {primaryEntry.label} <Icon name="play" />
              </Link>
            ) : null}
            <button
              className="button button--outline"
              type="button"
              aria-pressed={saved}
              onClick={() => watchlist.toggle(title.id, { ...title, name })}
            >
              <Icon name={saved ? 'check' : 'bookmark'} />
              {saved ? 'In My List' : 'My List'}
            </button>
          </div>
          <div className="title-hero__details">
            <dl className="title-facts">
              <div>
                <dt>Status</dt>
                <dd>{title.status ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt>Episodes</dt>
                <dd>{episodes.length || (episodeInventoryPending ? 'Import pending' : 'None')}</dd>
              </div>
            </dl>
            {synopsis && <p className="title-hero__synopsis">{synopsis}</p>}
            {genres.length > 0 && <div className="tag-list" aria-label="Genres">
              {genres.map((genre) => <span key={genre}>{genre}</span>)}
            </div>}
          </div>
          {title.source === 'tvmaze' && publicAttributionUrl(title.canonicalUrl) && (
            <p className="title-source-credit">
              Metadata and imagery:{' '}
              <a
                href={publicAttributionUrl(title.canonicalUrl)!}
                target="_blank"
                rel="noreferrer nofollow"
              >
                TVmaze
              </a>{' '}
              · CC BY-SA
            </p>
          )}
        </div>
      </section>

      <section className="episode-section" aria-labelledby="episodes-title">
        <header className="section-heading">
          <div>
            <h2 id="episodes-title">Episodes</h2>
          </div>
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
                {languageLabel(item)}
              </button>
            ))}
          </div>
        )}
        </header>
        {episodeInventoryPending ? (
          <InlineNotice>
            Episode inventory has not been collected for this metadata-only title yet. The record
            remains available while synchronization continues.
          </InlineNotice>
        ) : (
          <EpisodeBrowser episodes={episodes} slug={slug} language={language} title={title} compactHeading />
        )}
      </section>

      {(synopsis || aliases.length > 0) && (
        <details className="title-about">
          <summary>About this title <Icon name="right" /></summary>
          <div className="title-about__body">
            {synopsis && <p>{synopsis}</p>}
            {aliases.length > 0 && <p className="aliases">
              <strong>Also known as</strong>{' '}
              {aliases.map((alias) => alias.name ?? alias.value).filter(Boolean).join(' · ')}
            </p>}
          </div>
        </details>
      )}

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
