import type { ProviderChoice } from '../types';
import Icon from './Icon';

function providerState(provider: ProviderChoice, rejectedMappingId?: string) {
  if (provider.status === 'blocked') return 'Blocked upstream';
  if (provider.status === 'unavailable') return 'Currently unavailable';
  if (provider.status === 'stale') return 'Needs re-verification';
  if (provider.mappingId === rejectedMappingId) return 'Selected response rejected';
  if (provider.supported && provider.status === 'available') return 'Native adapter available';
  if (provider.playbackType === 'external' || provider.playbackType === 'iframe') return 'Webpage-only source';
  return 'Observed, not natively playable';
}

interface UnsupportedPlaybackProps {
  providers: ProviderChoice[];
  selected?: ProviderChoice;
}

export default function UnsupportedPlayback({ providers, selected }: UnsupportedPlaybackProps) {
  const selectedWasRejected = selected?.supported && selected.status === 'available';
  const mappedCount = providers.length;
  const nativeCount = providers.filter(
    (provider) => provider.supported && provider.status === 'available',
  ).length;
  const webpageOnlyCount = providers.filter(
    (provider) => provider.playbackType === 'external' || provider.playbackType === 'iframe',
  ).length;
  const mappedSummary = `${mappedCount} ${mappedCount === 1 ? 'source' : 'sources'} mapped · ${nativeCount} native streams`;
  return (
    <section className="unsupported-playback" aria-labelledby="unsupported-playback-title">
      <Icon name="unavailable" className="unsupported-playback__icon" />
      <div className="unsupported-playback__copy">
        <p className="unsupported-playback__eyebrow">
          {mappedCount > 0 ? mappedSummary : 'No sources mapped'}
        </p>
        <h2 id="unsupported-playback-title">
          {selectedWasRejected
            ? 'This source cannot play here'
            : mappedCount > 0
              ? 'No in-player stream'
              : 'Playback not mapped yet'}
        </h2>
        <p>
          {mappedCount
            ? selectedWasRejected
              ? 'The selected provider returned a format or origin the Solanime player cannot use. Choose another source or episode.'
              : webpageOnlyCount === mappedCount
                ? 'These mappings lead to provider webpages or embeds, not a native video stream. Try another episode or check again after sources are refreshed.'
                : 'None of the mapped providers currently returns a supported native stream. Try another episode or check again after sources are refreshed.'
            : 'No provider mapping has been observed for this episode. Try another episode while synchronization continues.'}
        </p>
      </div>
      {mappedCount > 0 && (
        <details className="unsupported-playback__sources">
          <summary>Why each source is unavailable</summary>
          <ul aria-label="Observed playback sources">
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
