import { describe, expect, it } from 'vitest';
import {
  DAILYMOTION_MAX_RESPONSE_BYTES,
  normalizeDailymotionGeoPolicy,
  verifyDailymotionPublicEmbed,
  type DailymotionPublicEmbedCandidate,
} from '../server/providers/dailymotionPublicEmbed.ts';

const candidate: DailymotionPublicEmbedCandidate = {
  videoId: 'x9example',
  expectedTitle: 'Publisher title · Episode 1',
  minimumDurationSeconds: 20 * 60,
  publisher: {
    ownerId: 'x3owner',
    name: 'Reviewed publisher',
    profileUrl: 'https://www.dailymotion.com/reviewedpublisher',
  },
};

function metadata(value: Record<string, unknown> = {}): Response {
  return Response.json({
    id: candidate.videoId,
    title: candidate.expectedTitle,
    duration: 24 * 60,
    allow_embed: true,
    url: `https://www.dailymotion.com/video/${candidate.videoId}`,
    published: true,
    status: 'published',
    owner: candidate.publisher.ownerId,
    'owner.screenname': candidate.publisher.name,
    'owner.url': candidate.publisher.profileUrl,
    geoblocking: ['allow'],
    ...value,
  });
}

function oEmbed(value: Record<string, unknown> = {}): Response {
  return Response.json({
    type: 'video',
    version: '1.0',
    provider_name: 'Dailymotion',
    provider_url: 'https://www.dailymotion.com',
    title: candidate.expectedTitle,
    author_name: candidate.publisher.name,
    author_url: candidate.publisher.profileUrl,
    html: `<iframe src="https://geo.dailymotion.com/player.html?video=${candidate.videoId}&amp;"></iframe>`,
    ...value,
  });
}

function sequence(...responses: Response[]) {
  const requests: URL[] = [];
  return {
    requests,
    fetcher: async (input: string | URL | Request) => {
      requests.push(new URL(String(input)));
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return response;
    },
  };
}

describe('Dailymotion public embed probe', () => {
  it('verifies exact public metadata and the documented oEmbed player without returning HTML', async () => {
    const run = sequence(metadata(), oEmbed());
    await expect(verifyDailymotionPublicEmbed(candidate, run.fetcher)).resolves.toEqual({
      kind: 'dailymotion-public-embed-candidate',
      videoId: candidate.videoId,
      watchUrl: `https://www.dailymotion.com/video/${candidate.videoId}`,
      title: candidate.expectedTitle,
      durationSeconds: 1440,
      publisher: candidate.publisher,
      geoPolicy: { mode: 'allow', countries: [], worldwide: true },
      embedOrigin: 'https://geo.dailymotion.com',
      embedPath: '/player.html',
    });
    expect(run.requests).toHaveLength(2);
    expect(run.requests[0].origin).toBe('https://api.dailymotion.com');
    expect(run.requests[0].pathname).toBe(`/video/${candidate.videoId}`);
    expect(run.requests[1].origin).toBe('https://www.dailymotion.com');
    expect(run.requests[1].searchParams.get('url')).toBe(
      `https://www.dailymotion.com/video/${candidate.videoId}`,
    );
  });

  it('fails closed on uploader, episode-duration, and embedding-policy mismatches', async () => {
    await expect(verifyDailymotionPublicEmbed(
      candidate,
      sequence(metadata({ 'owner.url': 'https://www.dailymotion.com/impostor' })).fetcher,
    )).rejects.toThrow('DAILYMOTION_METADATA_IDENTITY_MISMATCH');
    await expect(verifyDailymotionPublicEmbed(
      candidate,
      sequence(metadata({ duration: 1199 })).fetcher,
    )).rejects.toThrow('DAILYMOTION_DURATION_TOO_SHORT');
    await expect(verifyDailymotionPublicEmbed(
      candidate,
      sequence(metadata({ allow_embed: false })).fetcher,
    )).rejects.toThrow('DAILYMOTION_EMBED_DISABLED');
  });

  it('accepts documented regional policies and rejects malformed country lists', () => {
    expect(normalizeDailymotionGeoPolicy(['allow', 'us', 'ca'])).toEqual({
      mode: 'allow', countries: ['us', 'ca'], worldwide: false,
    });
    expect(normalizeDailymotionGeoPolicy(['deny', 'jp'])).toEqual({
      mode: 'deny', countries: ['jp'], worldwide: false,
    });
    expect(() => normalizeDailymotionGeoPolicy(['allow', 'usa'])).toThrow(
      'DAILYMOTION_INVALID_GEO_POLICY',
    );
  });

  it('rejects non-provider iframe hosts, wrong IDs, playlists, and duplicate frames', async () => {
    for (const html of [
      `<iframe src="https://example.com/player.html?video=${candidate.videoId}"></iframe>`,
      '<iframe src="https://geo.dailymotion.com/player.html?video=x9wrong"></iframe>',
      `<iframe src="https://geo.dailymotion.com/player.html?video=${candidate.videoId}&playlist=x1"></iframe>`,
      `<iframe src="https://geo.dailymotion.com/player.html?video=${candidate.videoId}"></iframe><iframe></iframe>`,
    ]) {
      await expect(verifyDailymotionPublicEmbed(
        candidate,
        sequence(metadata(), oEmbed({ html })).fetcher,
      )).rejects.toThrow('DAILYMOTION_INVALID_OEMBED_HTML');
    }
  });

  it('bounds provider responses before parsing', async () => {
    const oversized = new Response(new Uint8Array(DAILYMOTION_MAX_RESPONSE_BYTES + 1), {
      headers: { 'content-type': 'application/json' },
    });
    await expect(verifyDailymotionPublicEmbed(
      candidate,
      sequence(oversized).fetcher,
    )).rejects.toThrow('DAILYMOTION_METADATA_TOO_LARGE');
  });

  it('rejects non-JSON provider responses before parsing', async () => {
    await expect(verifyDailymotionPublicEmbed(
      candidate,
      sequence(new Response('{}', { headers: { 'content-type': 'text/html' } })).fetcher,
    )).rejects.toThrow('DAILYMOTION_METADATA_INVALID_CONTENT_TYPE');
  });
});
