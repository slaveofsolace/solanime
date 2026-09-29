import { describe, expect, it } from 'vitest';
import { validateNativeObservation } from '../scripts/record-native-verification.ts';

const observed = { mappingId: 99, language: 'silent', evidenceRef: 'docs/test-evidence.md#native-playback', progressFrom: 2, progressTo: 12, duration: 100, seekFrom: 12, seekTo: 30, restoredTime: 30 };

describe('operator browser-observation input', () => {
  it('accepts measured values without pretending it ran the browser itself', () => {
    expect(validateNativeObservation(observed)).toEqual(observed);
  });
  it.each([null, [], {}, { ...observed, mappingId: 0 }, { ...observed, progressTo: 2 }, { ...observed, duration: 0 }, { ...observed, seekTo: 12 }, { ...observed, restoredTime: 101 }, { ...observed, progressFrom: NaN }, { ...observed, duration: Infinity }, { ...observed, evidenceRef: 'docs/../private.txt' }, { ...observed, evidenceRef: 'https://example.test/media?token=fixture' }])('rejects malformed or non-demonstrating values', value => {
    expect(() => validateNativeObservation(value)).toThrow();
  });
  it('does not retain extra URLs, credentials, or opaque capture fields', () => {
    expect(validateNativeObservation({ ...observed, currentSrc: 'https://example.test/temporary-media', capture: 'not retained' })).toEqual(observed);
  });
});
