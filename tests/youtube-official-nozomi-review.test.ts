import { describe, expect, it } from 'vitest';
import {
  NOZOMI_CHANNEL_ID,
  NOZOMI_PUBLISHER_LABEL,
  parseNozomiEpisodeTitle,
  reviewNozomiEpisode,
  type NozomiOEmbedObservation,
} from '../server/ingestion/youtubeOfficialNozomiReview.ts';
import type { CatalogueTitleRecord, ListedYouTubeVideo, YouTubeVideoProbe } from '../server/ingestion/youtubeOfficialDiscovery.ts';

const video: ListedYouTubeVideo = {
  videoId: 'HQxT6yOKzNY',
  title: 'Revolutionary Girl Utena HD Episode 1 (Sub): The Rose Bride',
  channelId: NOZOMI_CHANNEL_ID,
  channelLabel: NOZOMI_PUBLISHER_LABEL,
  durationSeconds: 1_407,
  publishedText: null,
  playlistIndex: 15,
};
const catalogue: CatalogueTitleRecord[] = [{
  id: 7658,
  sourceId: '1345',
  slug: 'revolutionary-girl-utena-jgsvr',
  name: 'Revolutionary Girl Utena',
  aliases: ['Revolutionary Girl Utena'],
  episodes: [{
    id: 113427,
    sourceId: '23417',
    numberText: '1',
    numberSort: 1,
    label: 'Episode 1',
    versions: [{ id: 150661, sourceId: '23417:sub', language: 'sub' }],
  }],
}];
const probe: YouTubeVideoProbe = {
  videoId: video.videoId,
  title: video.title,
  channelId: NOZOMI_CHANNEL_ID,
  channelLabel: NOZOMI_PUBLISHER_LABEL,
  durationSeconds: video.durationSeconds,
  publishDate: '2021-01-01',
  availability: 'playable',
  playableInEmbed: true,
  reason: null,
  observedAt: '2026-09-15T00:00:00.000Z',
  observationRegion: 'US',
  availableCountries: ['US'],
};
const oEmbed: NozomiOEmbedObservation = {
  result: 'standard-embed-returned',
  checkedAt: '2026-09-15T00:00:01.000Z',
  title: video.title,
  authorName: NOZOMI_PUBLISHER_LABEL,
  authorUrl: 'https://www.youtube.com/@NozomiEnt',
};

describe('Nozomi exact official episode review', () => {
  it('parses season, format, regular episode and explicit language independently', () => {
    expect(parseNozomiEpisodeTitle("Magic User's Club Season 1 OVA Episode 6 (Dub): Finale")).toMatchObject({
      seriesLabel: "Magic User's Club",
      season: 1,
      format: 'ova',
      episodeNumber: 6,
      language: 'dub',
    });
    expect(parseNozomiEpisodeTitle('Junjo Romantica Season 2 Episode 4 (Sub): Title')).toMatchObject({
      seriesLabel: 'Junjo Romantica',
      season: 2,
      format: 'unmarked',
      episodeNumber: 4,
      language: 'sub',
    });
  });

  it('rejects packs and episode ranges before crosswalk review', () => {
    expect(parseNozomiEpisodeTitle('Series Episodes 1-4 Compilation')).toBeNull();
    expect(parseNozomiEpisodeTitle('Series Episode 1-2 (Sub)')).toBeNull();
  });

  it('passes only the complete exact crosswalk, catalogue, player and oEmbed chain', () => {
    const entry = reviewNozomiEpisode({ video, catalogue, probe, oEmbed });
    expect(entry.disposition).toBe('pass');
    expect(entry.identity).toMatchObject({ titleId: 7658, episodeId: 113427, versionId: 150661, language: 'sub' });
    expect(entry.reasonCodes).toEqual([]);
  });

  it('holds an unmarked audio/subtitle language', () => {
    const entry = reviewNozomiEpisode({ video: { ...video, title: 'Sound of the Sky (Sora no Woto) Episode 1: Dawn' }, catalogue, probe, oEmbed });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain('audio-subtitle-language-unmarked');
  });

  it('holds Dirty Pair Flash because its source numbering spans three catalogue records', () => {
    const entry = reviewNozomiEpisode({ video: { ...video, title: 'Dirty Pair Flash Episode 7 (Sub): Trouble' }, catalogue, probe, oEmbed });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain('catalogue-segmentation-mismatch');
  });

  it.each([
    [{ ...probe, availability: 'region-blocked' as const, playableInEmbed: null }, 'region-blocked'],
    [{ ...probe, availability: 'embed-disabled' as const, playableInEmbed: false }, 'embed-disabled'],
    [{ ...probe, channelId: 'UC0000000000000000000000' }, 'player-publisher-channel-mismatch'],
  ])('holds a failed current player gate', (changedProbe, reason) => {
    const entry = reviewNozomiEpisode({ video, catalogue, probe: changedProbe, oEmbed });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain(reason);
  });

  it('holds an oEmbed publisher mismatch', () => {
    const entry = reviewNozomiEpisode({ video, catalogue, probe, oEmbed: { ...oEmbed, authorName: 'Another channel' } });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain('oembed-publisher-mismatch');
  });

  it('holds a stale crosswalk instead of falling back to fuzzy matching', () => {
    const entry = reviewNozomiEpisode({ video, catalogue: [], probe, oEmbed });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain('catalogue-title-crosswalk-stale');
    expect(entry.identity).toBeNull();
  });
});
