import {
  VIZ_MEDIA_PUBLISHER,
  VIZ_MEDIA_PUBLISHER_IDENTITY_URL,
} from '../../shared/youtubeOfficialPublishers.ts';
import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';

// VIZ Media publishes full subtitled episodes on its own official channel and
// documents the per-series playlists on its own site. That establishes the
// publisher identity only. Every row below must still be an individually
// reviewed crosswalk produced by `pnpm plan:youtube-official` against a
// completed discovery run and an immutable catalogue copy: exact channel ID,
// exact catalogue title/episode/version identity, full-episode duration,
// playable embed, and confirmed regional availability.
//
// This registry is intentionally empty. Do not hand-write rows, and do not add
// the `viz-reviewed-v1` playbackPolicies entry to
// `config/official-youtube-discovery.json` until this array is populated from
// planner output and the focused tests below pass. An empty registry enables
// nothing, which is the correct state before review.
//
// Publisher evidence: VIZ_MEDIA_PUBLISHER_IDENTITY_URL lists the series and
// episode counts VIZ states are available (Captain Tsubasa 52, Death Note 37,
// Hunter x Hunter 1-148, Inuyasha 193 incl. The Final Act, Mr. Osomatsu 1-50,
// Naruto 1-220, Ranma 1/2 1-161, Sailor Moon complete, Vampire Knight 26, plus
// the Naruto/Naruto Shippuden movies). Those are publisher claims about their
// own catalogue, not observed availability from any given region.
export const VIZ_OFFICIAL_YOUTUBE_EPISODE_APPROVALS: readonly OfficialYouTubeEpisodeApproval[] =
  Object.freeze([]);

export const VIZ_APPROVAL_PUBLISHER = VIZ_MEDIA_PUBLISHER;
export const VIZ_APPROVAL_PUBLISHER_IDENTITY_URL = VIZ_MEDIA_PUBLISHER_IDENTITY_URL;
