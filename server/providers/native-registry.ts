import type { StoredProviderMapping } from './contract.ts';
import { hasApprovedCommonsResource, resolveWikimediaCommons } from './commons.ts';
import {
  hasApprovedNativeResource,
  resolveInternetArchive,
  unsupportedNative,
  type ApprovedNativeResource,
} from './native.ts';

type MappingIdentity = Pick<StoredProviderMapping, 'mappingId' | 'providerId' | 'providerResourceId' | 'language'>;

// Stable canonical FMHY records from the reviewed 3e53fb2 research inventory.
// These links identify our implemented capability; source reviews cannot enable it.
export const NATIVE_RESEARCH_RECORDS: Readonly<Record<string, string>> = {
  'internet-archive': 'site-f1023afdb569da2f',
  'wikimedia-commons': 'site-43817f8d8c7ba5ba',
};

/** Every advertised native option passes its own adapter's exact approval gate. */
export function hasEnabledNativeResource(mapping: MappingIdentity, resource: ApprovedNativeResource | null | undefined) {
  return hasApprovedNativeResource(mapping, resource) || hasApprovedCommonsResource(mapping, resource);
}

export async function resolveApprovedNative(mapping: StoredProviderMapping, resource: ApprovedNativeResource | null | undefined, signal?: AbortSignal) {
  if (resource && mapping.providerId === 'internet-archive') return resolveInternetArchive(mapping, resource, signal);
  if (resource && mapping.providerId === 'wikimedia-commons') return resolveWikimediaCommons(mapping, resource, signal);
  return unsupportedNative(mapping);
}
