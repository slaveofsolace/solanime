// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProviderPlayer from '../src/components/ProviderPlayer';
import { providerEmbedUrl } from '../src/lib/providerEmbedPolicy';
import type { PlaybackResolution } from '../src/types';

beforeEach(() => {
  document.documentElement.dataset.solanimeGuard = 'active';
});
afterEach(() => {
  delete document.documentElement.dataset.solanimeGuard;
  cleanup();
});

const embed = {
  kind: 'embed',
  delivery: 'provider',
  mappingId: 'mapping-17',
  providerId: 'hd-1',
  language: 'sub',
  playbackType: 'iframe',
  status: 'resolved',
  embedUrl: 'https://megaplay.buzz/stream/s-2/12345/sub?s=tcdn',
  allowedEmbedHosts: ['megaplay.buzz'],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
} as unknown as PlaybackResolution;

describe('provider embed player', () => {
  it('renders only the exact observed MegaPlay route after the Guard handshake', () => {
    render(<ProviderPlayer resolution={embed} language="sub" />);
    const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    expect(frame.src).toBe('https://megaplay.buzz/stream/s-2/12345/sub?s=tcdn');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.getAttribute('allow')).toBe('autoplay; encrypted-media; fullscreen; picture-in-picture');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  });

  it('does not create an unsandboxed provider frame without an active Guard handshake', () => {
    delete document.documentElement.dataset.solanimeGuard;
    render(<ProviderPlayer resolution={embed} language="sub" />);
    expect(screen.queryByTitle('MegaPlay provider player')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Solanime Guard required');
  });

  it('accepts only the observed provider-specific server selector', () => {
    const hd1 = { ...(embed as unknown as Record<string, unknown>), embedUrl: 'https://megaplay.buzz/stream/s-2/12345/sub?s=tcdn' } as unknown as PlaybackResolution;
    const hd2 = { ...(embed as unknown as Record<string, unknown>), providerId: 'hd-2', embedUrl: 'https://megaplay.buzz/stream/s-2/12345/sub?s=bcdn' } as unknown as PlaybackResolution;
    expect(providerEmbedUrl(hd1, 'sub')).toBe('https://megaplay.buzz/stream/s-2/12345/sub?s=tcdn');
    expect(providerEmbedUrl(hd2, 'sub')).toBe('https://megaplay.buzz/stream/s-2/12345/sub?s=bcdn');
    expect(providerEmbedUrl({ ...hd1, embedUrl: 'https://megaplay.buzz/stream/s-2/12345/sub?s=bcdn' }, 'sub')).toBeNull();
  });

  it.each([
    'https://evil.example/stream/s-2/12345/sub',
    'https://megaplay.buzz.evil.example/stream/s-2/12345/sub',
    'https://megaplay.buzz/other/12345/sub',
    'https://megaplay.buzz/stream/s-2/not-numeric/sub',
    'https://megaplay.buzz/stream/s-2/12345/dub',
    'https://megaplay.buzz/stream/s-2/12345/sub?redirect=https://evil.example',
  ])('rejects an unverified address: %s', (embedUrl) => {
    const candidate = { ...(embed as unknown as Record<string, unknown>), embedUrl } as unknown as PlaybackResolution;
    expect(providerEmbedUrl(candidate, 'sub')).toBeNull();
    render(<ProviderPlayer resolution={candidate} language="sub" />);
    expect(screen.queryByTitle('MegaPlay provider player')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Provider player blocked');
  });

  it('accepts progress and completion only from its own frame and exact provider origin', () => {
    const progress = vi.fn();
    const opened = vi.fn();
    const ended = vi.fn();
    render(<ProviderPlayer resolution={embed} language="sub" onOpen={opened} onProgress={progress} onEnded={ended} />);
    const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    fireEvent(window, new MessageEvent('message', {
      origin: 'https://evil.example',
      source: frame.contentWindow,
      data: { channel: 'megacloud', event: 'time', time: 8, duration: 24, percent: 33 },
    }));
    expect(progress).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz',
      source: frame.contentWindow,
      data: { event: 'time', time: 8, duration: 24, percent: 33 },
    }));
    expect(progress).not.toHaveBeenCalled();
    fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz',
      source: frame.contentWindow,
      data: JSON.stringify({ channel: 'megacloud', event: 'time', time: 8, duration: 24, percent: 33 }),
    }));
    expect(progress).toHaveBeenCalledWith(8, 24);
    expect(opened).toHaveBeenCalledTimes(1);
    fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz',
      source: frame.contentWindow,
      data: { type: 'watching-log', currentTime: 9, duration: 24 },
    }));
    expect(progress).toHaveBeenLastCalledWith(9, 24);
    expect(opened).toHaveBeenCalledTimes(1);
    fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz',
      source: frame.contentWindow,
      data: { channel: 'megacloud', event: 'complete' },
    }));
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('treats iframe load as transport only and offers a bounded timeout recovery', () => {
    vi.useFakeTimers();
    try {
      const opened = vi.fn();
      render(<ProviderPlayer resolution={embed} language="sub" onOpen={opened} activityTimeoutMs={100} />);
      fireEvent.load(screen.getByTitle('MegaPlay provider player'));
      expect(screen.getByText('Provider frame loaded · Waiting for playback')).toBeTruthy();
      expect(opened).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByText('No playback activity was reported.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reload player' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
