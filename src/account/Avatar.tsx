import type { Profile } from './types';
/** Original geometric avatar, shared by the picker and compact account navigation. */
export default function Avatar({
  profile,
  small = false,
}: {
  profile: Pick<Profile, 'avatar' | 'name'>;
  small?: boolean;
}) {
  return (
    <span
      className={`profile-avatar profile-avatar--${profile.avatar}${small ? ' profile-avatar--small' : ''}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" fill="none">
        <path
          d="M28 56c8 16 35 16 44 0"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path d="M30 34v5m40-5v5" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      </svg>
    </span>
  );
}
