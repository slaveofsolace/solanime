import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { safeReturnTo, withReturnTo } from '../account/returnTo';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import type { SessionResponse } from '../account/types';
import RecoveryCard from '../account/RecoveryCard';
import Avatar from '../account/Avatar';
type Device = { id: string; current: boolean; createdAt: number; lastSeen: number; device: string };
export default function AccountPage({ recovery = false }: { recovery?: boolean }) {
  const auth = useAccount(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const [devices, setDevices] = useState<Device[]>([]),
    [password, setPassword] = useState(''),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [action, setAction] = useState<'password' | 'delete' | 'recovery'>('password'),
    [deleteChecked, setDeleteChecked] = useState(false),
    [freshCode, setFreshCode] = useState<string | null>(null);
  const refreshDevices = () =>
    void accountRequest<{ items: Device[] }>('sessions')
      .then((r) => setDevices(r.items))
      .catch(() => {});
  useEffect(() => {
    if (auth.account) refreshDevices();
  }, [auth.account?.id]);
  if (recovery && auth.recoveryCode)
    return (
      <RecoveryCard
        code={auth.recoveryCode}
        doneLabel="Choose a profile"
        onDone={() => {
          auth.setRecoveryCode(null);
          navigate(withReturnTo('/profiles', safeReturnTo(params.get('returnTo'))), { replace: true });
        }}
      />
    );
  if (freshCode)
    return <RecoveryCard code={freshCode} doneLabel="Return to account" replacement onDone={() => setFreshCode(null)} />;
  if (!auth.account)
    return (
      <section className="account-empty">
        <h1>Your account</h1>
        <p>Sign in to keep your profiles and lists together.</p>
        <Link className="button button--primary" to="/login">
          Sign in
        </Link>
      </section>
    );
  const perform = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action could not be completed.');
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    perform(async () => {
      if (action === 'password' && next !== confirm) throw Error('Passwords do not match.');
      if (action === 'delete') {
        if (!deleteChecked) throw Error('Confirm account deletion first.');
        await accountRequest('delete', { currentPassword: password });
        auth.clearProfile();
        await auth.refresh();
        navigate('/login', { replace: true });
      } else if (action === 'recovery') {
        const result = await accountRequest<{ recoveryCode: string }>('recovery-code', {
          currentPassword: password,
        });
        setFreshCode(result.recoveryCode);
      } else {
        const result = await accountRequest<SessionResponse>('password', {
          currentPassword: password,
          password: next,
        });
        auth.accept(result);
        setMessage('Password updated. Other sessions were signed out.');
        refreshDevices();
      }
      setPassword('');
      setNext('');
      setConfirm('');
    });
  return (
    <section className="account-page">
      <header className="account-heading">
        <div>
          <h1>Account</h1>
          <p>{auth.account.email}</p>
        </div>
        <button
          className="button button--outline"
          type="button"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await auth.logout();
              navigate('/login', { replace: true });
            })
          }
        >
          Sign out
        </button>
      </header>
      {auth.syncError && (
        <div className="form-error" role="alert">
          <p>Some profile changes could not be saved: {auth.syncError}</p>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await auth.logout(true);
                navigate('/login', { replace: true });
              })
            }
          >
            Discard unsaved changes and sign out
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="inline-notice" role="status">
          {message}
        </p>
      )}
      <div className="account-columns">
        <div>
          <section className="account-section">
            <div className="section-heading">
              <h2>Your profiles</h2>
              <Link to="/profiles">Manage</Link>
            </div>
            <div className="account-profile-list">
              {auth.profiles.map((p) => (
                <Link to="/profiles" key={p.id}>
                  <Avatar profile={p} small />
                  <span>
                    {p.name}
                    {auth.profile?.id === p.id && <small>Current profile</small>}
                  </span>
                </Link>
              ))}
            </div>
            <p className="field-hint">{auth.profiles.length} of 5 profiles</p>
          </section>
          <section className="account-section">
            <h2>Security</h2>
            <div className="security-tabs" role="group" aria-label="Security action">
              {(['password', 'recovery', 'delete'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={action === value}
                  onClick={() => {
                    setAction(value);
                    setPassword('');
                    setError(null);
                  }}
                >
                  {value === 'password'
                    ? 'Password'
                    : value === 'recovery'
                      ? 'Recovery code'
                      : 'Delete account'}
                </button>
              ))}
            </div>
            <form
              className="account-form"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <label htmlFor="current-password">Current password</label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                maxLength={128}
                onChange={(e) => setPassword(e.target.value)}
              />
              {action === 'password' && (
                <>
                  <label htmlFor="new-password">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={15}
                    maxLength={128}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                  <label htmlFor="repeat-password">Confirm new password</label>
                  <input
                    id="repeat-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    maxLength={128}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </>
              )}
              {action === 'recovery' && (
                <p className="field-hint">
                  Generate a new recovery code. Your old code will stop working.
                </p>
              )}
              {action === 'delete' && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    required
                    checked={deleteChecked}
                    onChange={(e) => setDeleteChecked(e.target.checked)}
                  />
                  Permanently delete my account, all profiles, and saved data.
                </label>
              )}
              <button className="button button--primary" disabled={busy}>
                {busy
                  ? 'Working…'
                  : action === 'password'
                    ? 'Update password'
                    : action === 'recovery'
                      ? 'Generate recovery code'
                      : 'Delete my account'}
              </button>
            </form>
          </section>
          <details className="account-section account-disclosure">
            <summary>
              <span>Active sessions</span>
              <small>Review devices signed in to your account</small>
            </summary>
            <div className="section-heading account-disclosure-content">
              <p>Keep only the sessions you recognize.</p>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await accountRequest('revoke-other-sessions', {});
                    setMessage('Other sessions signed out.');
                    refreshDevices();
                  })
                }
              >
                Sign out other devices
              </button>
            </div>
            <ul className="device-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <strong>{d.current ? 'This browser' : 'Another browser'}</strong>
                  <p title={d.device}>{d.device}</p>
                  <small>Last active {new Date(d.lastSeen).toLocaleDateString()}</small>
                </li>
              ))}
            </ul>
          </details>
        </div>
        <aside>
          <section className="account-section">
            <h2>Viewing preferences</h2>
            <p><Link to="/settings">Open Settings</Link> to change playback, language, and appearance for your profile.</p>
          </section>
          <details className="account-section account-disclosure">
            <summary>
              <span>Your data</span>
              <small>Download a copy of your account information</small>
            </summary>
            <p>
              Export your account details, profiles, saved lists, and history. Passwords and session
              secrets are excluded.
            </p>
            <button
              type="button"
              className="button button--outline"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await accountRequest('export');
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'solanime-account.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Export my data
            </button>
            <p className="field-hint">
              Email is your sign-in identifier. This version uses private recovery codes, not email
              verification or reset emails.
            </p>
          </details>
        </aside>
      </div>
    </section>
  );
}
