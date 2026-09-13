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
  return (
    <section className="unsupported-playback" aria-labelledby="unsupported-playback-title">
      <Icon name="unavailable" className="unsupported-playback__icon" />
      <div className="unsupported-playback__copy">
        <p className="unsupported-playback__eyebrow">Playback status</p>
        <h2 id="unsupported-playback-title">
          {selectedWasRejected ? 'This source cannot play safely' : 'Not available in the Solanime player'}
        </h2>
        <p>
          {providers.length
            ? selectedWasRejected
              ? 'The selected source returned a format or origin the native player cannot safely use.'
              : 'Provider mappings are preserved for this episode, but none currently expose a supported native stream.'
            : 'No provider mapping has been observed for this episode yet.'}
        </p>
      </div>
      {providers.length > 0 && (
        <div className="unsupported-playback__sources">
          <p>Observed sources</p>
          <ul aria-label="Observed playback sources">
            {providers.map((provider) => (
              <li key={provider.mappingId}>
                <strong>{provider.label}</strong>
                <span>{providerState(provider, selectedWasRejected ? selected.mappingId : undefined)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
