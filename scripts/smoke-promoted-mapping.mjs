const baseUrl = process.env.SOLANIME_BASE_URL ?? 'http://127.0.0.1:8791';
const baseOrigin = new URL(baseUrl).origin;

async function readJson(path, options) {
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options?.body ? { 'content-type': 'application/json' } : {}),
      ...(options?.body ? { origin: baseOrigin } : {}),
      ...options?.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const catalogue = await readJson('/api/titles?pageSize=20&facets=false');
const title = catalogue.items.find((item) => item.slug) ?? catalogue.items[0];
if (!title) throw new Error('No titles returned by catalogue API.');

const detail = await readJson(`/api/titles/${encodeURIComponent(title.slug)}`);
const episode = detail.episodes.find((item) => item.versions.some((version) => version.providerCount > 0));
if (!episode) throw new Error(`No mapped episode returned for ${title.slug}.`);
const version = episode.versions.find((item) => item.providerCount > 0);
const providers = await readJson(
  `/api/episodes/${encodeURIComponent(episode.id)}/providers?language=${encodeURIComponent(version.language)}`,
);
const provider = providers.providers.find((item) => item.supported && item.status === 'available');
if (!provider) throw new Error(`No supported provider returned for episode ${episode.id}.`);
const resolution = await readJson(`/api/providers/${encodeURIComponent(provider.mappingId)}/resolve`, {
  method: 'POST',
  body: JSON.stringify({ language: version.language }),
});

console.log(
  JSON.stringify(
    {
      baseUrl,
      title: { slug: title.slug, name: title.name },
      episode: { id: episode.id, label: episode.label, language: version.language },
      provider: {
        mappingId: provider.mappingId,
        providerId: provider.providerId,
        label: provider.label,
        kind: provider.kind,
        playbackType: provider.playbackType,
      },
      resolution: {
        status: resolution.status,
        playbackType: resolution.playbackType,
        delivery: resolution.delivery,
        embedUrl: resolution.embedUrl,
        allowedEmbedHosts: resolution.allowedEmbedHosts,
      },
    },
    null,
    2,
  ),
);
