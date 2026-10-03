import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog from './Dialog';
import { CoverArt } from './ui';
import Icon from './Icon';
import { api, errorMessage } from '../lib/api';
import { useAppState } from '../state';
import { chooseWatchEntry, watchEntryPath } from '../lib/watchEntry';
import type { TitleSummary, TitleDetailResponse } from '../types';
export default function TitlePreview({
  title,
  onClose,
}: {
  title: TitleSummary;
  onClose: () => void;
}) {
  const { watchlist, history, watched, preferences } = useAppState();
  const [preference] = preferences;
  const [detail, setDetail] = useState<TitleDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .title(title.slug, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setDetail(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [title.slug]);
  const item = detail?.title ?? title;
  const name = item.name ?? item.title ?? 'Untitled';
  const watchEntry = detail
    ? chooseWatchEntry(item.id, detail.episodes, history.entries, preference.preferredLanguage, watched.isWatched)
    : null;
  return (
    <Dialog title={name} onClose={onClose} className="title-preview">
      <div className="title-preview__body">
        <div className="title-preview__art">
          <CoverArt title={item} eager variant="landscape" />
        </div>
        <div className="title-preview__copy">
          <h3>{name}</h3>
          <p className="preview-meta">
            {[item.type, item.releaseYear, item.status].filter(Boolean).join(' · ')}
          </p>
          {item.synopsis && <p>{item.synopsis}</p>}
          {detail && (
            <p className="preview-episodes">
              {detail.episodes.length.toLocaleString()}{' '}
              {detail.episodes.length === 1 ? 'episode' : 'episodes'}
            </p>
          )}
          {error && <p className="inline-notice">{error}</p>}
          <div className="button-row">
            <Link
              className="button button--play"
              to={watchEntry
                ? watchEntryPath(title.slug, watchEntry)
                : `/title/${encodeURIComponent(title.slug)}`}
              onClick={onClose}
            >
              <Icon name="play" />
              {watchEntry?.label ?? 'View series'}
            </Link>
            {watchEntry && (
              <Link
                className="button button--outline"
                to={`/title/${encodeURIComponent(title.slug)}#episodes-title`}
                onClick={onClose}
              >
                View episodes
              </Link>
            )}
            <button
              className="button button--outline"
              type="button"
              aria-pressed={watchlist.has(title.id)}
              onClick={() => watchlist.toggle(title.id, title)}
            >
              <Icon name={watchlist.has(title.id) ? 'check' : 'bookmark'} />
              {watchlist.has(title.id) ? 'Saved' : 'My list'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
