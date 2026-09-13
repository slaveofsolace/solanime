export const DEFAULT_ACCENT = '#EE791F';
export const ACCENT_PRESETS = [
  { name: 'Sol ember', value: DEFAULT_ACCENT },
  { name: 'Amber', value: '#F5A524' },
  { name: 'Jade', value: '#24BFA5' },
  { name: 'Sky', value: '#409CFF' },
  { name: 'Violet', value: '#A78BFA' },
  { name: 'Rose', value: '#F472B6' },
];
export function normalizeAccent(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : DEFAULT_ACCENT;
}
function channels(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}
function luminance(hex: string): number {
  const linear = channels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function contrast(a: string, b: string): number {
  const l = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (l[0] + 0.05) / (l[1] + 0.05);
}
function mix(color: string, target: string, amount: number): string {
  const a = channels(color),
    b = channels(target);
  return (
    '#' +
    a
      .map((value, index) =>
        Math.round(value + (b[index] - value) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}
/** Keep the exact chosen fill. Derive readable text/focus colors separately. */
export function themeTokens(accent: unknown, mode: 'dark' | 'light') {
  const fill = normalizeAccent(accent);
  const surfaces =
    mode === 'dark' ? ['#100F0D', '#191714', '#26221D'] : ['#F5EFE4', '#FFFAF1', '#E9DECE'];
  let ink = fill;
  for (let step = 0; step <= 100; step++) {
    ink = mix(fill, mode === 'dark' ? '#FFFFFF' : '#000000', step / 100);
    if (surfaces.every((surface) => contrast(ink, surface) >= 4.5)) break;
  }
  // The player stays dark even when the browsing interface uses a light theme.
  let playerInk = fill;
  for (let step = 0; step <= 100; step++) {
    playerInk = mix(fill, '#FFFFFF', step / 100);
    if (contrast(playerInk, '#2B2B2B') >= 4.5) break;
  }
  return {
    accent: fill,
    foreground: contrast(fill, '#FFFFFF') >= contrast(fill, '#000000') ? '#FFFFFF' : '#000000',
    ink,
    playerInk,
  };
}
export function applyTheme(accent: unknown, mode: 'dark' | 'light') {
  const values = themeTokens(accent, mode);
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.accent = values.accent;
  root.style.setProperty('--accent', values.accent);
  root.style.setProperty('--accent-ink', values.ink);
  root.style.setProperty('--on-accent', values.foreground);
  root.style.setProperty('--player-accent', values.playerInk);
}
