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

/** Readiness is authoritative. This component never imposes a minimum display duration. */
export function BrandReadiness({ ready, error, onRetry, onDismiss, reducedMotion = false,
  theme = 'dark', sessionKey = 'solanime-boot', timeoutMs = 12000, inline = false,
}: BrandReadinessProps) {
  const [dismissed, setDismissed] = useState(() => ready || getBrandSession(sessionKey).resolved);
  const [timedOut, setTimedOut] = useState(false);
  const dismissedRef = useRef(dismissed);
  const [attempt, setAttempt] = useState(0);
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
  const failure = error || (timedOut ? 'This is taking longer than expected.' : null);
  if (dismissed) return null;
  return <section className={`sol-brand-readiness${inline ? ' sol-brand-readiness--inline' : ''}`} data-theme={theme} data-readiness={ready ? 'ready' : failure ? 'error' : 'loading'} aria-busy={!ready && !failure} aria-label="Solanime readiness">
    <SolanimeBrand variant="full" motion={ready ? 'ready' : failure ? 'error' : 'intro'} sessionKey={sessionKey} reducedMotion={reducedMotion} theme={theme} onExitComplete={dismiss} decorative />
    {!ready && <div className="sol-brand-readiness__status" role={failure ? 'alert' : 'status'} aria-live="polite">
      {failure ? <><p>{failure}</p><div className="sol-brand-readiness__actions">
        {onRetry && <button type="button" onClick={() => { setTimedOut(false); setAttempt(value => value + 1); onRetry(); }}>Try again</button>}
        <button type="button" onClick={dismiss}>{onRetry ? 'Continue without waiting' : 'Continue'}</button>
      </div></> : <p>Loading Solanime<span aria-hidden="true">…</span></p>}
    </div>}
  </section>;
}
