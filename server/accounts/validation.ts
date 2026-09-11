import { AppError } from '../errors.ts';
export const AVATARS = ['ruby', 'ocean', 'violet', 'emerald', 'amber'] as const;
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function emailAddress(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(
      value.trim(),
    )
  )
    throw new AppError(400, 'BAD_REQUEST', 'Enter a valid email address.');
  return value.trim().toLowerCase();
}
export function profileInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || [...name].length > 32 || /[\u0000-\u001f\u007f]/.test(name))
    throw new AppError(400, 'BAD_REQUEST', 'Profile names must contain 1–32 characters.');
  const avatar = AVATARS.find((x) => x === body.avatar);
  if (!avatar) throw new AppError(400, 'BAD_REQUEST', 'Choose an available avatar.');
  return { name, avatar };
}
export function validateData(key: string, value: unknown) {
  if (key === 'preferences') {
    if (!object(value)) throw new AppError(400, 'BAD_REQUEST', 'Preferences must be an object.');
    return {
      theme: value.theme === 'light' ? 'light' : 'dark',
      accent:
        typeof value.accent === 'string' && /^#[\da-f]{6}$/i.test(value.accent)
          ? value.accent.toUpperCase()
          : '#E50914',
      preferredLanguage:
        typeof value.preferredLanguage === 'string' &&
        /^[a-z-]{2,20}$/.test(value.preferredLanguage)
          ? value.preferredLanguage
          : 'sub',
      autoplayNext: value.autoplayNext === true,
      rememberProgress: value.rememberProgress !== false,
    };
  }
  if (/^progress:[\w-]{1,100}:[a-z-]{2,20}:[\w:-]{1,100}$/.test(key)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 604800)
      throw new AppError(400, 'BAD_REQUEST', 'Invalid playback position.');
    return value;
  }
  const specs: Record<string, { max: number; fields: string[] }> = {
    'watchlist-records': { max: 1000, fields: ['id', 'slug', 'name'] },
    history: {
      max: 100,
      fields: ['titleId', 'slug', 'title', 'episodeId', 'episodeLabel', 'language', 'watchedAt'],
    },
    'watched-episodes': { max: 10000, fields: ['episodeId', 'language', 'watchedAt'] },
    'episode-comments': { max: 500, fields: ['id', 'episodeId', 'author', 'body', 'createdAt'] },
  };
  const spec = Object.hasOwn(specs, key) ? specs[key] : undefined;
  if (
    !spec ||
    !Array.isArray(value) ||
    value.length > spec.max ||
    !value.every(
      (item) =>
        object(item) &&
        spec.fields.every(
          (field) => typeof item[field] === 'string' && (item[field] as string).length <= 2000,
        ),
    )
  )
    throw new AppError(
      400,
      'BAD_REQUEST',
      'This profile collection is invalid or exceeds its limit.',
    );
  if (Buffer.byteLength(JSON.stringify(value)) > 192 * 1024)
    throw new AppError(413, 'BAD_REQUEST', 'This collection is too large.');
  return value;
}
