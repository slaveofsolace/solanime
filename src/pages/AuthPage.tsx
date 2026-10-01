import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { safeReturnTo, withReturnTo } from '../account/returnTo';
import { useAccount } from '../account/AccountProvider';
import { accountRequest } from '../account/api';
import RecoveryCard from '../account/RecoveryCard';
export default function AuthPage({ mode = 'login' }: { mode?: 'login' | 'register' | 'recover' }) {
  const account = useAccount(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const destination = safeReturnTo(params.get('returnTo'));
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [code, setCode] = useState(''),
    [show, setShow] = useState(false),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [replacement, setReplacement] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null),
    [pendingSaved, setPendingSaved] = useState(false);
  const register = mode === 'register',
    recover = mode === 'recover';
  const registerAction = account.approvalRequired ? 'Request access' : 'Create account';
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
        const result = await account.login(submittedEmail, submittedPassword, remember, register);
        if (result?.pendingApproval) {
          setPendingCode(result.recoveryCode ?? null);
          setPendingSaved(!result.recoveryCode);
        } else {
          navigate(withReturnTo(register ? '/account/recovery-code' : '/profiles', destination), { replace: true });
        }
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
        doneLabel="Back to sign in"
        onDone={() => {
          navigate(withReturnTo('/login', destination), { replace: true });
        }}
        replacement
      />
    );
  if (pendingCode && !pendingSaved)
    return (
      <RecoveryCard
        code={pendingCode}
        doneLabel="Finish request"
        onDone={() => setPendingSaved(true)}
        pendingApproval
      />
    );
  if (pendingSaved)
    return (
      <section className="auth-result" role="status">
        <h1>Waiting for approval</h1>
        <p>Your request is recorded. The Solanime owner must approve your account before you can sign in or browse.</p>
        <Link className="button button--primary" to={withReturnTo('/login', destination)}>
          Back to sign in
        </Link>
      </section>
    );
  return (
    <section className={`auth-page auth-page--${mode}`}>
      <div className="auth-copy">
        <div className="auth-brand" aria-hidden="true">
          <img src="/branding/solanime-icon-512.png" alt="" />
          <span>Solanime</span>
        </div>
        <h1>
          {recover ? 'Recover your account' : register ? registerAction : 'Sign in to Solanime'}
        </h1>
        <p>
          {recover
            ? 'Use your saved code to set a new password.'
            : register
              ? 'Save titles and watch progress across devices.'
              : 'Access your profiles, list, and watch history.'}
        </p>
      </div>
      <div className="auth-panel">
        <h2>{recover ? 'Recover account' : register ? registerAction : 'Sign in'}</h2>
        {register && account.approvalRequired && (
          <p className="auth-approval-note">Your account must be approved before you can sign in.</p>
        )}
        {account.account && !recover ? (
          <>
            <p>
              You are signed in as <strong>{account.account.email}</strong>.
            </p>
            <Link className="button button--primary" to={withReturnTo('/profiles', destination)}>
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
            {!recover && !register && (
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
                    ? registerAction
                    : 'Sign in'}
            </button>
            {register && !account.registrationOpen && (
              <p className="field-hint">Registration is closed on this deployment.</p>
            )}
            {register && (
              <p className="field-hint">
                Save the recovery code shown next. You’ll need it if you forget your password.
              </p>
            )}
          </form>
        )}
        <div className="auth-links">
          {mode === 'login' ? (
            <>
              {account.recoveryMethod !== 'unavailable' && <Link to={withReturnTo('/recover', destination)}>Forgot your password?</Link>}
              <p>
                New here? <Link to={withReturnTo('/register', destination)}>{registerAction}</Link>
              </p>
            </>
          ) : (
            <Link to={withReturnTo('/login', destination)}>Back to sign in</Link>
          )}
        </div>
      </div>
    </section>
  );
}
