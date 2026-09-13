import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import RecoveryCard from '../account/RecoveryCard';
export default function AuthPage({ mode = 'login' }: { mode?: 'login' | 'register' | 'recover' }) {
  const account = useAccount(),
    navigate = useNavigate();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [code, setCode] = useState(''),
    [show, setShow] = useState(false),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [replacement, setReplacement] = useState<string | null>(null);
  const register = mode === 'register',
    recover = mode === 'recover';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const submitted = new FormData(event.currentTarget);
    const submittedEmail = String(submitted.get('email') ?? '').trim();
    const submittedPassword = String(submitted.get('password') ?? '');
    const submittedConfirm = String(submitted.get('confirm') ?? '');
    const submittedCode = String(submitted.get('recoveryCode') ?? '').trim();
    if ((register || recover) && submittedPassword !== submittedConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (recover) {
        const result = await accountRequest<{ recoveryCode: string }>('recover', {
          email: submittedEmail,
          password: submittedPassword,
          recoveryCode: submittedCode,
        });
        account.clearProfile();
        await account.refresh();
        setReplacement(result.recoveryCode);
      } else {
        await account.login(submittedEmail, submittedPassword, remember, register);
        navigate(register ? '/account/recovery-code' : '/profiles', { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }
  if (replacement)
    return (
      <RecoveryCard
        code={replacement}
        onDone={() => {
          navigate('/login', { replace: true });
        }}
        replacement
      />
    );
  return (
    <section className="auth-page">
      <div className="auth-copy">
        <p className="auth-wordmark">Your stories. Your space.</p>
        <h1>
          {recover ? 'Find your way back.' : register ? 'Make room for everyone.' : 'Welcome back.'}
        </h1>
        <p>
          {recover
            ? 'Use the private recovery code you saved when creating your account.'
            : register
              ? 'One login. Up to five profiles. A watchlist and a look that belong to each of you.'
              : 'Your list, your progress, your next episode.'}
        </p>
        <div className="auth-profile-motif" aria-hidden="true">
          {['ruby', 'ocean', 'violet', 'emerald', 'amber'].map((color, i) => (
            <span className={`profile-avatar profile-avatar--${color}`} key={color}>
              {i + 1}
            </span>
          ))}
        </div>
      </div>
      <div className="auth-panel">
        <h2>{recover ? 'Recover account' : register ? 'Create account' : 'Sign in'}</h2>
        {account.account && !recover ? (
          <>
            <p>
              You are signed in as <strong>{account.account.email}</strong>.
            </p>
            <Link className="button button--primary" to="/profiles">
              Choose a profile
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="account-email">Email address</label>
            <input
              id="account-email"
              name="email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            {recover && (
              <>
                <label htmlFor="recovery-code">Recovery code</label>
                <input
                  id="recovery-code"
                  name="recoveryCode"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={60}
                  disabled={busy}
                />
              </>
            )}
            <label htmlFor="account-password">{recover ? 'New password' : 'Password'}</label>
            <div className="password-input">
              <input
                id="account-password"
                name="password"
                type={show ? 'text' : 'password'}
                autoComplete={register || recover ? 'new-password' : 'current-password'}
                required
                minLength={register || recover ? 15 : 1}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                aria-describedby={register || recover ? 'password-help' : undefined}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
            {(register || recover) && (
              <>
                <p className="field-hint" id="password-help">
                  15–128 characters. A long passphrase works well.
                </p>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  id="confirm-password"
                  name="confirm"
                  type={show ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  maxLength={128}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {!recover && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Keep me signed in on this device
              </label>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button--primary auth-submit"
              disabled={busy || (register && !account.registrationOpen)}
              type="submit"
            >
              {busy
                ? 'Working…'
                : recover
                  ? 'Reset password'
                  : register
                    ? 'Create account'
                    : 'Sign in'}
            </button>
            {register && !account.registrationOpen && (
              <p className="field-hint">Registration is closed on this deployment.</p>
            )}
            {register && (
              <p className="field-hint">
                Next, save your private recovery code. Email delivery is not configured in this
                version.
              </p>
            )}
          </form>
        )}
        <div className="auth-links">
          {mode === 'login' ? (
            <>
              <Link to="/recover">Forgot your password?</Link>
              <p>
                New here? <Link to="/register">Create an account</Link>
              </p>
            </>
          ) : (
            <Link to="/login">Back to sign in</Link>
          )}
          <Link to="/catalogue">Browse without signing in</Link>
        </div>
      </div>
    </section>
  );
}
