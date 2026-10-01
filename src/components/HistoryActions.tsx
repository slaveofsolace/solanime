import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Dialog, { markDialogTrigger } from './Dialog';
import Icon from './Icon';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import type { TitleSummary, WatchHistoryEntry } from '../types';

export default function HistoryActions({ entry, title, context }: {
  entry: WatchHistoryEntry;
  title?: TitleSummary;
  context: 'continue' | 'history';
}) {
  const { profile } = useAccount();
  const { watchlist, watched, history } = useAppState();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const shareRequest = useRef(0);
  const dismiss = () => {
    shareRequest.current++;
    setOpen(false);
    setNotice('');
    setSharing(false);
  };
  useEffect(() => {
    dismiss();
    return () => { shareRequest.current++; };
  }, [profile?.id, entry.titleId, entry.episodeId, entry.language, context]);
  const watchPath = `/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`;
  const saved = watchlist.has(entry.titleId);
  const seen = watched.isWatched(entry.episodeId, entry.language);
  const summary: TitleSummary = title ?? {
    id: entry.titleId, slug: entry.slug, name: entry.title, imageUrl: entry.imageUrl,
  };
  async function share() {
    if (sharing) return;
    const request = ++shareRequest.current;
    const isCurrent = () => request === shareRequest.current;
    setSharing(true);
    setNotice('');
    const url = new URL(watchPath, window.location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: `${entry.title} — ${entry.episodeLabel}`, url });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        if (isCurrent()) setNotice('Episode link copied.');
      } else if (isCurrent()) setNotice('Sharing is unavailable in this browser. Open the episode to copy its address.');
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) setNotice('The link could not be shared. Please try again.');
    } finally {
      if (isCurrent()) setSharing(false);
    }
  }
  return <>
    <button className="history-actions-trigger" type="button" aria-label={`More options for ${entry.title} ${entry.episodeLabel}`}
      aria-haspopup="dialog" aria-expanded={open} onClick={event => {
        event.stopPropagation(); markDialogTrigger(event.currentTarget); setOpen(true);
      }}>
      <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
      </svg>
    </button>
    {open && <Dialog title={entry.title} onClose={dismiss} className="history-actions-sheet">
      <p className="history-actions-subtitle">{entry.episodeLabel} · {entry.language.toUpperCase()}</p>
      <div className="history-actions-list">
        <Link to={watchPath} onClick={dismiss}><Icon name="play"/>Continue watching</Link>
        <Link to={`/title/${encodeURIComponent(entry.slug)}`} onClick={dismiss}><Icon name="info"/>Series info</Link>
        <button type="button" onClick={() => watchlist.toggle(entry.titleId, summary)}>
          <Icon name={saved ? 'check' : 'bookmark'}/>{saved ? 'Remove from Watchlist' : 'Add to Watchlist'}
        </button>
        <button type="button" onClick={() => watched.toggle(entry.episodeId, entry.language)}>
          <Icon name="check"/>{seen ? 'Mark as unwatched' : 'Mark as watched'}
        </button>
        <button type="button" disabled={sharing} aria-busy={sharing} onClick={() => void share()}><Icon name="arrow"/>Share episode</button>
        <button className="history-actions-dismiss" type="button" onClick={() => {
          dismiss();
          if (context === 'continue') history.dismissSeries(entry.titleId);
          else history.remove(entry.episodeId, entry.language);
        }}><Icon name="close"/>{context === 'continue' ? 'Hide from Continue Watching' : 'Remove from History'}</button>
      </div>
      {notice && <p className="history-actions-notice" role="status">{notice}</p>}
    </Dialog>}
  </>;
}
