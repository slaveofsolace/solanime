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

    expect(screen.getByRole('heading', { name: 'Not available in the Solanime player' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Observed playback sources' })).toBeTruthy();
    expect(screen.getByText('Web mirror')).toBeTruthy();
    expect(screen.getByText('Webpage-only source')).toBeTruthy();
    expect(screen.getByText('Blocked upstream')).toBeTruthy();
    expect(screen.queryByText(/play now/i)).toBeNull();
  });

  it('distinguishes a rejected native response from a webpage-only mapping', () => {
    const selected: ProviderChoice = {
      mappingId: 'map-native',
      providerId: 'native-provider',
      label: 'Native candidate',
      playbackType: 'hls',
      status: 'available',
      supported: true,
    };
    render(<UnsupportedPlayback providers={[selected]} selected={selected} />);

    expect(screen.getByRole('heading', { name: 'This source cannot play safely' })).toBeTruthy();
    expect(screen.getByText('Selected response rejected')).toBeTruthy();
    expect(screen.getByText(/format or origin/i)).toBeTruthy();
  });

  it('reports a genuinely empty mapping inventory without inventing sources', () => {
    render(<UnsupportedPlayback providers={[]} />);

    expect(screen.getByText('No provider mapping has been observed for this episode yet.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Observed playback sources' })).toBeNull();
  });
});
