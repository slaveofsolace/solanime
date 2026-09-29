export const MAL_STATUSES = ['watching', 'completed', 'plan_to_watch', 'on_hold', 'dropped'] as const;
export type MalStatus = typeof MAL_STATUSES[number];
export type MalEntry = { id: number; title: string; status: MalStatus; watchedEpisodes: number; totalEpisodes: number | null; score: number; updatedAt: string | null };
export const MAL_STATUS_LABELS: Record<MalStatus, string> = {
  watching: 'Watching', completed: 'Completed', plan_to_watch: 'Plan to watch', on_hold: 'On hold', dropped: 'Dropped',
};
export type MalConnection = { configured: boolean; connected: boolean; username?: string; importedAt?: number | null; count: number; syncing?: boolean };
