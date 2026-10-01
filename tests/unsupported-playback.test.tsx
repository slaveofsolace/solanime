// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import UnsupportedPlayback from '../src/components/UnsupportedPlayback';
import type { ProviderChoice } from '../src/types';

afterEach(cleanup);

const providers: ProviderChoice[] = [
  {
    mappingId: 'map-web',
    providerId: 'web-provider',
    label: 'Web mirror',
    playbackType: 'iframe',
    status: 'observed',
    supported: false,
  },
  {
    mappingId: 'map-blocked',
    providerId: 'blocked-provider',
    label: 'Blocked mirror',
    playbackType: 'unknown',
    status: 'blocked',
    supported: false,
  },
];

describe('unsupported playback state', () => {
  it('keeps observed provider mappings visible without calling them playable', () => {
    render(<UnsupportedPlayback providers={providers} />);

    expect(screen.getByRole('heading', { name: 'Not playable here yet' })).toBeTruthy();
    expect(screen.getByText('2 sources found · none playable here')).toBeTruthy();
    expect(screen.getByText(/None of the sources we found can play/i)).toBeTruthy();
    expect(screen.getByText('Why each source is unavailable')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Sources checked for this episode' })).toBeTruthy();
    expect(screen.getByText('Web mirror')).toBeTruthy();
    expect(screen.getByText('Blocked for your safety')).toBeTruthy();
    expect(screen.getByText('Blocked upstream')).toBeTruthy();
    expect(screen.queryByText(/play now/i)).toBeNull();
  });

  it('distinguishes a rejected native response from a webpage-only mapping', () => {
    const selected: ProviderChoice = {
      mappingId: 'map-native',
      providerId: 'native-provider',
      label: 'Native candidate',
      kind: 'native',
      playbackType: 'hls',
      status: 'available',
      supported: true,
    };
    render(<UnsupportedPlayback providers={[selected]} selected={selected} />);

    expect(screen.getByRole('heading', { name: 'This source cannot play here' })).toBeTruthy();
    expect(screen.getByText('Could not play this video')).toBeTruthy();
    expect(screen.getByText(/sent a video Solanime can’t play/i)).toBeTruthy();
  });

  it('reports a genuinely empty mapping inventory without inventing sources', () => {
    render(<UnsupportedPlayback providers={[]} />);

    expect(screen.getByRole('heading', { name: 'No video for this episode yet' })).toBeTruthy();
    expect(screen.getByText(/haven’t found a source for this episode/i)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Sources checked for this episode' })).toBeNull();
  });

  it('uses title artwork as a decorative unavailable-state backdrop', () => {
    render(
      <UnsupportedPlayback
        providers={providers}
        artworkUrl="https://images.example.test/title-backdrop.jpg"
      />,
    );

    const artwork = document.querySelector('.unsupported-playback__artwork');
    expect(artwork).toBeInstanceOf(HTMLImageElement);
    expect(artwork?.getAttribute('src')).toBe('https://images.example.test/title-backdrop.jpg');
    expect(artwork?.getAttribute('alt')).toBe('');
    expect(artwork?.getAttribute('aria-hidden')).toBe('true');
  });
});
