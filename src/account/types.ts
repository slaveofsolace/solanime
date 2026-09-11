export type Profile = {
  id: string;
  name: string;
  avatar: 'ruby' | 'ocean' | 'violet' | 'emerald' | 'amber';
};
export type Account = { id: string; email: string; emailVerified: boolean; createdAt: number };
export type SessionResponse = {
  account: Account | null;
  profiles: Profile[];
  csrfToken: string | null;
  registrationOpen: boolean;
  recoveryMethod: string;
  maxProfiles: number;
  recoveryCode?: string;
};
export type ProfileData = { values: Record<string, unknown>; revisions: Record<string, number> };
