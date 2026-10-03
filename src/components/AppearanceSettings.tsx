import { useId, useState } from 'react';
import { useAppState } from '../state';
import { ACCENT_PRESETS, DEFAULT_ACCENT, normalizeAccent } from '../lib/theme';
import type { CSSProperties } from 'react';
import Disclosure from './Disclosure';
export default function AppearanceSettings() {
  const [preferences, setPreferences] = useAppState().preferences;
  const accent = normalizeAccent(preferences.accent);
  const [draft, setDraft] = useState(accent);
  const [error, setError] = useState(false);
  const [showAccent, setShowAccent] = useState(false);
  const id = useId();
  const choose = (value: string) => {
    const normalized = normalizeAccent(value);
    setDraft(normalized);
    setError(false);
    setPreferences((current) => ({ ...current, accent: normalized }));
  };
  return (
    <div className="appearance-settings">
      <div className="appearance-preference appearance-theme-preference settings-row">
        <h3>Theme</h3>
        <div className="appearance-mode segmented-control" role="group" aria-label="Color theme">
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
      <label className="settings-row appearance-motion-preference">
        <span className="settings-row__copy"><strong>Reduce motion</strong><small id={`${id}-motion-hint`}>Follows your device when off.</small></span>
        <input
          className="settings-toggle"
          type="checkbox"
          aria-label="Reduce motion"
          aria-describedby={`${id}-motion-hint`}
          checked={preferences.motion === 'reduced'}
          onChange={(event) => setPreferences((current) => ({
            ...current,
            motion: event.target.checked ? 'reduced' : 'system',
          }))}
        />
      </label>
      <Disclosure title="Accent color" className="appearance-accent"
        expanded={showAccent} onToggle={() => setShowAccent(value => !value)}
        accessory={<span className="accent-current-swatch" style={{ '--swatch': accent } as CSSProperties} />}>
        <div className="accent-options">
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
        <button className="text-button" type="button" onClick={() => choose(DEFAULT_ACCENT)}>
          Reset accent
        </button>
        </div>
      </Disclosure>
    </div>
  );
}
