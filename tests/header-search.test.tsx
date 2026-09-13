// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
import HeaderSearch from '../src/components/HeaderSearch';

afterEach(cleanup);

function Harness() {
  const location = useLocation();
  return <><HeaderSearch /><Link to="/library">My List</Link><output>{location.pathname}{location.search}</output></>;
}
function setup(path = '/') {
  render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>);
  return screen.getByRole('button', { name: 'Search all anime' });
}

describe('compact header search', () => {
  it('reserves one trigger and opens a labelled focused search only when requested', () => {
    const trigger = setup();
    expect(screen.queryByRole('search')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(screen.getByRole('search', { name: 'Search all anime' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Find anime' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on Escape, restores the trigger focus, and retains the draft', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'Summer' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('search')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Summer');
  });

  it('submits a trimmed, encoded deep link without injecting query parameters', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  A&B?sub=1  ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByRole('status').textContent).toBe('/search?q=A%26B%3Fsub%3D1');
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('prefills an existing search and clears a blank submission without a phantom query', () => {
    const trigger = setup('/search?q=Ocean');
    fireEvent.click(trigger);
    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.value).toBe('Ocean');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByRole('status').textContent).toBe('/search');
  });

  it('dismisses on leaving the component and on another route without stealing focus', () => {
    const trigger = setup();
    fireEvent.click(trigger);
    const link = screen.getByRole('link', { name: 'My List' });
    fireEvent.blur(screen.getByRole('searchbox'), { relatedTarget: link });
    expect(screen.queryByRole('search')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(link);
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('/library');
  });
});
