// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppearanceSettings from '../src/components/AppearanceSettings';

type TestPreferences = {
  accent?: string;
  theme?: 'dark' | 'light';
  motion?: 'system' | 'reduced';
};

const state = vi.hoisted(() => ({
  preferences: {} as TestPreferences,
  setPreferences: (_update: unknown) => undefined,
}));

vi.mock('../src/state', () => ({
  useAppState: () => ({
    preferences: [state.preferences, state.setPreferences],
  }),
}));

describe('AppearanceSettings', () => {
  beforeEach(() => {
    state.preferences = { accent: '#EE791F', theme: 'dark' };
    state.setPreferences = (update: unknown) => {
      state.preferences =
        typeof update === 'function'
          ? (update as (current: TestPreferences) => TestPreferences)(state.preferences)
          : (update as TestPreferences);
    };
  });

  afterEach(() => cleanup());

  it('does not overwrite a typed draft after a preset preference rerender', () => {
    const view = render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Accent color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Violet' }));
    view.rerender(<AppearanceSettings />);

    const customHex = screen.getByRole('textbox', { name: 'Custom hex' });
    fireEvent.change(customHex, { target: { value: '#GGGGGG' } });

    state.preferences = { ...state.preferences, theme: 'light' };
    view.rerender(<AppearanceSettings />);

    expect((customHex as HTMLInputElement).value).toBe('#GGGGGG');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Enter # followed by six hexadecimal characters.',
    );
    expect(customHex.getAttribute('aria-invalid')).toBe('true');
  });

  it('normalizes an accepted custom accent in both draft and preferences', () => {
    render(<AppearanceSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Accent color' }));
    const customHex = screen.getByRole('textbox', { name: 'Custom hex' });
    fireEvent.change(customHex, { target: { value: '#00aa88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect((customHex as HTMLInputElement).value).toBe('#00AA88');
    expect(state.preferences.accent).toBe('#00AA88');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers one motion switch and restores the device preference when turned off', () => {
    const view = render(<AppearanceSettings />);
    const motion = screen.getByRole('checkbox', { name: 'Reduce motion' }) as HTMLInputElement;
    expect(motion.checked).toBe(false);
    expect(screen.queryByRole('button', { name: 'Reduce motion' })).toBeNull();

    fireEvent.click(motion);
    expect(state.preferences.motion).toBe('reduced');
    view.rerender(<AppearanceSettings />);
    expect(motion.checked).toBe(true);

    fireEvent.click(motion);
    expect(state.preferences.motion).toBe('system');
    view.rerender(<AppearanceSettings />);
    expect(motion.checked).toBe(false);
  });
});
