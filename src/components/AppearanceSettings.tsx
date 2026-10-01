import { useId, useState } from 'react';
import { useAppState } from '../state';
import { ACCENT_PRESETS, DEFAULT_ACCENT, normalizeAccent } from '../lib/theme';
import type { CSSProperties } from 'react';
import Icon from './Icon';
export default function AppearanceSettings() {
  const [preferences, setPreferences] = useAppState().preferences;
  const accent = normalizeAccent(preferences.accent);
  const [draft, setDraft] = useState(accent);
  const [error, setError] = useState(false);
  const [showAccent, setShowAccent] = useState(
    () => !document.documentElement.classList.contains('solanime-native-ios') &&
      !(typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches),
  );
  const id = useId();
  const choose = (value: string) => {
    const normalized = normalizeAccent(value);
    setDraft(normalized);
    setError(false);
    setPreferences((current) => ({ ...current, accent: normalized }));
  };
  return (
    <div className="appearance-settings">
      <div className="appearance-preference appearance-theme-preference">
        <h3>Theme</h3>
        <div className="appearance-mode" role="group" aria-label="Color theme">
          {(['dark', 'light'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={(preferences.theme ?? 'dark') === mode}
              onClick={() => setPreferences((current) => ({ ...current, theme: mode }))}
            >
              {mode === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-preference motion-preference">
        <h3>Motion</h3>
        <div className="appearance-mode" role="group" aria-label="Motion preference">
          <button
            type="button"
            aria-pressed={preferences.motion !== 'reduced'}
            onClick={() => setPreferences((current) => ({ ...current, motion: 'system' }))}
          >
            Follow device
          </button>
          <button
            type="button"
            aria-pressed={preferences.motion === 'reduced'}
            onClick={() => setPreferences((current) => ({ ...current, motion: 'reduced' }))}
          >
            Reduce motion
          </button>
        </div>
      </div>
      <label className="native-motion-toggle">
        <span>Reduce motion</span>
        <input
          type="checkbox"
          checked={preferences.motion === 'reduced'}
          onChange={(event) => setPreferences((current) => ({
            ...current,
            motion: event.target.checked ? 'reduced' : 'system',
          }))}
        />
      </label>
      <button
        className="accent-disclosure"
        type="button"
        aria-expanded={showAccent}
        aria-controls={`${id}-accent-options`}
        onClick={() => setShowAccent((value) => !value)}
      >
        <span>Accent color</span>
        <Icon name="right" />
      </button>
      <div id={`${id}-accent-options`} className="accent-options" hidden={!showAccent}>
      <div className="accent-presets" role="group" aria-label="Accent presets">
        {ACCENT_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className="accent-swatch"
            style={{ '--swatch': preset.value } as CSSProperties}
            aria-label={preset.name}
            title={preset.name}
            aria-pressed={accent === preset.value}
            onClick={() => choose(preset.value)}
          >
            <span />
          </button>
        ))}
      </div>
      <form
        className="accent-custom"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^#[0-9a-f]{6}$/i.test(draft)) {
            setError(true);
            return;
          }
          choose(draft);
        }}
      >
        <label htmlFor={id}>Custom hex</label>
        <div className="accent-custom__row">
          <input
            type="color"
            aria-label="Choose accent color"
            value={accent}
            onChange={(event) => choose(event.target.value)}
          />
          <input
            id={id}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(false);
            }}
            placeholder="#EE791F"
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error || undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <button type="submit">Apply</button>
        </div>
        {error && (
          <p className="field-error" id={`${id}-error`} role="alert">
            Enter # followed by six hexadecimal characters.
          </p>
        )}
      </form>
      <p className="appearance-caption">
        Text and focus colors adjust for contrast.
      </p>
      <button className="text-button" type="button" onClick={() => choose(DEFAULT_ACCENT)}>
        Reset accent
      </button>
      </div>
    </div>
  );
}
