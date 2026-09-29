// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverArt } from '../src/components/ui';

const title = {
  id: 'artwork-title',
  source: 'anikoto',
  slug: 'artwork-title',
  name: 'Artwork title',
  posterUrl: 'https://images.example/poster.jpg',
  imageUrl: 'https://images.example/original.jpg',
  backdropUrl: 'https://images.example/backdrop.jpg',
};

describe('CoverArt', () => {
  afterEach(() => cleanup());

  it('falls back from a failed backdrop to a role-safe poster layout', () => {
    const view = render(<CoverArt title={title} variant="landscape" />);

    const backdrop = view.container.querySelector('img');
    expect(backdrop?.getAttribute('src')).toBe(title.backdropUrl);
    fireEvent.error(backdrop!);

    const poster = view.container.querySelector<HTMLImageElement>('.cover-composition__poster');
    expect(poster?.src).toBe(title.posterUrl);
    expect(poster?.className).toBe('cover-composition__poster');
    expect(poster?.parentElement?.getAttribute('data-artwork-source')).toBe('poster-layout');
  });

  it('tries the original thumbnail before presenting a labeled title card', () => {
    const view = render(
      <CoverArt title={{ ...title, backdropUrl: null }} variant="landscape" />,
    );

    fireEvent.error(view.container.querySelector('.cover-composition__poster')!);
    expect(
      view.container.querySelector<HTMLImageElement>('.cover-composition__poster')?.src,
    ).toBe(title.imageUrl);

    fireEvent.error(view.container.querySelector('.cover-composition__poster')!);
    const fallback = view.getByLabelText('No artwork available for Artwork title');
    expect(fallback.querySelector('.cover-fallback__title')?.textContent).toBe('Artwork title');
  });

  it('uses a measured landscape fallback as full-bleed artwork', () => {
    const view = render(
      <CoverArt title={{ ...title, source: 'tvmaze', backdropUrl: null }} variant="landscape" />,
    );

    const probe = view.container.querySelector<HTMLImageElement>('.cover-composition__poster')!;
    Object.defineProperties(probe, {
      naturalWidth: { configurable: true, value: 1280 },
      naturalHeight: { configurable: true, value: 720 },
    });
    fireEvent.load(probe);
    const landscape = view.container.querySelector<HTMLImageElement>('.cover-composition__crop');
    expect(landscape?.src).toBe(title.posterUrl);
    expect(landscape?.parentElement?.getAttribute('data-artwork-source')).toBe('landscape-fallback');
  });
});
