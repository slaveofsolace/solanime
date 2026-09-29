import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type SampleObservation = {
  videoId: string;
  title: string;
  durationSeconds: number;
  playableInEmbed: boolean | null;
  observedAt: string;
};

type CandidateSource = {
  id: string;
  evidenceSetId: string;
  publisher: string;
  kind: 'channel' | 'playlist';
  channelId: string;
  channelUrl: string;
  handle?: string;
  playlistId?: string;
  territories: string[];
  languages: string[];
  accessModel: string;
  fullEpisodeProgrammingObserved: boolean;
  enumerationStatus: string;
  embedStatus: string;
  sampleObservation?: SampleObservation;
  observationNote: string;
  disposition: 'reference-only';
};

type EvidenceSet = {
  id: string;
  operator: string;
  identityEvidenceUrls: string[];
  programmingEvidenceUrls: string[];
  basis: string;
  constraints: string;
};

type CandidateRegistry = {
  version: number;
  reviewedAt: string;
  observationRegion: string;
  status: string;
  knownNonclaims: string[];
  evidenceSets: EvidenceSet[];
  sources: CandidateSource[];
};

const registry = JSON.parse(readFileSync(new URL('../research/official-publisher-source-candidates.json', import.meta.url), 'utf8')) as CandidateRegistry;
const packageRegistry = JSON.parse(readFileSync(new URL('../research/official-publisher-source-candidate-package.resource-registry.json', import.meta.url), 'utf8')) as {
  schema_version: string;
  records: Array<{
    candidate_id: string;
    stage: string;
    recommendation: string;
    source: { local_path: string };
    known_nonclaims: string[];
  }>;
};
const channelId = /^UC[A-Za-z0-9_-]{22}$/;
const videoId = /^[A-Za-z0-9_-]{11}$/;
const playlistId = /^[A-Za-z0-9_-]{10,64}$/;

describe('official publisher source candidate registry', () => {
  it('contains at least 25 distinct full-episode source candidates across multiple independently evidenced networks', () => {
    expect(registry.version).toBe(1);
    expect(registry.status).toBe('candidate-review-only');
    expect(registry.sources.filter((source) => source.fullEpisodeProgrammingObserved)).toHaveLength(30);
    expect(registry.sources.length).toBeGreaterThanOrEqual(25);
    expect(new Set(registry.sources.map((source) => source.evidenceSetId)).size).toBeGreaterThanOrEqual(8);
  });

  it('pins canonical and unique channel identities, plus valid playlist identities where used', () => {
    expect(new Set(registry.sources.map((source) => source.id)).size).toBe(registry.sources.length);
    expect(new Set(registry.sources.map((source) => source.channelId)).size).toBe(registry.sources.length);
    for (const source of registry.sources) {
      expect(source.id).toMatch(/^[a-z0-9][a-z0-9-]{2,80}$/);
      expect(source.channelId).toMatch(channelId);
      expect(source.channelUrl).toBe(`https://www.youtube.com/channel/${source.channelId}`);
      if (source.kind === 'playlist') expect(source.playlistId).toMatch(playlistId);
      else expect(source.playlistId).toBeUndefined();
    }
  });

  it('requires publisher identity and programming evidence for every referenced source', () => {
    const evidence = new Map(registry.evidenceSets.map((entry) => [entry.id, entry]));
    expect(evidence.size).toBe(registry.evidenceSets.length);
    for (const source of registry.sources) {
      const entry = evidence.get(source.evidenceSetId);
      expect(entry, source.id).toBeDefined();
      expect(entry?.operator.trim()).toBeTruthy();
      expect(entry?.basis.length).toBeGreaterThan(40);
      expect(entry?.constraints.length).toBeGreaterThan(30);
      expect(entry?.identityEvidenceUrls.length).toBeGreaterThan(0);
      expect(entry?.programmingEvidenceUrls.length).toBeGreaterThan(0);
      for (const url of [...(entry?.identityEvidenceUrls ?? []), ...(entry?.programmingEvidenceUrls ?? [])]) {
        expect(new URL(url).protocol).toBe('https:');
      }
    }
  });

  it('records territory, access, enumeration, and embed limitations without implying approval', () => {
    for (const source of registry.sources) {
      expect(source.territories.length, source.id).toBeGreaterThan(0);
      expect(source.languages.length, source.id).toBeGreaterThan(0);
      expect(source.accessModel.length, source.id).toBeGreaterThan(10);
      expect(source.enumerationStatus.length, source.id).toBeGreaterThan(10);
      expect(source.embedStatus.length, source.id).toBeGreaterThan(10);
      expect(source.observationNote.length, source.id).toBeGreaterThan(30);
      expect(source.disposition).toBe('reference-only');
    }
    expect(registry.knownNonclaims.some((claim) => claim.includes('does not grant'))).toBe(true);
    expect(registry.knownNonclaims.some((claim) => claim.includes('No source') && claim.includes('enabled'))).toBe(true);
  });

  it('requires full-length, channel-bound observations before claiming an embed was playable', () => {
    const playable = registry.sources.filter((source) => source.embedStatus.includes('playable-observed'));
    expect(playable.length).toBeGreaterThanOrEqual(3);
    for (const source of playable) {
      expect(source.sampleObservation, source.id).toBeDefined();
      expect(source.sampleObservation?.videoId).toMatch(videoId);
      expect(source.sampleObservation?.durationSeconds).toBeGreaterThanOrEqual(900);
      expect(source.sampleObservation?.playableInEmbed).toBe(true);
    }
    for (const source of registry.sources.filter((entry) => entry.sampleObservation)) {
      expect(source.sampleObservation?.videoId).toMatch(videoId);
      expect(source.sampleObservation?.durationSeconds).toBeGreaterThanOrEqual(900);
      expect(source.sampleObservation?.observedAt).toBe(registry.reviewedAt);
    }
  });

  it('contains no playback activation, media URL, iframe payload, token, or approval fields', () => {
    const serialized = JSON.stringify(registry);
    expect(serialized).not.toMatch(/(?:googlevideo\.com|\.m3u8|signatureCipher|<iframe|accessToken|apiKey)/i);
    for (const source of registry.sources) {
      expect(source).not.toHaveProperty('adapter');
      expect(source).not.toHaveProperty('autoEnabled');
      expect(source).not.toHaveProperty('rightsApproved');
      expect(source).not.toHaveProperty('authoritativeMappings');
    }
  });

  it('keeps the package in a separate fail-closed resource review envelope', () => {
    expect(packageRegistry.schema_version).toBe('1.0');
    expect(packageRegistry.records).toHaveLength(1);
    expect(packageRegistry.records[0]).toMatchObject({
      candidate_id: 'solanime-official-publisher-source-candidates-2026-09-13',
      stage: 'discovered',
      recommendation: 'HOLD',
      source: { local_path: 'research\\official-publisher-source-candidates.json' },
    });
    expect(packageRegistry.records[0]?.known_nonclaims.some((claim) => claim.includes('does not prove license'))).toBe(true);
  });
});
