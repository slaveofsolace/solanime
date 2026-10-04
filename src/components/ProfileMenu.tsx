import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import Avatar from '../account/Avatar';
import Dialog, { markDialogTrigger } from './Dialog';
import Icon from './Icon';

export default function ProfileMenu() {
  const account = useAccount();
  const location = useLocation();
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [anchor, setAnchor] = useState({ top: 72, right: 16 });
  const profile = account.profile ?? { name: 'Choose profile', avatar: 'violet' as const };
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => { setOpen(false); setError(''); }, [location.pathname, location.search, location.hash, account.profile?.id]);
  useEffect(() => {
    if (!open) return;
    const position = () => {
      const box = trigger.current?.getBoundingClientRect();
      if (box) setAnchor({ top: Math.min(box.bottom + 8, Math.max(16, innerHeight - 200)), right: Math.max(16, innerWidth - box.right) });
    };
    position();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [open]);
  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);

  const close = () => { if (!busy) { setOpen(false); setError(''); } };
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (busy) event.preventDefault();
    else close();
  };
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // The account controller flushes profile changes and preserves the session
      // when saving or sign-out fails. Never discard pending work here.
      await account.logout();
      setOpen(false);
      navigate('/login', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign out. Please try again.');
    } finally { setBusy(false); }
  }

  if (!account.account) return null;
  return <div className="profile-menu" style={{ '--profile-menu-top': `${anchor.top}px`, '--profile-menu-right': `${anchor.right}px` } as CSSProperties}>
    <button ref={trigger} type="button" className="profile-menu-trigger" aria-label="Open profile menu"
      aria-haspopup="dialog" aria-expanded={open} onClick={event => {
        markDialogTrigger(event.currentTarget); setError(''); setOpen(true);
      }}>
      <Avatar profile={profile} small />
    </button>
    {open && <Dialog title="Profile" className="profile-menu-panel" onClose={close}>
      <div className="profile-menu-summary">
        <Avatar profile={profile} />
        <div><strong>{profile.name}</strong>
          <Link to="/profiles?manage=1" aria-disabled={busy || undefined} onClick={follow}>Manage profiles</Link>
        </div>
      </div>
      <nav className="profile-menu-links" aria-label="Profile shortcuts" aria-busy={busy}>
        <Link to={`/profiles?returnTo=${encodeURIComponent(returnTo)}`} aria-disabled={busy || undefined} onClick={follow}><Icon name="person" />Switch profile</Link>
        <Link to="/settings" aria-disabled={busy || undefined} onClick={follow}><Icon name="settings" />Settings</Link>
        <Link to="/library" aria-disabled={busy || undefined} onClick={follow}><Icon name="bookmark" />My List</Link>
        <Link to="/library#history-title" aria-disabled={busy || undefined} onClick={follow}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-5v6l4 2" /></svg>History
        </Link>
        <button type="button" disabled={busy} onClick={() => void signOut()}><Icon name="arrow" />{busy ? 'Signing out…' : 'Sign out'}</button>
      </nav>
      {error && <div className="profile-menu-feedback">
        <p ref={feedback} role="alert" tabIndex={-1}>{error}</p>
        {account.syncError && <Link to="/account" onClick={follow}>Review unsaved changes</Link>}
      </div>}
    </Dialog>}
  </div>;
}
