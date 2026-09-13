// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YouTubeOfficialPlayer from '../src/components/YouTubeOfficialPlayer.tsx';
import {
  YOUTUBE_IFRAME_ALLOW,
  YOUTUBE_IFRAME_SANDBOX,
} from '../src/lib/youtubeOfficialPolicy.ts';
import type { PlaybackResolution } from '../src/types.ts';

const resolution = {
  kind: 'official-youtube',
  mappingId: '22',
  providerId: 'youtube-official',
  language: 'sub',
  playbackType: 'iframe',
  status: 'resolved',
  delivery: 'provider',
  videoId: '_3Gcm-iGAQk',
  allowedEmbedHosts: ['www.youtube-nocookie.com'],
  publisher: {
    label: "It's Anime powered by REMOW",
    channelId: 'UCsj_CYajUSQ2ca8bYCMan9g',
    channelUrl: 'https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g',
    handleUrl: 'https://www.youtube.com/@ItsAnimeJP',
  },
} as PlaybackResolution;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.YT;
});

describe('official YouTube player', () => {
  it('uses the standard privacy-enhanced player, exact origin/referrer and bounded sandbox', async () => {
    const destroy = vi.fn();
    const seekTo = vi.fn();
    const opened = vi.fn();
    const progress = vi.fn();
    const ended = vi.fn();
    let events!: {
      onReady(event: { target: unknown }): void;
      onStateChange(event: { data: number; target: unknown }): void;
      onError(event: { data: number; target: unknown }): void;
    };
    const player = {
      destroy,
      seekTo,
      getCurrentTime: vi.fn(() => 25),
      getDuration: vi.fn(() => 100),
    };
    window.YT = {
      Player: class {
        constructor(_frame: HTMLIFrameElement, options: { events: typeof events }) {
          events = options.events;
          return player;
        }
      } as unknown as NonNullable<typeof window.YT>['Player'],
    };
    const view = render(
      <YouTubeOfficialPlayer
        resolution={resolution}
        initialPosition={20}
        onOpen={opened}
        onProgress={progress}
        onEnded={ended}
      />,
    );
    const frame = screen.getByTitle(/Official YouTube player/) as HTMLIFrameElement;
    const url = new URL(frame.src);
    expect(url.origin).toBe('https://www.youtube-nocookie.com');
    expect(url.pathname).toBe('/embed/_3Gcm-iGAQk');
    expect(url.searchParams.get('origin')).toBe(window.location.origin);
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(frame.getAttribute('sandbox')).toBe(YOUTUBE_IFRAME_SANDBOX);
    expect(frame.getAttribute('sandbox')).not.toMatch(/popup|top-navigation|downloads|forms/);
    expect(frame.getAttribute('allow')).toBe(YOUTUBE_IFRAME_ALLOW);
    await act(async () => { await Promise.resolve(); });

    act(() => events.onReady({ target: player }));
    expect(seekTo).toHaveBeenCalledWith(20, true);
    act(() => events.onStateChange({ data: 1, target: player }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(25, 100);
    act(() => events.onStateChange({ data: 2, target: player }));
    act(() => events.onStateChange({ data: 1, target: player }));
    expect(opened).toHaveBeenCalledTimes(1);
    act(() => events.onStateChange({ data: 0, target: player }));
    expect(ended).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('shows explicit embed-policy failures and can rebuild the player once', async () => {
    let events!: { onError(event: { data: number; target: unknown }): void };
    const destroy = vi.fn();
    window.YT = {
      Player: class {
        constructor(_frame: HTMLIFrameElement, options: { events: typeof events }) {
          events = options.events;
          return { destroy, seekTo: vi.fn(), getCurrentTime: () => 0, getDuration: () => 0 };
        }
      } as unknown as NonNullable<typeof window.YT>['Player'],
    };
    render(<YouTubeOfficialPlayer resolution={resolution} />);
    await act(async () => { await Promise.resolve(); });
    act(() => events.onError({ data: 150, target: {} }));
    expect(screen.getByRole('alert').textContent).toContain('does not currently permit');
    expect(screen.getByRole('alert').getAttribute('data-error-code')).toBe('YOUTUBE_EMBED_DISABLED');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTitle(/Official YouTube player/)).toBeTruthy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('samples the ready event target when the constructor result is not hydrated yet', async () => {
    const progress = vi.fn();
    let events!: {
      onReady(event: { target: unknown }): void;
      onStateChange(event: { data: number; target: unknown }): void;
    };
    const hydratedPlayer = {
      destroy: vi.fn(),
      seekTo: vi.fn(),
      getCurrentTime: vi.fn(() => 8),
      getDuration: vi.fn(() => 24),
    };
    window.YT = {
      Player: class {
        constructor(_frame: HTMLIFrameElement, options: { events: typeof events }) {
          events = options.events;
          return { destroy: vi.fn() };
        }
      } as unknown as NonNullable<typeof window.YT>['Player'],
    };

    render(<YouTubeOfficialPlayer resolution={resolution} onProgress={progress} />);
    await act(async () => { await Promise.resolve(); });
    act(() => events.onReady({ target: hydratedPlayer }));
    act(() => events.onStateChange({ data: 1, target: hydratedPlayer }));

    expect(progress).toHaveBeenCalledWith(8, 24);
  });

  it('does not rebuild a playing iframe when an equivalent resolution object is rerendered', async () => {
    const destroy = vi.fn();
    const construct = vi.fn();
    const player = {
      destroy,
      seekTo: vi.fn(),
      getCurrentTime: vi.fn(() => 4),
      getDuration: vi.fn(() => 24),
    };
    window.YT = {
      Player: class {
        constructor() {
          construct();
          return player;
        }
      } as unknown as NonNullable<typeof window.YT>['Player'],
    };

    const view = render(<YouTubeOfficialPlayer resolution={resolution} />);
    await act(async () => { await Promise.resolve(); });
    expect(construct).toHaveBeenCalledTimes(1);

    view.rerender(<YouTubeOfficialPlayer resolution={{ ...resolution }} />);
    await act(async () => { await Promise.resolve(); });
    expect(construct).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('removes a failed API script so Retry can start with a clean loader', async () => {
    render(<YouTubeOfficialPlayer resolution={resolution} />);
    const failedScript = document.getElementById('solanime-youtube-iframe-api') as HTMLScriptElement;
    expect(failedScript).toBeTruthy();
    fireEvent.error(failedScript);
    await act(async () => { await Promise.resolve(); });
    expect(failedScript.isConnected).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');

    let ready!: (event: { target: unknown }) => void;
    window.YT = {
      Player: class {
        constructor(_frame: HTMLIFrameElement, options: { events: { onReady(event: { target: unknown }): void } }) {
          ready = options.events.onReady;
          return { destroy: vi.fn(), seekTo: vi.fn(), getCurrentTime: () => 0, getDuration: () => 0 };
        }
      } as unknown as NonNullable<typeof window.YT>['Player'],
    };
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => { await Promise.resolve(); });
    act(() => ready({ target: { getDuration: () => 0 } }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never renders an iframe for a spoofed publisher response', () => {
    render(<YouTubeOfficialPlayer resolution={{
      ...resolution,
      publisher: { ...resolution.publisher!, channelId: 'UC0000000000000000000000' },
    }} />);
    expect(screen.queryByTitle(/Official YouTube player/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('verified publisher and video policy');
  });
});
