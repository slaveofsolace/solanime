import { useEffect, useRef } from 'react';

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: Turnstile }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<Turnstile> | null = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load.')));
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('Turnstile did not load.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Cloudflare Turnstile. Most people never see a puzzle: the widget stays hidden
 * unless Cloudflare wants an interaction. `resetKey` changes after each submit
 * because a token is valid only once.
 */
export default function HumanCheck({ siteKey, action, resetKey, onToken, onError }: {
  siteKey: string;
  action: 'register' | 'recover';
  resetKey: number;
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((turnstile) => {
      if (cancelled || !host.current) return;
      widget.current = turnstile.render(host.current, {
        sitekey: siteKey,
        action,
        appearance: 'interaction-only',
        theme: 'auto',
        callback: (token: string) => callbacks.current.onToken(token),
        'expired-callback': () => callbacks.current.onToken(null),
        'error-callback': () => {
          callbacks.current.onToken(null);
          callbacks.current.onError('The verification check could not finish. Reload the page and try again.');
        },
      });
    }).catch(() => {
      if (!cancelled) callbacks.current.onError('The verification check could not load. Check your connection and reload.');
    });
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey === 0 || !widget.current) return;
    callbacks.current.onToken(null);
    window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return <div className="human-check" ref={host} />;
}
