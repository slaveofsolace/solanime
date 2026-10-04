import { MAL_STATUSES, type MalEntry, type MalStatus } from '../../shared/myanimelist';

const STATUS_NAMES: Record<string, MalStatus> = {
  watching: 'watching', completed: 'completed', 'on-hold': 'on_hold', 'on hold': 'on_hold', dropped: 'dropped',
  'plan to watch': 'plan_to_watch', '1': 'watching', '2': 'completed', '3': 'on_hold', '4': 'dropped', '6': 'plan_to_watch',
};

/** Reads MyAnimeList's own list export (Profile → Export, .xml or .xml.gz) in the browser. */
export async function readMalExport(file: File): Promise<{ username: string | null; entries: MalEntry[] }> {
  if (file.size > 40 * 1024 * 1024) throw new Error('That file is too large to be a MyAnimeList export.');
  let text: string;
  if (file.name.toLowerCase().endsWith('.gz')) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open .gz files. Extract the .xml first, then import it.');
    text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = await file.text();
  return parseMalExport(text);
}

export function parseMalExport(xml: string): { username: string | null; entries: MalEntry[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'myanimelist')
    throw new Error('This isn’t a MyAnimeList anime list export. On MyAnimeList, open Profile → Export and choose Anime List.');
  const text = (node: Element, name: string) => node.getElementsByTagName(name)[0]?.textContent?.trim() ?? '';
  const info = doc.getElementsByTagName('myinfo')[0];
  const username = info ? text(info, 'user_name') || null : null;
  if (info && text(info, 'user_export_type') && text(info, 'user_export_type') !== '1')
    throw new Error('This is a manga list export. Export your Anime List instead.');
  const entries: MalEntry[] = [];
  for (const node of Array.from(doc.getElementsByTagName('anime'))) {
    const id = Number(text(node, 'series_animedb_id'));
    const status = STATUS_NAMES[text(node, 'my_status').toLowerCase()];
    const title = text(node, 'series_title');
    if (!Number.isSafeInteger(id) || id < 1 || !status || !MAL_STATUSES.includes(status) || !title) continue;
    const score = Number(text(node, 'my_score')) || 0;
    const watched = Number(text(node, 'my_watched_episodes')) || 0;
    const total = Number(text(node, 'series_episodes')) || 0;
    entries.push({ id, title: title.slice(0, 1000), status, score: Math.max(0, Math.min(10, Math.round(score))), watchedEpisodes: Math.max(0, Math.round(watched)),
      totalEpisodes: total > 0 ? Math.round(total) : null, updatedAt: null });
  }
  if (!entries.length) throw new Error('No anime were found in this export file.');
  return { username, entries };
}
