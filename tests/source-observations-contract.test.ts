import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type ObservationSite = {
  id: string;
  coverage?: {
    platformTilesObserved?: number;
    serverChoicesExercised?: number;
    sourceOriginProgressVerified?: number;
    solanimeIntegrationsEnabled?: number;
  };
  episodeCoverage?: { importedIntoSolanime?: number };
  platformFilters?: unknown[];
  player?: {
    servers?: Array<{ state?: string; solanimeAdapter?: string }>;
  };
  playback?: { solanimeAdapter?: string };
};

type ObservationLedger = {
  reuseDisposition: string;
  redaction: string;
  sites: ObservationSite[];
  implementationContract: { playback: string; restrictions: string };
};

const ledger = JSON.parse(
  readFileSync('docs/source-observations/2026-09-12.json', 'utf8'),
) as ObservationLedger;

function collectObjectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

describe('dated source-observation publication boundary', () => {
  it('keeps catalogue platform filters separate from player-server evidence', () => {
    const cinejoy = ledger.sites.find((site) => site.id === 'cinejoy');
    expect(cinejoy).toBeDefined();
    expect(cinejoy?.platformFilters).toHaveLength(17);
    expect(cinejoy?.player?.servers).toHaveLength(8);
    expect(
      cinejoy?.player?.servers?.filter(
        (server) => server.state === 'media-progress-observed-on-source-origin',
      ),
    ).toHaveLength(2);
    expect(cinejoy?.coverage).toMatchObject({
      platformTilesObserved: 17,
      serverChoicesExercised: 8,
      sourceOriginProgressVerified: 2,
    });
  });

  it('cannot be interpreted as a released Solanime playback capability', () => {
    expect(ledger.reuseDisposition).toBe('HOLD');
    expect(ledger.sites.map((site) => site.id)).toEqual([
      'cinejoy',
      'movy',
      'bingebox',
      'popcornmovies',
    ]);

    for (const site of ledger.sites) {
      expect(site.coverage?.solanimeIntegrationsEnabled ?? 0).toBe(0);
      expect(site.episodeCoverage?.importedIntoSolanime ?? 0).toBe(0);
      expect(site.playback?.solanimeAdapter ?? 'not-implemented').toBe(
        'not-implemented',
      );
      for (const server of site.player?.servers ?? []) {
        expect(server.solanimeAdapter).toBe('not-implemented');
      }
    }

    expect(ledger.implementationContract.playback).toContain(
      'do not prove playback',
    );
    expect(ledger.implementationContract.restrictions).toContain(
      'No source advertising',
    );
    expect(ledger.implementationContract.restrictions).toContain(
      'API-key reuse',
    );
  });

  it('retains only descriptive sensitive-field names, not captured values or payloads', () => {
    expect(ledger.redaction).toContain('No cookies, credentials');
    expect(ledger.redaction).toContain('opaque resolver payloads');

    const forbiddenDataKeys = new Set([
      'apiKey',
      'api_key',
      'authorization',
      'cookie',
      'credentials',
      'opaquePayload',
      'password',
      'requestBody',
      'requestPayload',
      'responseBody',
      'responsePayload',
      'server_ids',
      'temporaryMediaUrl',
      'token',
    ]);
    expect(
      collectObjectKeys(ledger).filter((key) => forbiddenDataKeys.has(key)),
    ).toEqual([]);

    const serialized = JSON.stringify(ledger);
    expect(serialized).not.toMatch(/\bBearer\s+[A-Za-z0-9._~-]+/i);
    expect(serialized).not.toMatch(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/i);
    expect(serialized).not.toMatch(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/);
  });
});
