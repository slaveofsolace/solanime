export type ArtworkRole = 'poster' | 'backdrop';
export type ArtworkReuseStatus = 'reference-only' | 'permission-recorded' | 'public-domain' | 'unknown';

export interface VerifiedArtwork {
  url: string;
  width: number;
  height: number;
  role: ArtworkRole;
  source: 'anilist';
  sourceMediaId: number;
  sourcePageUrl: string;
  verifiedAt: string;
  contentSha256: string;
  reuseStatus: ArtworkReuseStatus;
  identityReview: 'manual-reviewed' | 'source-id-verified';
  freshness: 'verified' | 'last-known-good';
  lastCheckedAt: string;
}

/** Optional enrichment; the original imageUrl and catalogue identities are never replaced. */
export interface CatalogueArtwork {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  artwork?: { poster?: VerifiedArtwork; backdrop?: VerifiedArtwork };
}
