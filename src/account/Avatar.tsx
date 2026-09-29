import type { Profile } from './types';
export default function Avatar({
  profile,
  small = false,
}: {
  profile: Pick<Profile, 'avatar' | 'name'>;
  small?: boolean;
}) {
  const initials = profile.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase();
  return (
    <span
      className={`profile-avatar profile-avatar--${profile.avatar}${small ? ' profile-avatar--small' : ''}`}
      aria-hidden="true"
    >
      <span>{initials || 'S'}</span>
      <svg viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="64 30"
        />
      </svg>
    </span>
  );
}
