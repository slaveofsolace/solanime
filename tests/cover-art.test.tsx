// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CoverArt } from '../src/components/ui';

const title = {
  id: 'artwork-title',
  slug: 'artwork-title',
  name: 'Artwork title',
  posterUrl: 'https://images.example/poster.jpg',
  imageUrl: 'https://images.example/original.jpg',
  backdropUrl: 'https://images.example/backdrop.jpg',
};

describe('CoverArt', () => {
  afterEach(() => cleanup());

  it('falls back from a failed backdrop to an uncropped poster composition', () => {
    const view = render(<CoverArt title={title} variant="landscape" />);

    const backdrop = view.container.querySelector('img');
    expect(backdrop?.getAttribute('src')).toBe(title.backdropUrl);
    fireEvent.error(backdrop!);

    const poster = view.container.querySelector<HTMLImageElement>('.cover-composition__poster');
    expect(poster?.src).toBe(title.posterUrl);
    expect(poster?.className).toBe('cover-composition__poster');
  });

  it('tries the original thumbnail before presenting the explicit missing-art state', () => {
    const view = render(
      <CoverArt title={{ ...title, backdropUrl: null }} variant="landscape" />,
    );

    fireEvent.error(view.container.querySelector('.cover-composition__poster')!);
    expect(
      view.container.querySelector<HTMLImageElement>('.cover-composition__poster')?.src,
    ).toBe(title.imageUrl);

    fireEvent.error(view.container.querySelector('.cover-composition__poster')!);
    expect(
      view.getByLabelText('No artwork available for Artwork title').textContent,
    ).toContain('Artwork unavailable');
  });
});
