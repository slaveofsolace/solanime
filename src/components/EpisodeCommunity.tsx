import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createEpisodeComment,
  deleteEpisodeComment,
  episodeComments,
  updateEpisodeComment,
} from '../account/api';
import { useAccount } from '../account/AccountProvider';
import Avatar from '../account/Avatar';
import { errorMessage } from '../lib/api';
import type { CommunityComment, CommunityCommentsPage } from '../types';

const PAGE_SIZE = 12;

function commentDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export default function EpisodeCommunity({ episodeId }: { episodeId: string }) {
  const { ready, account, profile } = useAccount();
  const [data, setData] = useState<CommunityCommentsPage>({
    items: [], total: 0, page: 1, pageSize: PAGE_SIZE, pages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<CommunityComment | null>(null);
  const [editBody, setEditBody] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async (page = 1, append = false, signal?: AbortSignal) => {
    const currentGeneration = generation.current;
    append ? setLoadingMore(true) : setLoading(true);
    setLoadError(null);
    try {
      const result = await episodeComments(
        episodeId,
        { profileId: profile?.id, page, pageSize: PAGE_SIZE },
        signal,
      );
      if (currentGeneration !== generation.current || signal?.aborted) return;
      setData((previous) => ({
        ...result,
        items: append ? [...previous.items, ...result.items] : result.items,
      }));
    } catch (error) {
      if (signal?.aborted || currentGeneration !== generation.current) return;
      setLoadError(errorMessage(error));
    } finally {
      if (currentGeneration === generation.current && !signal?.aborted) {
        append ? setLoadingMore(false) : setLoading(false);
      }
    }
  }, [episodeId, profile?.id]);

  useEffect(() => {
    generation.current += 1;
    setData({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, pages: 0 });
    setEditing(null);
    setMutationError(null);
    const controller = new AbortController();
    void load(1, false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function refreshAfterMutation() {
    generation.current += 1;
    await load(1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !draft.trim() || busyId) return;
    setBusyId('new');
    setMutationError(null);
    try {
      await createEpisodeComment(episodeId, profile.id, draft.trim());
      setDraft('');
      await refreshAfterMutation();
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !editing || !editBody.trim() || busyId) return;
    setBusyId(editing.id);
    setMutationError(null);
    try {
      await updateEpisodeComment(episodeId, editing.id, profile.id, editBody.trim(), editing.revision);
      setEditing(null);
      await refreshAfterMutation();
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(comment: CommunityComment) {
    if (!profile || busyId) return;
    setBusyId(comment.id);
    setMutationError(null);
    try {
      await deleteEpisodeComment(episodeId, comment.id, profile.id, comment.revision);
      setData((previous) => ({
        ...previous,
        items: previous.items.filter((item) => item.id !== comment.id),
        total: Math.max(0, previous.total - 1),
      }));
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="episode-community" aria-labelledby="episode-community-title">
      <header className="episode-community__heading">
        <div><p className="eyebrow">Episode community</p><h2 id="episode-community-title">Conversation</h2></div>
        <span aria-label={`${data.total} comments`}>{data.total}</span>
      </header>

      {ready && profile ? (
        <form className="community-composer" onSubmit={submit}>
          <Avatar profile={profile} small />
          <div>
            <label className="sr-only" htmlFor="community-comment">Comment as {profile.name}</label>
            <textarea id="community-comment" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} rows={2} placeholder={`Join the conversation as ${profile.name}`} />
            <div className="community-composer__actions">
              <small>{draft.length}/1000</small>
              <button className="button button--primary" type="submit" disabled={!draft.trim() || busyId === 'new'}>{busyId === 'new' ? 'Posting…' : 'Post comment'}</button>
            </div>
          </div>
        </form>
      ) : ready && account ? (
        <p className="community-signin">Choose a profile to join the conversation. <Link to="/profiles">Choose profile</Link></p>
      ) : ready ? (
        <p className="community-signin">Comments are public to read. <Link to="/login">Sign in</Link> to post.</p>
      ) : null}

      {mutationError && <p className="community-error" role="alert">{mutationError}</p>}
      {loading ? (
        <div className="community-loading" aria-label="Loading comments"><span /><span /><span /></div>
      ) : loadError ? (
        <div className="community-empty" role="alert"><p>{loadError}</p><button className="text-button" type="button" onClick={() => void load(1)}>Try again</button></div>
      ) : data.items.length === 0 ? (
        <p className="community-empty">No comments yet. Start the conversation for this episode.</p>
      ) : (
        <ol className="community-thread">
          {data.items.map((comment) => (
            <li key={comment.id}>
              <Avatar profile={comment.author} small />
              <article>
                <header><strong>{comment.author.name}</strong><time dateTime={comment.createdAt}>{commentDate(comment.createdAt)}</time></header>
                {editing?.id === comment.id ? (
                  <form className="community-edit" onSubmit={saveEdit}>
                    <label className="sr-only" htmlFor={`edit-comment-${comment.id}`}>Edit comment</label>
                    <textarea id={`edit-comment-${comment.id}`} value={editBody} onChange={(event) => setEditBody(event.target.value)} maxLength={1000} rows={3} autoFocus />
                    <div><button className="text-button" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button button--primary" type="submit" disabled={!editBody.trim() || busyId === comment.id}>Save</button></div>
                  </form>
                ) : (
                  <>
                    <p>{comment.body}</p>
                    {comment.ownedByViewer && (
                      <div className="community-thread__actions">
                        <button className="text-button" type="button" onClick={() => { setEditing(comment); setEditBody(comment.body); }}>Edit</button>
                        <button className="text-button text-button--danger" type="button" disabled={busyId === comment.id} onClick={() => void remove(comment)}>{busyId === comment.id ? 'Deleting…' : 'Delete'}</button>
                      </div>
                    )}
                  </>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}

      {!loading && !loadError && data.page < data.pages && (
        <button className="button button--quiet community-more" type="button" disabled={loadingMore} onClick={() => void load(data.page + 1, true)}>{loadingMore ? 'Loading…' : 'Load more comments'}</button>
      )}
    </section>
  );
}
