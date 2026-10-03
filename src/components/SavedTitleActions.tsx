import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import type { TitleSummary } from '../types';
import Dialog, { markDialogTrigger } from './Dialog';
import Icon from './Icon';

/** A saved series is not an episode: never mark an entire series watched here. */
export default function SavedTitleActions({ title, opening, onPlay }: {
  title: TitleSummary; opening: boolean; onPlay: () => void;
}) {
  const { profile } = useAccount();
  const { watchlist } = useAppState();
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
  }, [profile?.id, title.id]);
  const name = title.name ?? title.title ?? 'Untitled';
  const path = `/title/${encodeURIComponent(title.slug)}`;
  async function share() {
    if (sharing) return;
    const request = ++shareRequest.current;
    const isCurrent = () => request === shareRequest.current;
    setSharing(true);
    setNotice('');
    try {
      const url = new URL(path, window.location.origin).href;
      if (navigator.share) await navigator.share({ title: name, url });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        if (isCurrent()) setNotice('Title link copied.');
      } else if (isCurrent()) setNotice('Open Series info to copy the title address from your browser.');
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) setNotice('The link could not be shared. Try again.');
    } finally {
      if (isCurrent()) setSharing(false);
    }
  }
  return <>
    <button type="button" className="history-actions-trigger saved-title-actions" aria-haspopup="dialog"
      aria-label={`More options for ${name}`} aria-expanded={open}
      onClick={event => { event.stopPropagation(); markDialogTrigger(event.currentTarget); setNotice(''); setOpen(true); }}>
      <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
      </svg>
    </button>
    {open && <Dialog title={name} onClose={dismiss} className="history-actions-sheet">
      <div className="history-actions-list">
        <button type="button" disabled={opening} aria-busy={opening} onClick={onPlay}><Icon name="play"/>{opening ? 'Opening…' : 'Start or continue'}</button>
        <Link to={path} onClick={dismiss}><Icon name="info"/>Series info</Link>
        <button type="button" disabled={sharing} aria-busy={sharing} onClick={() => void share()}><Icon name="arrow"/>Share title</button>
        <button type="button" className="history-actions-dismiss" onClick={() => {
          dismiss(); if (watchlist.has(title.id)) watchlist.toggle(title.id, title);
        }}><Icon name="close"/>Remove from My List</button>
      </div>
      {notice && <p className="history-actions-notice" role="status">{notice}</p>}
    </Dialog>}
  </>;
}
