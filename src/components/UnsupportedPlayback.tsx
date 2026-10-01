import type { ProviderChoice } from '../types';
import Icon from './Icon';

function providerState(provider: ProviderChoice, rejectedMappingId?: string) {
  if (provider.status === 'blocked') return 'Blocked upstream';
  if (provider.status === 'unavailable') return 'Currently unavailable';
  if (provider.status === 'stale') return 'Being rechecked';
  if (provider.mappingId === rejectedMappingId) return 'Could not play this video';
  if (provider.supported && provider.status === 'available' && provider.kind === 'native')
    return 'Not tested yet';
  if (provider.playbackType === 'iframe') return 'Blocked for your safety';
  if (provider.playbackType === 'external') return 'Only plays on its own website';
  return 'Cannot play in Solanime';
}

interface UnsupportedPlaybackProps {
  providers: ProviderChoice[];
  selected?: ProviderChoice;
  artworkUrl?: string | null;
}

export default function UnsupportedPlayback({
  providers,
  selected,
  artworkUrl,
}: UnsupportedPlaybackProps) {
  const selectedWasRejected =
    selected?.supported &&
    selected.status === 'available';
  const mappedCount = providers.length;
  const nativeCount = providers.filter(
    (provider) =>
      provider.kind === 'native' && provider.supported && provider.status === 'available',
  ).length;
  const webpageOnlyCount = providers.filter(
    (provider) => provider.playbackType === 'external' || provider.playbackType === 'iframe',
  ).length;
  const mappedSummary = `${mappedCount} ${mappedCount === 1 ? 'source' : 'sources'} found${nativeCount ? ` · ${nativeCount} not tested yet` : ' · none playable here'}`;
  return (
    <section
      className={`unsupported-playback${artworkUrl ? ' unsupported-playback--artwork' : ''}`}
      aria-labelledby="unsupported-playback-title"
    >
      {artworkUrl && (
        <img
          className="unsupported-playback__artwork"
          src={artworkUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      <Icon name="unavailable" className="unsupported-playback__icon" />
      <div className="unsupported-playback__copy">
        <p className="unsupported-playback__eyebrow">
          {mappedCount > 0 ? mappedSummary : 'No sources yet'}
        </p>
        <h2 id="unsupported-playback-title">
          {selectedWasRejected
            ? 'This source cannot play here'
            : mappedCount > 0
              ? 'Not playable here yet'
              : 'No video for this episode yet'}
        </h2>
        <p>
          {mappedCount
            ? selectedWasRejected
              ? 'This source sent a video Solanime can’t play. Choose another source or episode.'
              : webpageOnlyCount === mappedCount
                ? 'The sources we found only play on their own websites, and we don’t open those inside Solanime for your safety.'
                : 'None of the sources we found can play in Solanime right now. Try another episode or check back later.'
            : 'We haven’t found a source for this episode yet. Try another episode or check back later.'}
        </p>
      </div>
      {mappedCount > 0 && (
        <details className="unsupported-playback__sources">
          <summary>Why each source is unavailable</summary>
          <ul aria-label="Sources checked for this episode">
            {providers.map((provider) => (
              <li key={provider.mappingId}>
                <strong>{provider.label}</strong>
                <span>{providerState(provider, selectedWasRejected ? selected.mappingId : undefined)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
