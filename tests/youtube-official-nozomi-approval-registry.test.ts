import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  NOZOMI_OFFICIAL_REVIEW_PROVENANCE,
  NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES,
  NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_ROWS,
  validateNozomiApprovalCandidates,
  type NozomiOfficialApprovalCandidate,
} from '../server/ingestion/youtubeOfficialNozomiApprovalRegistry.ts';
import {
  NOZOMI_CHANNEL_ID,
  NOZOMI_CHANNEL_URL,
  NOZOMI_PUBLISHER_LABEL,
} from '../server/ingestion/youtubeOfficialNozomiReview.ts';
import {
  NOZOMI_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
} from '../server/ingestion/youtubeOfficial.ts';
import {
  NOZOMI_PUBLISHER,
  NOZOMI_PUBLISHER_IDENTITY_URL,
  officialYouTubePublisherPolicyForChannel,
} from '../shared/youtubeOfficialPublishers.ts';

const EXPECTED_SERIES_BREAKDOWN = {
  'Aria the Animation|sub': ['1', '5', '7', '8', '9', '10', '11', '12', '13'],
  'Boogiepop Phantom|dub': ['1'],
  'El Hazard: The Magnificent World|dub': ['1'],
  'Junjo Romantica|sub': ['8', '9'],
  "Magic User's Club|dub": ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
  "Magic User's Club|sub": ['1', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
  "Magic User's Club (OVA)|dub": ['1', '2', '3', '4', '5', '6'],
  "Magic User's Club (OVA)|sub": ['1', '2', '3', '5', '6'],
  'Martian Successor Nadesico|dub': ['1'],
  'Revolutionary Girl Utena|sub': ['1'],
} as const;

function cloneCandidates(): NozomiOfficialApprovalCandidate[] {
  return structuredClone(NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES);
}

describe('Nozomi explicit official YouTube approval registry', () => {
  it('freezes the complete reviewed result and excludes every HOLD record', () => {
    expect(NOZOMI_OFFICIAL_REVIEW_PROVENANCE).toMatchObject({
      sourceInventoryCount: 1_100,
      longFormEpisodeLabels: 754,
      staticallyExactEpisodeVersions: 649,
      playerProbes: 649,
      oEmbedChecks: 51,
      approvedCandidateCount: 51,
      excludedHoldCount: 703,
      autoApplied: false,
    });
    expect(NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_ROWS).toHaveLength(51);
    expect(NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES).toHaveLength(51);
    expect(createHash('sha256').update(JSON.stringify(NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_ROWS)).digest('hex'))
      .toBe('85192cfd1570d86fe544385f78cfb0ddfd53c72cdcf1358a3cb7f553f7cb90e7');
  });

  it('contains only the exact reviewed series, language and episode crosswalks', () => {
    const actual: Record<string, string[]> = {};
    for (const candidate of NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES) {
      const key = `${candidate.catalogue.title}|${candidate.catalogue.language}`;
      (actual[key] ??= []).push(candidate.catalogue.episodeNumber);
    }
    expect(actual).toEqual(EXPECTED_SERIES_BREAKDOWN);
    expect(new Set(NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES.map((candidate) => candidate.catalogue.titleId)).size).toBe(8);
  });

  it('preserves exact catalogue, video, publisher and dated live-evidence identities', () => {
    const approvalIds = new Set<string>();
    const videoIds = new Set<string>();
    const versionIdentities = new Set<string>();

    for (const candidate of NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES) {
      expect(candidate.state).toBe('explicit-review-pass-pending-integration');
      expect(candidate.autoEnabled).toBe(false);
      expect(candidate.publisher).toMatchObject({
        label: NOZOMI_PUBLISHER_LABEL,
        channelId: NOZOMI_CHANNEL_ID,
        channelUrl: NOZOMI_CHANNEL_URL,
      });
      expect(candidate.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${candidate.video.id}`);
      expect(candidate.video.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${candidate.video.id}`);
      expect(candidate.catalogue.versionSourceId)
        .toBe(`${candidate.catalogue.episodeSourceId}:${candidate.catalogue.language}`);
      expect(candidate.evidence).toMatchObject({
        playerAvailability: 'playable',
        playerPlayableInEmbed: true,
        oEmbedAuthorName: NOZOMI_PUBLISHER_LABEL,
        oEmbedAuthorUrl: 'https://www.youtube.com/@nozomient',
      });
      expect(Number.isFinite(Date.parse(candidate.evidence.playerObservedAt))).toBe(true);
      expect(Number.isFinite(Date.parse(candidate.evidence.oEmbedCheckedAt))).toBe(true);
      expect(candidate.evidence.availableCountryCount).toBeGreaterThan(0);
      expect(candidate.evidence.availableCountriesSha256).toMatch(/^[a-f0-9]{64}$/);

      expect(approvalIds.has(candidate.approvalId)).toBe(false);
      expect(videoIds.has(candidate.video.id)).toBe(false);
      const versionIdentity = `${candidate.catalogue.titleSourceId}:${candidate.catalogue.versionSourceId}`;
      expect(versionIdentities.has(versionIdentity)).toBe(false);
      approvalIds.add(candidate.approvalId);
      videoIds.add(candidate.video.id);
      versionIdentities.add(versionIdentity);
    }
  });

  it('activates every strict candidate through the shared fail-closed publisher policy', () => {
    expect(officialYouTubePublisherPolicyForChannel(NOZOMI_PUBLISHER.channelId)).toMatchObject({
      id: 'nozomi-entertainment',
      identityUrl: NOZOMI_PUBLISHER_IDENTITY_URL,
      publisher: NOZOMI_PUBLISHER,
    });
    expect(NOZOMI_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(51);
    expect(new Set(NOZOMI_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.id))).toEqual(
      new Set(NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES.map((candidate) => candidate.approvalId)),
    );
    for (const approval of NOZOMI_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toContain(approval);
      expect(approval.video).toMatchObject({
        channelId: NOZOMI_PUBLISHER.channelId,
        channelUrl: NOZOMI_PUBLISHER.channelUrl,
        handleUrl: NOZOMI_PUBLISHER.handleUrl,
      });
      expect(approval.publisherIdentityUrl).toBe(NOZOMI_PUBLISHER_IDENTITY_URL);
      expect(approval.titleIdentityUrl).toBe(approval.video.watchUrl);
      expect(approval.episodeIdentityUrl).toBe(approval.video.watchUrl);
    }
  });

  it.each([
    ['duplicate approval identity', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[1].approvalId = candidates[0].approvalId;
    }, 'NOZOMI_APPROVAL_ID_INVALID_OR_DUPLICATE'],
    ['duplicate video identity', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[1].video = { ...candidates[1].video, ...candidates[0].video };
    }, 'NOZOMI_VIDEO_IDENTITY_INVALID_OR_DUPLICATE'],
    ['duplicate catalogue version identity', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[1].catalogue = { ...candidates[0].catalogue };
    }, 'NOZOMI_VERSION_IDENTITY_DUPLICATE'],
    ['wrong publisher channel', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[0].publisher.channelId = 'UC0000000000000000000000' as typeof NOZOMI_CHANNEL_ID;
    }, 'NOZOMI_PUBLISHER_IDENTITY_MISMATCH'],
    ['wrong catalogue language identity', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[0].catalogue.versionSourceId = 'wrong:sub';
    }, 'NOZOMI_CATALOGUE_IDENTITY_INVALID'],
    ['invalid player timestamp', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[0].evidence.playerObservedAt = 'not-a-date';
    }, 'NOZOMI_LIVE_EVIDENCE_INVALID'],
    ['wrong oEmbed author', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[0].evidence.oEmbedAuthorName = 'Another publisher' as typeof NOZOMI_PUBLISHER_LABEL;
    }, 'NOZOMI_LIVE_EVIDENCE_INVALID'],
    ['wrong oEmbed author URL', (candidates: NozomiOfficialApprovalCandidate[]) => {
      candidates[0].evidence.oEmbedAuthorUrl = 'https://www.youtube.com/@anotherpublisher';
    }, 'NOZOMI_LIVE_EVIDENCE_INVALID'],
  ] as const)('fails closed for %s', (_label, mutate, error) => {
    const candidates = cloneCandidates();
    mutate(candidates);
    expect(() => validateNozomiApprovalCandidates(candidates)).toThrow(error);
  });
});
