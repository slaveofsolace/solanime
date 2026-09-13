import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import {
  PROVIDER_EMBED_ALLOW,
  PROVIDER_EMBED_ORIGIN,
  PROVIDER_EMBED_SANDBOX,
  providerEmbedUrl,
  type ProviderEmbedResolution,
} from '../lib/providerEmbedPolicy';
import Icon from './Icon';

interface ProviderPlayerProps {
  resolution: PlaybackResolution | ProviderEmbedResolution;
  language: string;
  onProgress?: (position: number, duration: number) => void;
  onOpen?: () => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
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
  activityTimeoutMs = 12_000,
}: ProviderPlayerProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const opened = useRef(false);
  const handlers = useRef({ onProgress, onOpen, onEnded, onError });
  handlers.current = { onProgress, onOpen, onEnded, onError };
  const [providerError, setProviderError] = useState<string | null>(null);
  const [activity, setActivity] = useState<'loading' | 'ready' | 'timeout'>('loading');
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const source = providerEmbedUrl(resolution, language);

  useEffect(() => {
    const frame = iframe.current;
    if (!frame || !source) return;
    opened.current = false;
    setActivity('loading');
    setFrameLoaded(false);
    setProviderError(null);
    const timeout = window.setTimeout(() => setActivity('timeout'), activityTimeoutMs);
    const receive = (event: MessageEvent) => {
      if (event.origin !== PROVIDER_EMBED_ORIGIN || event.source !== frame.contentWindow) return;
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
          window.clearTimeout(timeout);
          setActivity('ready');
          if (!opened.current) {
            opened.current = true;
            handlers.current.onOpen?.();
          }
          handlers.current.onProgress?.(metrics.position, metrics.duration);
        }
        return;
      }
      if (eventName === 'complete') {
        window.clearTimeout(timeout);
        setActivity('ready');
        handlers.current.onEnded?.();
        return;
      }
      if (eventName === 'error') {
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
  }, [activityTimeoutMs, reload, source]);

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
    <div className="provider-player" data-provider={resolution.providerId}>
      <iframe
        ref={iframe}
        key={`${source}:${reload}`}
        src={source}
        title="MegaPlay provider player"
        sandbox={PROVIDER_EMBED_SANDBOX}
        allow={PROVIDER_EMBED_ALLOW}
        allowFullScreen
        referrerPolicy="no-referrer"
        onLoad={() => setFrameLoaded(true)}
      />
      <p className="provider-player__label">
        {activity === 'ready'
          ? 'Provider playback · MegaPlay'
          : frameLoaded
            ? 'Provider frame loaded · Waiting for playback'
            : 'Opening provider player · MegaPlay'}
      </p>
      {activity === 'timeout' && !providerError && (
        <div className="provider-player__timeout" role="status">
          <span>No playback activity was reported.</span>
          <button type="button" onClick={() => setReload((value) => value + 1)}>Reload player</button>
        </div>
      )}
      {providerError && <div className="provider-player__error" role="alert">{providerError}</div>}
    </div>
  );
}
