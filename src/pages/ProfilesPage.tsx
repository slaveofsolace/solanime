import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { safeReturnTo } from '../account/returnTo';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import type { Profile } from '../account/types';
import Avatar from '../account/Avatar';
import Dialog from '../components/Dialog';
const avatars: Profile['avatar'][] = ['ruby', 'ocean', 'violet', 'emerald', 'amber'];
export default function ProfilesPage() {
  const auth = useAccount(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeReturnTo(params.get('returnTo'));
  const [manage, setManage] = useState(false),
    [editor, setEditor] = useState<Profile | 'new' | null>(null),
    [name, setName] = useState(''),
    [avatar, setAvatar] = useState<Profile['avatar']>('ruby'),
    [password, setPassword] = useState(''),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  if (!auth.account)
    return (
      <section className="account-empty">
        <h1>Profiles</h1>
        <p>Sign in to manage separate lists and viewing progress.</p>
        <Link className="button button--primary" to="/login">
          Sign in
        </Link>
      </section>
    );
  const open = (p: Profile | 'new') => {
    setEditor(p);
    setName(p === 'new' ? '' : p.name);
    setAvatar(p === 'new' ? avatars[auth.profiles.length % 5] : p.avatar);
    setPassword('');
    setDeleting(false);
    setError(null);
  };
  async function save() {
    if (!editor) return;
    setBusy(true);
    setError(null);
    try {
      const result = await accountRequest<{ profiles: Profile[] }>(
        editor === 'new' ? 'profiles' : `profiles/${editor.id}`,
        { name, avatar },
      );
      await auth.updateProfiles(result);
      setEditor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!editor || editor === 'new') return;
    setBusy(true);
    setError(null);
    try {
      const result = await accountRequest<{ profiles: Profile[] }>(`profiles/${editor.id}/delete`, {
        currentPassword: password,
      });
      await auth.updateProfiles(result);
      setEditor(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete profile.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profiles-page">
      <header>
        <h1 tabIndex={-1} data-dialog-fallback-focus>
          {manage ? 'Manage profiles' : 'Who’s watching?'}
        </h1>
        <p>
          {manage
            ? 'Edit a profile or add another.'
            : 'Choose a profile to continue.'}
        </p>
      </header>
      <div className="profile-grid">
        {auth.profiles.map((p) => (
          <button
            className="profile-tile"
            key={p.id}
            onClick={() => {
              if (manage) {
                open(p);
                return;
              }
              setError(null);
              void auth
                .activate(p)
                .then(() => navigate(destination, { replace: true }))
                .catch((e) => setError(e.message));
            }}
            disabled={auth.changing}
          >
            <Avatar profile={p} />
            <strong>{p.name}</strong>
            <small>
              {manage
                ? 'Edit profile'
                : auth.profile?.id === p.id
                  ? 'Current profile'
                  : 'Open profile'}
            </small>
          </button>
        ))}
        {auth.profiles.length < 5 && (
          <button className="profile-tile profile-tile--add" onClick={() => open('new')}>
            <span aria-hidden="true">+</span>
            <strong>Add profile</strong>
            <small>{5 - auth.profiles.length} spaces available</small>
          </button>
        )}
      </div>
      {error && !editor && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="profiles-actions">
        <button
          type="button"
          className="button button--outline"
          onClick={() => setManage((v) => !v)}
        >
          {manage ? 'Done' : 'Manage profiles'}
        </button>
        <Link to="/account">Account settings</Link>
      </div>
      <p className="profiles-note">
        Profiles share one account login. They are not separate passwords or parental controls.
      </p>
      {editor && (
        <Dialog
          title={editor === 'new' ? 'Add a profile' : 'Edit profile'}
          onClose={() => {
            if (!busy) setEditor(null);
          }}
        >
          <form
            className="profile-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void (deleting ? remove() : save());
            }}
          >
            {deleting ? (
              <>
                <p>
                  Delete <strong>{editor !== 'new' ? editor.name : ''}</strong> and its saved list,
                  history, notes, and preferences? This cannot be undone.
                </p>
                <label htmlFor="delete-profile-password">Account password</label>
                <input
                  id="delete-profile-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            ) : (
              <>
                <div className="avatar-options" role="group" aria-label="Profile avatar">
                  {avatars.map((color) => (
                    <button
                      type="button"
                      aria-label={color}
                      aria-pressed={avatar === color}
                      key={color}
                      onClick={() => setAvatar(color)}
                    >
                      <Avatar profile={{ avatar: color, name }} />
                    </button>
                  ))}
                </div>
                <label htmlFor="profile-name">Profile name</label>
                <input
                  id="profile-name"
                  required
                  maxLength={32}
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="button-row">
              <button type="submit" className="button button--primary" disabled={busy}>
                {busy ? 'Saving…' : deleting ? 'Delete profile' : 'Save profile'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => (deleting ? setDeleting(false) : setEditor(null))}
              >
                Cancel
              </button>
            </div>
            {!deleting && editor !== 'new' && auth.profiles.length > 1 && (
              <button
                type="button"
                className="text-button danger-link"
                onClick={() => setDeleting(true)}
              >
                Delete profile
              </button>
            )}
          </form>
        </Dialog>
      )}
    </section>
  );
}
