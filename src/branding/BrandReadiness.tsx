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
}

/** Readiness owns the transition; the brand never delays an available page. */
export function BrandReadiness({ ready, error, onRetry, onDismiss, reducedMotion = false,
  theme = 'dark', sessionKey = 'solanime-boot', timeoutMs = 12000, inline = false,
}: BrandReadinessProps) {
  const [dismissed, setDismissed] = useState(() => getBrandSession(sessionKey).resolved || (ready && !error));
  const [timedOut, setTimedOut] = useState(false);
  const dismissedRef = useRef(dismissed);
  const notifiedRef = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!dismissed || notifiedRef.current) return;
    getBrandSession(sessionKey).resolved = true;
    notifiedRef.current = true;
    onDismiss?.();
  }, [dismissed, sessionKey, onDismiss]);
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
  };
  const failure = error || (!ready && timedOut ? 'This is taking longer than expected.' : null);
  const canExit = ready && !failure;
  if (dismissed) return null;
  return <section className={`sol-brand-readiness${inline ? ' sol-brand-readiness--inline' : ''}`} data-theme={theme} data-readiness={failure ? 'error' : canExit ? 'ready' : 'loading'} aria-busy={!canExit && !failure} aria-label="Solanime readiness">
    <SolanimeBrand variant="full" motion={failure ? 'error' : canExit ? 'ready' : 'intro'} sessionKey={sessionKey} reducedMotion={reducedMotion} theme={theme} onExitComplete={dismiss} decorative />
    <div className="sol-brand-readiness__status" role={failure ? 'alert' : 'status'} aria-live="polite">
      {failure ? <><p>{failure}</p><div className="sol-brand-readiness__actions">
        {onRetry && <button type="button" onClick={() => { setTimedOut(false); setAttempt(value => value + 1); onRetry(); }}>Try again</button>}
        <button type="button" onClick={dismiss}>{onRetry ? 'View page status' : 'Continue'}</button>
      </div></> : !ready ? <p>Loading<span aria-hidden="true">…</span></p> : null}
    </div>
  </section>;
}
