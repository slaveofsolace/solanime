import Disclosure from '../components/Disclosure';
import Icon from '../components/Icon';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { safeReturnTo, withReturnTo } from '../account/returnTo';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import type { SessionResponse } from '../account/types';
import RecoveryCard from '../account/RecoveryCard';
import Avatar from '../account/Avatar';
import SettingsFrame, { SettingsBack } from '../components/SettingsFrame';
type Device = { id: string; current: boolean; createdAt: number; lastSeen: number; device: string };
export default function AccountPage({ recovery = false }: { recovery?: boolean }) {
  const auth = useAccount(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const [devices, setDevices] = useState<Device[]>([]),
    [password, setPassword] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [next, setNext] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [action, setAction] = useState<'password' | 'delete' | 'recovery' | null>(null),
    [deleteChecked, setDeleteChecked] = useState(false),
    [freshCode, setFreshCode] = useState<{ accountId: string; code: string } | null>(null);
  const accountId = auth.account?.id;
  const currentAccountId = useRef(accountId);
  currentAccountId.current = accountId;
  const feedbackRef = useRef<HTMLParagraphElement | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<'account' | 'security'>('account');
  useEffect(() => {
    if (!error && !message) return;
    // Feedback must be visible after a submission near the bottom of the page.
    // Keep security errors beside the form; other actions use the page notice.
    if (error) feedbackRef.current?.focus({ preventScroll: true });
    feedbackRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error, message]);
  const actionGeneration = useRef(0);
  const actionPending = useRef(false);
  useEffect(() => {
    actionGeneration.current++;
    actionPending.current = false;
    setBusy(false);
    setPassword('');
    setShowPassword(false);
    setNext('');
    setConfirm('');
    setAction(null);
    setDeleteChecked(false);
    setFreshCode(null);
    setError(null);
    setMessage('');
    return () => { actionGeneration.current++; actionPending.current = false; };
  }, [accountId]);
  const deviceRequest = useRef<AbortController | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState(false);
  const refreshDevices = useCallback(() => {
    deviceRequest.current?.abort();
    if (!accountId) {
      deviceRequest.current = null;
      setDevices([]);
      setDevicesLoading(false);
      setDevicesError(false);
      return;
    }
    const controller = new AbortController();
    deviceRequest.current = controller;
    setDevicesLoading(true);
    setDevicesError(false);
    void accountRequest<{ items: Device[] }>('sessions', undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setDevices(result.items); })
      .catch(() => { if (!controller.signal.aborted) { setDevices([]); setDevicesError(true); } })
      .finally(() => { if (!controller.signal.aborted) setDevicesLoading(false); });
  }, [accountId]);
  useEffect(() => {
    setDevices([]);
    refreshDevices();
    return () => deviceRequest.current?.abort();
  }, [refreshDevices]);
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
  if (freshCode && freshCode.accountId === accountId)
    return <RecoveryCard code={freshCode.code} doneLabel="Return to account" replacement onDone={() => setFreshCode(null)} />;
  if (!auth.account)
    return (
      <section className="account-empty">
        <h1>Your account</h1>
        <p>Sign in to manage your account.</p>
        <Link className="button button--primary" to="/login">
          Sign in
        </Link>
      </section>
    );
  const perform = async (task: (isCurrent: () => boolean) => Promise<void>, target: 'account' | 'security' = 'account') => {
    if (actionPending.current) return;
    actionPending.current = true;
    const generation = ++actionGeneration.current;
    const isCurrent = () => generation === actionGeneration.current && currentAccountId.current === accountId;
    setBusy(true);
    setError(null);
    setMessage('');
    setFeedbackTarget(target);
    try {
      await task(isCurrent);
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : 'This action could not be completed.');
    } finally {
      if (isCurrent()) { actionPending.current = false; setBusy(false); }
    }
  };
  const submit = () =>
    perform(async isCurrent => {
      if (action === 'password' && next !== confirm) throw Error('Passwords do not match.');
      if (action === 'delete') {
        if (!deleteChecked) throw Error('Confirm account deletion first.');
        await accountRequest('delete', { currentPassword: password });
        if (!isCurrent()) return;
        auth.clearProfile();
        await auth.refresh();
        navigate('/login', { replace: true });
      } else if (action === 'recovery') {
        const result = await accountRequest<{ recoveryCode: string }>('recovery-code', {
          currentPassword: password,
        });
        if (!isCurrent()) return;
        setFreshCode({ accountId: accountId!, code: result.recoveryCode });
      } else {
        const result = await accountRequest<SessionResponse>('password', {
          currentPassword: password,
          password: next,
        });
        if (!isCurrent()) {
          // Password changes rotate the session. Re-read the cookie-backed session
          // if this page closed, rather than accepting an obsolete response.
          void auth.refresh();
          return;
        }
        auth.accept(result);
        setMessage('Password updated. Other sessions were signed out.');
        refreshDevices();
      }
      setPassword('');
      setNext('');
      setConfirm('');
    }, 'security');
  const feedback = error ? <p ref={feedbackRef} className="form-error" role="alert" tabIndex={-1}>{error}</p>
    : message ? <p ref={feedbackRef} className="inline-notice" role="status">{message}</p> : null;
  const securityForm = action && (
    <form
      id="account-security-form"
      className="account-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="current-password">Current password</label>
      <div className="password-input">
      <input
        id="current-password"
        name="currentPassword"
        type={showPassword ? 'text' : 'password'}
        autoComplete="current-password"
        required
        disabled={busy}
        value={password}
        maxLength={128}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="button" disabled={busy}
        aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
        onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
      </div>
      {action === 'password' && (
        <>
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="newPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            disabled={busy}
            minLength={15}
            maxLength={128}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <label htmlFor="repeat-password">Confirm new password</label>
          <input
            id="repeat-password"
            name="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            disabled={busy}
            value={confirm}
            maxLength={128}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </>
      )}
      {action === 'recovery' && (
        <p className="field-hint">
          Your old code will stop working. Password resets use this code; Solanime doesn’t send reset emails.
        </p>
      )}
      {action === 'delete' && (
        <label className="check-label">
          <input
            type="checkbox"
            required
            disabled={busy}
            checked={deleteChecked}
            onChange={(e) => setDeleteChecked(e.target.checked)}
          />
          Permanently delete my account, all profiles, and saved data.
        </label>
      )}
      {feedbackTarget === 'security' && feedback}
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
  );
  return (
    <SettingsFrame active={['#security', '#devices', '#privacy'].includes(hash) ? hash.slice(1) : 'account'}>
    <section className="account-page">
      <SettingsBack />
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
      {(feedbackTarget === 'account' || !action) && feedback}
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
          <section id="security" className="account-section">
            <h2>Security</h2>
            <div className="security-tabs disclosure-group" role="group" aria-label="Security action">
              {(['password', 'recovery', 'delete'] as const).map(value => (
                <Disclosure key={value}
                  title={value === 'password' ? 'Change password' : value === 'recovery' ? 'Recovery code' : 'Delete account'}
                  expanded={action === value} disabled={busy}
                  onToggle={() => {
                    setAction(action === value ? null : value);
                    setPassword('');
                    setShowPassword(false);
                    setNext('');
                    setConfirm('');
                    setDeleteChecked(false);
                    setError(null);
                    setMessage('');
                  }}>
                  {action === value && securityForm}
                </Disclosure>
              ))}
            </div>

          </section>
          <details id="devices" className="account-section account-disclosure disclosure">
            <summary className="disclosure-trigger"><span>Active sessions</span><Icon name="right" /></summary>
            <div className="disclosure-content">
              <div className="section-heading account-disclosure-content">
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void perform(async isCurrent => {
                      await accountRequest('revoke-other-sessions', {});
                      if (!isCurrent()) return;
                      setMessage('Other sessions signed out.');
                      refreshDevices();
                    })
                  }
                >
                  Sign out other devices
                </button>
              </div>
              {devicesLoading && <p role="status">Loading signed-in devices…</p>}
              {devicesError && <div className="account-session-error" role="status">
                <p>Signed-in devices could not be loaded.</p>
                <button type="button" className="text-button" onClick={refreshDevices}>Retry devices</button>
              </div>}
              {!devicesLoading && !devicesError && devices.length === 0 && <p>No session details are available.</p>}
              <ul className="device-list" aria-busy={devicesLoading}>
                {devices.map((d) => (
                  <li key={d.id}>
                    <strong>{d.current ? 'This browser' : 'Another browser'}</strong>
                    <p title={d.device}>{d.device}</p>
                    <small>Last active {new Date(d.lastSeen).toLocaleDateString()}</small>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
        <aside>
          <section className="account-section">
            <h2>Viewing preferences</h2>
            <p><Link to="/settings?section=playback">Playback &amp; language</Link> · <Link to="/settings?section=appearance">Appearance</Link></p>
          </section>
          <details id="privacy" className="account-section account-disclosure disclosure">
            <summary className="disclosure-trigger"><span>Your data</span><Icon name="right" /></summary>
            <div className="disclosure-content">
              <p>
                Download your account details, profiles, lists, and history. Passwords and session
                tokens are excluded.
              </p>
              <button
                type="button"
                className="button button--outline"
                disabled={busy}
                onClick={() =>
                  void perform(async isCurrent => {
                    const result = await accountRequest('export');
                    if (!isCurrent()) return;
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
            </div>
          </details>
        </aside>
      </div>
    </section>
    </SettingsFrame>
  );
}
