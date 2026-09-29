import { describe, expect, it } from 'vitest';
import {
  buildMuseAniOneReviewEntry,
  normalizeOfficialSeriesTitle,
  officialSeriesTitleCandidates,
  parseOfficialChannelPlaylistsContinuation,
  parseOfficialChannelPlaylistsInitial,
} from '../server/ingestion/museAniOneOfficialReview.ts';
import type { CatalogueTitleRecord, OfficialPublisherSource } from '../server/ingestion/youtubeOfficialDiscovery.ts';

const source: OfficialPublisherSource = {
  id: 'muse-asia',
  kind: 'channel',
  publisher: 'Muse Asia',
  channelId: 'UCGbshtvS9t-8CW11W7TooQg',
  channelUrl: 'https://www.youtube.com/channel/UCGbshtvS9t-8CW11W7TooQg',
  evidenceUrls: ['https://www.e-muse.com/en/social-media/'],
  territoryNote: 'South and Southeast Asia.',
  defaultLanguage: 'sub',
  disposition: 'reference-only',
};

const catalogue: CatalogueTitleRecord[] = [{
  id: 12,
  sourceId: '900',
  slug: 'example-series-abc',
  name: 'Example Series',
  aliases: ['Example Series'],
  episodes: [{
    id: 34,
    sourceId: '456',
    numberText: '1',
    numberSort: 1,
    label: 'Episode 1',
    versions: [{ id: 56, sourceId: '456:sub', language: 'sub' }],
  }],
}];

describe('Muse/Ani-One official playlist review', () => {
  it('parses exact publisher playlist identities and continuation state', () => {
    const data = {
      metadata: { channelMetadataRenderer: { externalId: source.channelId, title: 'Muse Asia' } },
      contents: [{ gridPlaylistRenderer: {
        playlistId: 'PLwLSw1_eDZl2VQRIahDF73hnkdPjNRYnu',
        title: { runs: [{ text: 'Example Series [English Sub]' }] },
        videoCountText: { simpleText: '12 videos' },
      } }, { continuationItemRenderer: {
        continuationEndpoint: { continuationCommand: { token: 'next-page-token' } },
      } }],
    };
    const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script>
      <script>ytcfg.set({"INNERTUBE_API_KEY":"api-key","INNERTUBE_CLIENT_VERSION":"2.20260915.00.00","VISITOR_DATA":"visitor"});</script>`;
    const parsed = parseOfficialChannelPlaylistsInitial(html, source.channelId);
    expect(parsed.channelId).toBe(source.channelId);
    expect(parsed.playlists).toEqual([{
      playlistId: 'PLwLSw1_eDZl2VQRIahDF73hnkdPjNRYnu',
      title: 'Example Series [English Sub]',
      videoCount: 12,
    }]);
    expect(parsed.continuation).toBe('next-page-token');
    expect(parsed.session.visitorData).toBe('visitor');
  });

  it('parses modern playlist lockups in continuations', () => {
    const parsed = parseOfficialChannelPlaylistsContinuation({
      continuationContents: [{ lockupViewModel: {
        contentId: 'PLxSscENEp7Jj_DWMG7HGfaMhicOjAhih4',
        contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
        metadata: { lockupMetadataViewModel: { title: { content: 'Another Series [English Sub]' } } },
        badge: { thumbnailBadgeViewModel: { text: '13 videos' } },
      } }],
    });
    expect(parsed.playlists[0]).toMatchObject({
      playlistId: 'PLxSscENEp7Jj_DWMG7HGfaMhicOjAhih4',
      title: 'Another Series [English Sub]',
      videoCount: 13,
    });
  });

  it('proposes only exact, playable publisher episodes', () => {
    const entry = buildMuseAniOneReviewEntry({
      source,
      playlist: { playlistId: 'PLwLSw1_eDZl2VQRIahDF73hnkdPjNRYnu', title: 'Example Series [English Sub]', videoCount: 1 },
      video: {
        videoId: 'abcdefghijk', title: 'Example Series Episode 1 [English Sub]',
        channelId: source.channelId, channelLabel: 'Muse Asia', durationSeconds: 1_440,
        publishedText: null, playlistIndex: 1,
      },
      probe: {
        videoId: 'abcdefghijk', title: 'Example Series Episode 1 [English Sub]',
        channelId: source.channelId, channelLabel: 'Muse Asia', durationSeconds: 1_440,
        publishDate: '2026-09-15', availability: 'playable', playableInEmbed: true,
        reason: null, observedAt: '2026-09-15T00:00:00.000Z', observationRegion: 'US',
        availableCountries: ['SG', 'MY'],
      },
      catalogue,
    });
    expect(entry.disposition).toBe('proposal');
    expect(entry.identity).toMatchObject({ titleId: 12, episodeId: 34, versionId: 56, language: 'sub' });
    expect(entry.reasonCodes).toEqual([]);
  });

  it.each([
    ['Example Series Episode 1 [English Dub]', 'published-audio-language-catalogue-version-mismatch'],
    ['Example Series Episodes 1-3 Compilation', 'movie-recut-compilation-or-range'],
    ['Example Series Episode 1 ULTRA', 'membership-only'],
  ])('holds %s', (videoTitle, reason) => {
    const entry = buildMuseAniOneReviewEntry({
      source,
      playlist: { playlistId: 'PLwLSw1_eDZl2VQRIahDF73hnkdPjNRYnu', title: 'Example Series [English Sub]', videoCount: 1 },
      video: {
        videoId: 'abcdefghijk', title: videoTitle,
        channelId: source.channelId, channelLabel: 'Muse Asia', durationSeconds: 1_440,
        publishedText: null, playlistIndex: 1,
      },
      probe: {
        videoId: 'abcdefghijk', title: videoTitle,
        channelId: source.channelId, channelLabel: 'Muse Asia', durationSeconds: 1_440,
        publishDate: '2026-09-15', availability: 'playable', playableInEmbed: true,
        reason: null, observedAt: '2026-09-15T00:00:00.000Z', observationRegion: 'US', availableCountries: [],
      },
      catalogue,
    });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain(reason);
  });

  it('holds an otherwise exact episode when the observed egress is region-blocked', () => {
    const entry = buildMuseAniOneReviewEntry({
      source,
      playlist: { playlistId: 'PLwLSw1_eDZl2VQRIahDF73hnkdPjNRYnu', title: 'Example Series [English Sub]', videoCount: 1 },
      video: {
        videoId: 'abcdefghijk', title: 'Example Series Episode 1 [English Sub]',
        channelId: source.channelId, channelLabel: 'Muse Asia', durationSeconds: 1_440,
        publishedText: null, playlistIndex: 1,
      },
      probe: {
        videoId: 'abcdefghijk', title: null, channelId: null, channelLabel: null,
        durationSeconds: null, publishDate: null, availability: 'region-blocked', playableInEmbed: null,
        reason: 'The uploader has not made this video available in your country',
        observedAt: '2026-09-15T00:00:00.000Z', observationRegion: 'US', availableCountries: [],
      },
      catalogue,
    });
    expect(entry.disposition).toBe('hold');
    expect(entry.reasonCodes).toContain('region-blocked');
  });

  it('normalizes subtitle decoration without collapsing season identity', () => {
    expect(normalizeOfficialSeriesTitle('Example Series Season 2 [English Sub]')).toBe('example series season 2');
    expect(normalizeOfficialSeriesTitle('Example Series Season 3 [English Sub]')).not.toBe(
      normalizeOfficialSeriesTitle('Example Series Season 2 [English Sub]'),
    );
  });

  it('derives exact bilingual playlist title candidates without fuzzy matching', () => {
    expect(officialSeriesTitleCandidates('《Example Series》|《範例作品》【Ani-One Asia】')).toContain('example series');
    expect(officialSeriesTitleCandidates('Example Series | Sub Indo 【 Ani-One Indonesia 】')).toContain('example series');
  });
});
