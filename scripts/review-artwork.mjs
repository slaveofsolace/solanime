/** Optional visual-review inputs only. No private catalogue, auth or media access.
 * Stores public AniList identity/artwork outside the source/build asset pipeline.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const out = resolve(process.argv[2] ?? 'build/public-artwork-review');
const ids = [21, 11061, 1535, 5114, 16498, 21519, 113415, 154587];
const maxBytes = 8 * 1024 * 1024;
await mkdir(out, { recursive: true });
async function limited(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Public artwork request returned ${response.status}`);
  if (!response.body) throw new Error('Public response body unavailable');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new Error('Review asset exceeds size budget');
    chunks.push(chunk);
  }
  return { response, bytes: Buffer.concat(chunks) };
}
function assetMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
try {
  const { bytes } = await limited('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: `query { Page(perPage: 8) { media(id_in: [${ids}], type: ANIME) { id title { romaji english } format startDate { year } description(asHtml: false) bannerImage coverImage { extraLarge } genres } } }` }),
  });
  const result = JSON.parse(bytes.toString('utf8'));
  if (result.errors || !Array.isArray(result.data?.Page?.media)) throw new Error('Public metadata response unavailable');
  const items = [];
  for (const item of result.data.Page.media) {
    if (!ids.includes(item.id)) continue;
    const assets = {};
    for (const [kind, source] of [['poster', item.coverImage?.extraLarge], ['backdrop', item.bannerImage]]) {
      if (!source) continue;
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.hostname !== 's4.anilist.co' || url.username || url.password) continue;
      try {
        const { response, bytes: image } = await limited(source);
        const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (!/^image\/(jpeg|png|webp)$/.test(contentType) || assetMime(image) !== contentType) throw new Error('Artwork bytes do not match a supported image type');
        const filename = `${item.id}-${kind}.image`;
        await writeFile(resolve(out, filename), image);
        assets[kind] = { source, filename, contentType, sha256: createHash('sha256').update(image).digest('hex') };
      } catch (error) { console.error(`Artwork ${item.id}/${kind}: ${error.message}`); }
      await new Promise(done => setTimeout(done, 350));
    }
    if (assets.poster) items.push({ ...item, assets });
  }
  if (!items.length) throw new Error('No usable public artwork was collected; visual review is unavailable.');
  const manifest = { observedAt: new Date().toISOString(), source: 'https://graphql.anilist.co',
    scope: 'Public anime identities and artwork for isolated UI review; not the deployed Solanime catalogue or playback evidence.', items };
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`${items.length} public anime artwork records saved for isolated visual review.`);
} catch (error) {
  await writeFile(resolve(out, 'manifest.json'), JSON.stringify({ observedAt: new Date().toISOString(), items: [], error: error.message }, null, 2));
  console.error(error.message); process.exitCode = 1;
}
