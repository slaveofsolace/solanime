import { useEffect, useRef, useState } from 'react';
import { SolanimeBrand } from './SolanimeBrand';
import { getBrandSession } from './timeline';
import './brand.css';

export interface BrandReadinessProps {
  ready: boolean;
  error?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  reducedMotion?: boolean;
  theme?: 'dark' | 'light';
  sessionKey?: string;
  timeoutMs?: number;
  inline?: boolean;
  minimumMs?: number;
}

/** The initial brand reveal has a short minimum; errors and reduced motion never wait. */
export function BrandReadiness({ ready, error, onRetry, onDismiss, reducedMotion = false,
  theme = 'dark', sessionKey = 'solanime-boot', timeoutMs = 12000, inline = false,
  minimumMs = 2400,
}: BrandReadinessProps) {
  const [dismissed, setDismissed] = useState(() => getBrandSession(sessionKey).resolved || (ready && minimumMs === 0));
  const [minimumElapsed, setMinimumElapsed] = useState(minimumMs === 0);
  const [timedOut, setTimedOut] = useState(false);
  const dismissedRef = useRef(dismissed);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const clock = getBrandSession(sessionKey);
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (reducedMotion || media?.matches || minimumMs <= 0) setMinimumElapsed(true);
    };
    update();
    clock.minimumStartedAt ??= Date.now();
    const remaining = Math.max(0, Math.min(3000, minimumMs) - (Date.now() - clock.minimumStartedAt));
    const timer = window.setTimeout(() => setMinimumElapsed(true), remaining);
    media?.addEventListener('change', update);
    return () => { window.clearTimeout(timer); media?.removeEventListener('change', update); };
  }, [minimumMs, reducedMotion, sessionKey]);
  useEffect(() => { if (ready && dismissed) getBrandSession(sessionKey).resolved = true; }, [ready, dismissed, sessionKey]);
  useEffect(() => {
    if (ready || error || dismissed) return;
    const timer = window.setTimeout(() => setTimedOut(true), Math.max(1000, Math.min(timeoutMs, 60000)));
    return () => window.clearTimeout(timer);
  }, [ready, error, dismissed, timeoutMs, attempt]);
  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    getBrandSession(sessionKey).resolved = true;
    setDismissed(true);
    onDismiss?.();
  };
  const failure = error || (!ready && timedOut ? 'This is taking longer than expected.' : null);
  const canExit = ready && minimumElapsed && !failure;
  if (dismissed) return null;
  return <section className={`sol-brand-readiness${inline ? ' sol-brand-readiness--inline' : ''}`} data-theme={theme} data-readiness={failure ? 'error' : canExit ? 'ready' : 'loading'} aria-busy={!canExit && !failure} aria-label="Solanime readiness">
    <SolanimeBrand variant="full" motion={failure ? 'error' : canExit ? 'ready' : 'intro'} sessionKey={sessionKey} reducedMotion={reducedMotion} theme={theme} onExitComplete={dismiss} decorative />
    {(!ready || failure) && <div className="sol-brand-readiness__status" role={failure ? 'alert' : 'status'} aria-live="polite">
      {failure ? <><p>{failure}</p><div className="sol-brand-readiness__actions">
        {onRetry && <button type="button" onClick={() => { setTimedOut(false); setAttempt(value => value + 1); onRetry(); }}>Try again</button>}
        <button type="button" onClick={dismiss}>{onRetry ? 'Continue without waiting' : 'Continue'}</button>
      </div></> : <p>Loading Solanime<span aria-hidden="true">…</span></p>}
    </div>}
  </section>;
}
