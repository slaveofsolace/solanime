import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import {
  PROVIDER_EMBED_ALLOW,
  PROVIDER_EMBED_ORIGIN,
  PROVIDER_EMBED_REFERRER_POLICY,
  SOLANIME_GUARD_EVENT,
  providerEmbedUrl,
  solanimeGuardActive,
  type ProviderEmbedResolution,
} from '../lib/providerEmbedPolicy';
import Icon from './Icon';
import './ProviderPlayer.css';

interface ProviderPlayerProps {
  resolution: PlaybackResolution | ProviderEmbedResolution;
  language: string;
  onProgress?: (position: number, duration: number) => void;
  onOpen?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
  onRefresh?: () => void;
  activityTimeoutMs?: number;
}

const MAX_MESSAGE_BYTES = 16 * 1024;

function providerMessage(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === 'string') {
    if (value.length > MAX_MESSAGE_BYTES) return null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function playbackMetrics(data: Record<string, unknown>) {
  const position = data.event === 'time' ? data.time : data.currentTime;
  const duration = data.duration;
  if (
    typeof position !== 'number' ||
    !Number.isFinite(position) ||
    position < 0 ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    position > duration + 2
  ) {
    return null;
  }
  return { position, duration };
}

export default function ProviderPlayer({
  resolution,
  language,
  onProgress,
  onOpen,
  onEnded,
  onError,
  onRefresh,
  activityTimeoutMs = 12_000,
}: ProviderPlayerProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const opened = useRef(false);
  const handlers = useRef({ onProgress, onOpen, onEnded, onError });
  handlers.current = { onProgress, onOpen, onEnded, onError };
  const [providerError, setProviderError] = useState<string | null>(null);
  const [activity, setActivity] = useState<'loading' | 'ready' | 'timeout'>('loading');
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [metrics, setMetrics] = useState<{ position: number; duration: number } | null>(null);
  const [reload, setReload] = useState(0);
  const [guardActive, setGuardActive] = useState(() => solanimeGuardActive());
  // Expiry controls whether a newly resolved embed may be opened. Once the
  // iframe is mounted, a parent progress update must not eject its live player
  // merely because the resolution timestamp passed during playback.
  const source = useMemo(() => providerEmbedUrl(resolution, language), [resolution, language]);
  const guardMode = guardActive ? 'extension' : 'browser';
  const reloadPlayer = () => {
    const expiresAt = resolution.expiresAt ? Date.parse(resolution.expiresAt) : NaN;
    if (onRefresh && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      onRefresh();
    } else {
      setReload((value) => value + 1);
    }
  };

  useEffect(() => {
    const update = () => setGuardActive(solanimeGuardActive());
    window.addEventListener(SOLANIME_GUARD_EVENT, update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-solanime-guard'] });
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener(SOLANIME_GUARD_EVENT, update);
    };
  }, []);

  useEffect(() => {
    const frame = iframe.current;
    if (!frame || !source) return;
    opened.current = false;
    setActivity('loading');
    setFrameLoaded(false);
    setMetrics(null);
    setProviderError(null);
    let previousPosition: number | null = null;
    let failed = false;
    const timeout = window.setTimeout(() => {
      // Silence does not mean failure: autoplay may require a user gesture,
      // or this cross-origin player may not publish its progress yet. Keep
      // this frame and its source choice available for a manual Play/reload.
      setActivity('timeout');
    }, activityTimeoutMs);
    const receive = (event: MessageEvent) => {
      if (failed || event.origin !== PROVIDER_EMBED_ORIGIN || event.source !== frame.contentWindow) return;
      const data = providerMessage(event.data);
      if (!data) return;
      const eventName = typeof data.event === 'string' ? data.event : null;
      const messageType = typeof data.type === 'string' ? data.type : null;
      const eventOnChannel = data.channel === 'megacloud' && ['time', 'complete', 'error'].includes(eventName ?? '');
      const watchingLog = messageType === 'watching-log';
      if (!eventOnChannel && !watchingLog) return;
      if (eventName === 'time' || watchingLog) {
        const metrics = playbackMetrics(data);
        if (metrics) {
          const advanced = previousPosition !== null && metrics.position > previousPosition + 0.1;
          previousPosition = metrics.position;
          // A loaded/paused player can repeatedly report the same time. Do
          // not add it to history or claim playback until time has advanced.
          if (!opened.current && !advanced) return;
          window.clearTimeout(timeout);
          setActivity('ready');
          setMetrics(metrics);
          if (!opened.current) {
            opened.current = true;
            handlers.current.onOpen?.();
          }
          handlers.current.onProgress?.(metrics.position, metrics.duration);
        }
        return;
      }
      if (eventName === 'complete' && opened.current) {
        window.clearTimeout(timeout);
        setActivity('ready');
        handlers.current.onEnded?.();
        return;
      }
      if (eventName === 'error') {
        failed = true;
        window.clearTimeout(timeout);
        const message = 'The provider player reported a playback error.';
        setProviderError(message);
        handlers.current.onError?.(message);
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [activityTimeoutMs, guardMode, reload, source]);

  if (!source) {
    return (
      <div className="provider-player provider-player--rejected" role="alert">
        <Icon name="unavailable" />
        <div>
          <h2>Provider player blocked</h2>
          <p>The embed address did not match Solanime’s verified provider policy.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`provider-player provider-player--framed provider-player--${guardMode}`}
      data-provider={resolution.providerId}
      data-guard-mode={guardMode}
      data-playback-position={metrics?.position}
      data-playback-duration={metrics?.duration}
    >
      <iframe
        ref={iframe}
        key={`${source}:${guardMode}:${reload}`}
        src={source}
        title="MegaPlay provider player"
        allow={PROVIDER_EMBED_ALLOW}
        allowFullScreen
        referrerPolicy={PROVIDER_EMBED_REFERRER_POLICY}
        onLoad={() => setFrameLoaded(true)}
      />
      {!frameLoaded && (
        <div className="provider-player__loading" aria-hidden="true">
          <span className="loading-spinner" />
        </div>
      )}
      <p className="provider-player__label sr-only" aria-live="polite">
        {activity === 'ready'
          ? `Provider playback · MegaPlay${guardActive ? ' · Desktop Guard' : ''}`
          : frameLoaded
            ? 'Provider frame loaded · Waiting for playback'
            : `Opening provider player · MegaPlay${guardActive ? ' · Desktop Guard' : ''}`}
      </p>
      {activity === 'timeout' && !providerError && (
        <div className="provider-player__timeout" role="status">
          <span>Press Play inside the video. If it does not start, reload or choose another source.</span>
          <button type="button" onClick={reloadPlayer}>Reload player</button>
        </div>
      )}
      {providerError && <div className="provider-player__error" role="alert">{providerError}</div>}
    </div>
  );
}

/**
 * The honest protection disclosure for provider-hosted players. It sits with
 * the server choice instead of under the picture, and stays out of the iPhone
 * app, whose host blocks popups natively.
 */
export function ProviderPlayerNote() {
  const [guardActive, setGuardActive] = useState(() => solanimeGuardActive());
  useEffect(() => {
    const update = () => setGuardActive(solanimeGuardActive());
    window.addEventListener(SOLANIME_GUARD_EVENT, update);
    return () => window.removeEventListener(SOLANIME_GUARD_EVENT, update);
  }, []);
  if (guardActive) return null;
  return (
    <details className="provider-player__notice">
      <summary>About this player</summary>
      <div role="status">
        This source uses the provider’s own player. Popup and redirect blocking depends on your browser
        {' '}or <a href="/downloads/solanime-guard.zip" download>Desktop Guard</a>, not a built-in Solanime blocker.
      </div>
    </details>
  );
}
