import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import type { TitleSummary } from '../types';
import Dialog, { markDialogTrigger } from './Dialog';
import Icon from './Icon';
import { listLabel } from '../lib/storage';

/** Suggested list names; viewers can also name their own. */
export const SUGGESTED_LISTS = ['Want to watch', 'Watching', 'Completed', 'On hold'];

/** A saved series is not an episode: never mark an entire series watched here. */
export default function SavedTitleActions({ title, opening, onPlay }: {
  title: TitleSummary; opening: boolean; onPlay: () => void;
}) {
  const { profile } = useAccount();
  const { watchlist } = useAppState();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [sharing, setSharing] = useState(false);
  const [choosingList, setChoosingList] = useState(false);
  const [newList, setNewList] = useState('');
  const shareRequest = useRef(0);
  const dismiss = () => {
    shareRequest.current++;
    setOpen(false);
    setNotice('');
    setSharing(false);
    setChoosingList(false);
    setNewList('');
  };
  useEffect(() => {
    dismiss();
    return () => { shareRequest.current++; };
  }, [profile?.id, title.id]);
  const name = title.name ?? title.title ?? 'Untitled';
  const saved = watchlist.items.find((item) => item.id === title.id);
  const current = saved?.listName ?? null;
  const listChoices = [...new Set([...SUGGESTED_LISTS, ...watchlist.lists])];
  const moveTo = (listName: string | null) => {
    watchlist.move(title.id, listName);
    dismiss();
  };
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
    {open && <Dialog title={choosingList ? 'Move to list' : name} onClose={dismiss} className="history-actions-sheet">
      {choosingList ? <div className="list-picker">
        <div className="history-actions-list" role="group" aria-label="Lists">
          <button type="button" aria-pressed={current === null} onClick={() => moveTo(null)}>
            <Icon name={current === null ? 'check' : 'bookmark'}/>My List
          </button>
          {listChoices.map((list) => <button type="button" key={list} aria-pressed={current === list} onClick={() => moveTo(list)}>
            <Icon name={current === list ? 'check' : 'bookmark'}/>{list}
          </button>)}
        </div>
        <form className="list-picker__new" onSubmit={(event) => {
          event.preventDefault();
          const label = listLabel(newList);
          if (label) moveTo(label);
        }}>
          <label htmlFor={`new-list-${title.id}`} className="sr-only">New list name</label>
          <input id={`new-list-${title.id}`} type="text" maxLength={40} placeholder="New list name" value={newList}
            onChange={(event) => setNewList(event.target.value)} />
          <button type="submit" className="button button--primary" disabled={!listLabel(newList)}>Create</button>
        </form>
      </div> : <div className="history-actions-list">
        <button type="button" disabled={opening} aria-busy={opening} onClick={onPlay}><Icon name="play"/>{opening ? 'Opening…' : 'Start or continue'}</button>
        <Link to={path} onClick={dismiss}><Icon name="info"/>Series info</Link>
        {saved && <button type="button" onClick={() => setChoosingList(true)}><Icon name="bookmark"/>Move to list<span className="history-actions-detail">{current ?? 'My List'}</span></button>}
        <button type="button" disabled={sharing} aria-busy={sharing} onClick={() => void share()}><Icon name="arrow"/>Share title</button>
        <button type="button" className="history-actions-dismiss" onClick={() => {
          dismiss(); if (watchlist.has(title.id)) watchlist.toggle(title.id, title);
        }}><Icon name="close"/>Remove from {current ?? 'My List'}</button>
      </div>}
      {notice && <p className="history-actions-notice" role="status">{notice}</p>}
    </Dialog>}
  </>;
}
