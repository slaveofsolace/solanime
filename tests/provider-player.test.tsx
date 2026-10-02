// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProviderPlayer, { ProviderPlayerNote } from '../src/components/ProviderPlayer';
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
    expect(frame.getAttribute('allow')).toBe('autoplay; fullscreen; picture-in-picture');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  });

  it('restores the earlier compatible embed without claiming built-in redirect blocking', () => {
    delete document.documentElement.dataset.solanimeGuard;
    render(<><ProviderPlayer resolution={embed} language="sub" /><ProviderPlayerNote /></>);
    const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    expect(frame.src).toBe('https://megaplay.buzz/stream/s-2/12345/sub?s=tcdn');
    expect(frame.hasAttribute('sandbox')).toBe(false);
    fireEvent.click(screen.getByText('About this player'));
    expect(screen.getByRole('status', { hidden: true }).textContent).toContain('depends on your browser');
    expect(screen.queryByText('Built-in Guard · On')).toBeNull();
    const download = screen.getByRole('link', { name: 'Desktop Guard', hidden: true });
    expect(download.getAttribute('href')).toBe('/downloads/solanime-guard.zip');
    expect(download.hasAttribute('download')).toBe(true);
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
    expect(progress).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
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

  it('keeps a silent loaded frame available instead of failing sources before a Play gesture', () => {
    vi.useFakeTimers();
    try {
      const opened = vi.fn();
      const error = vi.fn();
      render(<ProviderPlayer resolution={embed} language="sub" onOpen={opened} onError={error} activityTimeoutMs={100} />);
      fireEvent.load(screen.getByTitle('MegaPlay provider player'));
      expect(screen.getByText('Provider frame loaded · Waiting for playback')).toBeTruthy();
      expect(opened).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByText(/Press Play inside the video/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Reload player' })).toBeTruthy();
      expect(error).not.toHaveBeenCalled();
      const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByTitle('MegaPlay provider player')).toBe(frame);
      expect(error).not.toHaveBeenCalled();
      for (const time of [1, 2]) fireEvent(window, new MessageEvent('message', {
        origin: 'https://megaplay.buzz', source: frame.contentWindow,
        data: { channel: 'megacloud', event: 'time', time, duration: 24 },
      }));
      expect(opened).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Reload player' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not eject an already mounted player when its resolution expires during a parent rerender', () => {
    vi.useFakeTimers();
    try {
      const expiring = {
        ...embed,
        expiresAt: new Date(Date.now() + 100).toISOString(),
      } as PlaybackResolution;
      const { rerender } = render(<ProviderPlayer resolution={expiring} language="sub" />);
      const frame = screen.getByTitle('MegaPlay provider player');
      act(() => vi.advanceTimersByTime(200));
      expect(providerEmbedUrl(expiring, 'sub')).toBeNull();
      rerender(<ProviderPlayer resolution={expiring} language="sub" />);
      expect(screen.getByTitle('MegaPlay provider player')).toBe(frame);
      rerender(<ProviderPlayer resolution={{ ...expiring }} language="sub" />);
      expect(screen.queryByTitle('MegaPlay provider player')).toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('Provider player blocked');
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for a fresh resolution when reloading an expired embed', () => {
    vi.useFakeTimers();
    try {
      const onRefresh = vi.fn();
      const expiring = { ...embed, expiresAt: new Date(Date.now() + 100).toISOString() } as PlaybackResolution;
      render(<ProviderPlayer resolution={expiring} language="sub" activityTimeoutMs={50} onRefresh={onRefresh} />);
      const frame = screen.getByTitle('MegaPlay provider player');
      act(() => vi.advanceTimersByTime(200));
      fireEvent.click(screen.getByRole('button', { name: 'Reload player' }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(screen.getByTitle('MegaPlay provider player')).toBe(frame);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not claim playback from stationary time reports or an early completion event', () => {
    const opened = vi.fn(), progress = vi.fn(), ended = vi.fn();
    render(<ProviderPlayer resolution={embed} language="sub" onOpen={opened} onProgress={progress} onEnded={ended} />);
    const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    const send = (data: unknown) => fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz', source: frame.contentWindow, data,
    }));
    send({ channel: 'megacloud', event: 'complete' });
    for (const time of [0, 0, 0]) send({ channel: 'megacloud', event: 'time', time, duration: 24 });
    expect(opened).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    send({ channel: 'megacloud', event: 'time', time: 1, duration: 24 });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(1, 24);
  });

  it('reports an explicit provider failure once and cancels its waiting timer', () => {
    vi.useFakeTimers();
    try {
      const error = vi.fn();
      render(<ProviderPlayer resolution={embed} language="sub" onError={error} activityTimeoutMs={100} />);
      const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
      for (let i = 0; i < 2; i++) fireEvent(window, new MessageEvent('message', {
        origin: 'https://megaplay.buzz', source: frame.contentWindow,
        data: { channel: 'megacloud', event: 'error' },
      }));
      act(() => vi.advanceTimersByTime(100));
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith('The provider player reported a playback error.');
      expect(screen.queryByRole('button', { name: 'Reload player' })).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('ignores late progress from the previous source after switching players', () => {
    const progress = vi.fn();
    const { rerender } = render(<ProviderPlayer resolution={embed} language="sub" onProgress={progress} />);
    const oldWindow = (screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement).contentWindow;
    const next = { ...embed, providerId: 'hd-2', embedUrl: 'https://megaplay.buzz/stream/s-2/12345/sub?s=bcdn' };
    rerender(<ProviderPlayer resolution={next} language="sub" onProgress={progress} />);
    const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    expect(frame.contentWindow === oldWindow).toBe(false);
    for (const time of [1, 2]) fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz', source: oldWindow,
      data: { channel: 'megacloud', event: 'time', time, duration: 24 },
    }));
    expect(progress).not.toHaveBeenCalled();
  });

  it('remounts on protection changes and discards progress from the old frame', () => {
    delete document.documentElement.dataset.solanimeGuard;
    const opened = vi.fn();
    render(<ProviderPlayer resolution={embed} language="sub" onOpen={opened} />);
    const frame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    for (const time of [1, 2]) fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz', source: frame.contentWindow,
      data: { channel: 'megacloud', event: 'time', time, duration: 24 },
    }));
    document.documentElement.dataset.solanimeGuard = 'active';
    fireEvent(window, new Event('solanime-guard-status'));
    const extensionFrame = screen.getByTitle('MegaPlay provider player') as HTMLIFrameElement;
    expect(extensionFrame).not.toBe(frame);
    expect(extensionFrame.hasAttribute('sandbox')).toBe(false);
    expect(screen.getByText('Opening provider player · MegaPlay · Desktop Guard')).toBeTruthy();
    expect(opened).toHaveBeenCalledTimes(1);
    const oldWindow = extensionFrame.contentWindow;
    delete document.documentElement.dataset.solanimeGuard;
    fireEvent(window, new Event('solanime-guard-status'));
    const protectedFrame = screen.getByTitle('MegaPlay provider player');
    expect(protectedFrame).not.toBe(extensionFrame);
    expect(protectedFrame.hasAttribute('sandbox')).toBe(false);
    expect(screen.getByText('Opening provider player · MegaPlay')).toBeTruthy();
    for (const time of [3, 4]) fireEvent(window, new MessageEvent('message', {
      origin: 'https://megaplay.buzz', source: oldWindow,
      data: { channel: 'megacloud', event: 'time', time, duration: 24 },
    }));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('keeps the compatible provider mode after timeout and reload', () => {
    vi.useFakeTimers();
    try {
      delete document.documentElement.dataset.solanimeGuard;
      render(<ProviderPlayer resolution={embed} language="sub" activityTimeoutMs={100} />);
      act(() => vi.advanceTimersByTime(100));
      expect(screen.getByText(/Press Play inside the video/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Reload player' }));
      expect(screen.getByTitle('MegaPlay provider player').hasAttribute('sandbox')).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
