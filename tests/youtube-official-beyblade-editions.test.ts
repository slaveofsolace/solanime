import { describe, expect, it } from 'vitest';
import {
  BEYBLADE_DUTCH_EPISODE_APPROVALS,
  BEYBLADE_FRENCH_EPISODE_APPROVALS,
  BEYBLADE_GERMAN_EPISODE_APPROVALS,
  BEYBLADE_ITALIAN_EPISODE_APPROVALS,
  BEYBLADE_MULTILINGUAL_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  BEYBLADE_PORTUGUESE_BRAZIL_EPISODE_APPROVALS,
  BEYBLADE_SPANISH_EPISODE_APPROVALS,
} from '../server/ingestion/youtubeOfficialBeybladeEditionApprovals.ts';
import { officialYouTubePublisherPolicyForChannel } from '../shared/youtubeOfficialPublishers.ts';

describe('multilingual BEYBLADE official YouTube editions', () => {
  it('preserves 599 unique reviewed single-episode videos with a distinct locale and catalogue crosswalk', () => {
    expect(BEYBLADE_MULTILINGUAL_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(599);
    expect(new Set(BEYBLADE_MULTILINGUAL_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.id)).size).toBe(599);
    expect(new Set(BEYBLADE_MULTILINGUAL_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.video.id)).size).toBe(599);
    expect(new Set(BEYBLADE_MULTILINGUAL_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map(
      (approval) => `${approval.video.channelId}:${approval.catalogue.versionSourceId}`,
    )).size).toBe(599);
  });

  it('keeps the six audio editions separate while targeting the existing dub inventory', () => {
    const groups = [
      [BEYBLADE_FRENCH_EPISODE_APPROVALS, 'Français'],
      [BEYBLADE_GERMAN_EPISODE_APPROVALS, 'Deutsch'],
      [BEYBLADE_SPANISH_EPISODE_APPROVALS, 'Español latino'],
      [BEYBLADE_DUTCH_EPISODE_APPROVALS, 'Nederlands'],
      [BEYBLADE_PORTUGUESE_BRAZIL_EPISODE_APPROVALS, 'Português (Brasil)'],
      [BEYBLADE_ITALIAN_EPISODE_APPROVALS, 'Italiano'],
    ] as const;
    for (const [approvals, edition] of groups) {
      expect(approvals.length).toBeGreaterThan(0);
      for (const approval of approvals) {
        expect(approval.editionLabel).toBe(edition);
        expect(approval.catalogue.language).toBe('dub');
        expect(approval.catalogue.versionSourceId).toBe(`${approval.catalogue.episodeSourceId}:dub`);
        expect(officialYouTubePublisherPolicyForChannel(approval.video.channelId)?.publisher)
          .toMatchObject({ channelUrl: approval.video.channelUrl, handleUrl: approval.video.handleUrl });
      }
    }
  });
});
