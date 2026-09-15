import {
  NOZOMI_CHANNEL_ID,
  NOZOMI_CHANNEL_URL,
  NOZOMI_PUBLISHER_EVIDENCE_URLS,
  NOZOMI_PUBLISHER_LABEL,
  type NozomiLanguage,
} from './youtubeOfficialNozomiReview.ts';

export type NozomiOfficialApprovalRow = readonly [
  approvalId: string,
  crosswalkId: string,
  titleId: number,
  titleSourceId: string,
  titleSlug: string,
  catalogueTitle: string,
  episodeId: number,
  episodeSourceId: string,
  episodeNumber: string,
  versionId: number,
  versionSourceId: string,
  language: NozomiLanguage,
  videoId: string,
  videoTitle: string,
  playerObservedAt: string,
  oEmbedCheckedAt: string,
  oEmbedAuthorName: string,
  oEmbedAuthorUrl: string,
  availableCountryCount: number,
  availableInUnitedStates: boolean,
  availableCountriesSha256: string,
];

export interface NozomiOfficialApprovalCandidate {
  approvalId: string;
  crosswalkId: string;
  state: 'explicit-review-pass-pending-integration';
  autoEnabled: false;
  publisher: {
    label: typeof NOZOMI_PUBLISHER_LABEL;
    channelId: typeof NOZOMI_CHANNEL_ID;
    channelUrl: typeof NOZOMI_CHANNEL_URL;
    evidenceUrls: readonly string[];
  };
  catalogue: {
    titleId: number;
    titleSourceId: string;
    titleSlug: string;
    title: string;
    episodeId: number;
    episodeSourceId: string;
    episodeNumber: string;
    versionId: number;
    versionSourceId: string;
    language: NozomiLanguage;
  };
  video: {
    id: string;
    title: string;
    watchUrl: string;
    embedUrl: string;
  };
  evidence: {
    playerObservedAt: string;
    playerAvailability: 'playable';
    playerPlayableInEmbed: true;
    oEmbedCheckedAt: string;
    oEmbedAuthorName: typeof NOZOMI_PUBLISHER_LABEL;
    oEmbedAuthorUrl: string;
    availableCountryCount: number;
    availableInUnitedStates: boolean;
    availableCountriesSha256: string;
  };
}

export const NOZOMI_OFFICIAL_REVIEW_PROVENANCE = {
  reportVersion: 1,
  reportGeneratedAt: "2026-09-15T19:45:42.576Z",
  reportSha256: "d75861b39f6a6234a028dfbe94f96d0a558202876d58586061b157739f430999",
  sourceInventoryCount: 1100,
  longFormEpisodeLabels: 754,
  staticallyExactEpisodeVersions: 649,
  playerProbes: 649,
  oEmbedChecks: 51,
  approvedCandidateCount: 51,
  excludedHoldCount: 703,
  observationRegion: "runtime-network",
  autoApplied: false,
} as const;

export const NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_ROWS = [
  ["nozomi-magic-users-club-tv-episode-1-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83192, "57346", "1", 106821, "57346:dub", "dub", "fwEUGPJ04XQ", "Magic User's Club Season 2 TV Episode 1 (Dub): Sae, the Magic Club, and the Cherry Blossom Tree", "2026-09-15T19:32:35.565Z", "2026-09-15T19:32:35.566Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-tv-episode-1-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83192, "57346", "1", 106820, "57346:sub", "sub", "VdjHcwvtdTI", "Magic User's Club Season 2 TV Episode 1 (Sub): Sae, the Magic Club, and the Cherry Blossom Tree", "2026-09-15T19:45:14.777Z", "2026-09-15T19:45:14.778Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-tv-episode-2-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83193, "57347", "2", 106823, "57347:dub", "dub", "-eUe4bv5ISg", "Magic User's Club Season 2 TV Episode 2 (Dub): Nanaka, a Cake, and a Dangerous Evening", "2026-09-15T19:31:33.761Z", "2026-09-15T19:31:33.762Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-tv-episode-3-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83194, "57348", "3", 106825, "57348:dub", "dub", "WmAuugCKrMA", "Magic User's Club Season 2 TV Episode 3 (Dub): Aburatsubo, Morning Glories, and...", "2026-09-15T19:45:21.133Z", "2026-09-15T19:45:21.133Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-3-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83194, "57348", "3", 106824, "57348:sub", "sub", "O5j5liwd55Q", "Magic User's Club Season 2 TV Episode 3 (Sub): Aburatsubo, Morning Glories, and...", "2026-09-15T19:44:37.784Z", "2026-09-15T19:44:37.785Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-4-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83195, "57349", "4", 106827, "57349:dub", "dub", "7Zj1HGc4B-U", "Magic User's Club Season 2 TV Episode 4 (Dub): Sae, the Bathroom, and the Other Side of the Door", "2026-09-15T19:31:58.286Z", "2026-09-15T19:31:58.287Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-4-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83195, "57349", "4", 106826, "57349:sub", "sub", "yQ9Wp4ogaR0", "Magic User's Club Season 2 TV Episode 4 (Sub): Sae, the Bathroom, and the Other Side of the Door", "2026-09-15T19:45:34.937Z", "2026-09-15T19:45:34.937Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-5-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83196, "57350", "5", 106829, "57350:dub", "dub", "92yzdtlGoJI", "Magic User's Club Season 2 TV Episode 5 (Dub): Akane, the Hiccups, and a Strange Relationship", "2026-09-15T19:32:02.268Z", "2026-09-15T19:32:02.269Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-5-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83196, "57350", "5", 106828, "57350:sub", "sub", "AzsLl0LaMRE", "Magic User's Club Season 2 TV Episode 5 (Sub): Akane, the Hiccups, and a Strange Relationship", "2026-09-15T19:32:10.603Z", "2026-09-15T19:32:10.603Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-6-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83197, "57351", "6", 106831, "57351:dub", "dub", "Yh2Q15Ga1Cc", "Magic User's Club Season 2 TV Episode 6 (Dub): Takakura, Origami, and the Secret Date", "2026-09-15T19:45:32.615Z", "2026-09-15T19:45:32.615Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-6-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83197, "57351", "6", 106830, "57351:sub", "sub", "Bu1xS6CwW6M", "Magic User's Club Season 2 TV Episode 6 (Sub): Takakura, Origami, and the Secret Date", "2026-09-15T19:32:15.602Z", "2026-09-15T19:32:15.603Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-7-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83198, "57352", "7", 106833, "57352:dub", "dub", "CoerLtWPQxs", "Magic User's Club Season 2 TV Episode 7 (Dub): Sae, a Tomato, and the Dance of the Paintbrush", "2026-09-15T19:32:18.407Z", "2026-09-15T19:32:18.408Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-7-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83198, "57352", "7", 106832, "57352:sub", "sub", "HAdX8TR_rYo", "Magic User's Club Season 2 TV Episode 7 (Sub): Sae, a Tomato, and the Dance of the Paintbrush", "2026-09-15T19:32:41.597Z", "2026-09-15T19:32:41.598Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-8-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83199, "57353", "8", 106835, "57353:dub", "dub", "_Wja7DmsIZ4", "Magic User's Club Season 2 TV Episode 8 (Dub): Alice, the Railroad Crossing, and Rice Crackers", "2026-09-15T19:31:32.019Z", "2026-09-15T19:31:32.019Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-8-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83199, "57353", "8", 106834, "57353:sub", "sub", "7GxOMbSwlxc", "Magic User's Club Season 2 TV Episode 8 (Sub): Alice, the Railroad Crossing, and Rice Crackers", "2026-09-15T19:31:56.623Z", "2026-09-15T19:31:56.624Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-9-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83200, "57354", "9", 106837, "57354:dub", "dub", "7P-WVWHx5cM", "Magic User's Club Season 2 TV Episode 9 (Dub): Long-Sleeved Kimonos, Shorts, and the Age of Joy", "2026-09-15T19:31:56.617Z", "2026-09-15T19:31:56.618Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-9-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83200, "57354", "9", 106836, "57354:sub", "sub", "aZteTAYHsaE", "Magic User's Club Season 2 TV Episode 9 (Sub): Long-Sleeved Kimonos, Shorts, and the Age of Joy", "2026-09-15T19:32:10.289Z", "2026-09-15T19:32:10.290Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-10-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83201, "57355", "10", 106839, "57355:dub", "dub", "pGC0WBflSLw", "Magic User's Club Season 2 TV Episode 10 (Dub): Snow, the Colt, and a First Kiss", "2026-09-15T19:44:45.480Z", "2026-09-15T19:44:45.480Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-10-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83201, "57355", "10", 106838, "57355:sub", "sub", "R_hTsCgwqTQ", "Magic User's Club Season 2 TV Episode 10 (Sub): Snow, the Colt, and a First Kiss", "2026-09-15T19:44:53.807Z", "2026-09-15T19:44:53.807Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-11-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83202, "57356", "11", 106841, "57356:dub", "dub", "oG2uS-s6rq0", "Magic User's Club Season 2 TV Episode 11 (Dub): Akane, the Mirror, and the End of the Year Sale", "2026-09-15T19:44:39.742Z", "2026-09-15T19:44:39.742Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-11-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83202, "57356", "11", 106840, "57356:sub", "sub", "WRGiKwosTeU", "Magic User's Club Season 2 TV Episode 11 (Sub): Akane, the Mirror, and the End of the Year Sale", "2026-09-15T19:45:23.387Z", "2026-09-15T19:45:23.388Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-12-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83203, "57357", "12", 106843, "57357:dub", "dub", "3MLt9sVs2Sc", "Magic User's Club Season 2 TV Episode 12 (Dub): The Octopus, a Flash of Lightning, and Micky", "2026-09-15T19:31:45.546Z", "2026-09-15T19:31:45.547Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-12-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83203, "57357", "12", 106842, "57357:sub", "sub", "8kOZlY_eASA", "Magic User's Club Season 2 TV Episode 12 (Sub): The Octopus, a Flash of Lightning, and Micky", "2026-09-15T19:32:00.278Z", "2026-09-15T19:32:00.279Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-13-dub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83204, "57358", "13", 106845, "57358:dub", "dub", "h795wCvJBdU", "Magic User's Club Season 2 TV Episode 13 (Dub): Sae's Magic, Sae's Feelings, Forever", "2026-09-15T19:32:41.266Z", "2026-09-15T19:32:41.266Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-tv-episode-13-sub", "magic-users-club-tv", 5675, "3400", "magic-user-s-club-oavsv", "Magic User's Club", 83204, "57358", "13", 106844, "57358:sub", "sub", "wRE62AzCQb4", "Magic User's Club Season 2 TV Episode 13 (Sub): Sae's Magic, Sae's Feelings, Forever", "2026-09-15T19:45:23.270Z", "2026-09-15T19:45:23.270Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-boogiepop-phantom-tv-episode-1-dub", "boogiepop-phantom-tv", 6510, "2540", "boogiepop-phantom-92c6a", "Boogiepop Phantom", 95395, "44348", "1", 123618, "44348:dub", "dub", "4d6fjMvAyMo", "Boogiepop Phantom HD Episode 1 (Dub): Portraits From Memory", "2026-09-15T19:31:47.222Z", "2026-09-15T19:31:47.222Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 3, true, "14398e95762ce8947d627c4bb75c538b579029dd563b0f034d4a55bcca91c286"],
  ["nozomi-el-hazard-magnificent-world-ova-episode-1-dub", "el-hazard-magnificent-world-ova", 7175, "1850", "el-hazard-the-magnificent-world-ppflw", "El Hazard: The Magnificent World", 105255, "34052", "1", 137336, "34052:dub", "dub", "1zCHJDaHYyk", "El-Hazard The Magnificent World HD Episode 1 (Dub) Battlefield of Confusion", "2026-09-15T19:31:40.383Z", "2026-09-15T19:31:40.384Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 4, true, "c084350c25b03aa41b772465cd87db447bfd39812549a114231ead5c5d2f7f33"],
  ["nozomi-magic-users-club-ova-episode-1-dub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107354, "31886", "1", 140242, "31886:dub", "dub", "fbddZquhGoE", "Magic User's Club Season 1 OVA Episode 1 (Dub): The Bell, Takakura, and Flying Magic", "2026-09-15T19:32:32.472Z", "2026-09-15T19:32:32.473Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-ova-episode-1-sub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107354, "31886", "1", 140241, "31886:sub", "sub", "EhtJvAzIhfw", "Magic User's Club Season 1 OVA Episode 1 (Sub): The Bell, Takakura, and Flying Magic", "2026-09-15T19:32:28.779Z", "2026-09-15T19:32:28.779Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-ova-episode-2-dub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107355, "31887", "2", 140244, "31887:dub", "dub", "bjmHv4XPKO4", "Magic User's Club Season 1 OVA Episode 2 (Dub): The Giant Top, Mistress Mizuha, and Failed Magic", "2026-09-15T19:32:13.424Z", "2026-09-15T19:32:13.425Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-ova-episode-2-sub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107355, "31887", "2", 140243, "31887:sub", "sub", "OagV-8YuST4", "Magic User's Club Season 1 OVA Episode 2 (Sub): The Giant Top, Mistress Mizuha, and Failed Magic", "2026-09-15T19:44:38.415Z", "2026-09-15T19:44:38.415Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-magic-users-club-ova-episode-3-dub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107356, "31888", "3", 140246, "31888:dub", "dub", "y2X4bp4gToQ", "Magic User's Club Season 1 OVA Episode 3 (Dub): The Whirligig, Akane, and Forbidden Magic", "2026-09-15T19:45:31.075Z", "2026-09-15T19:45:31.076Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-ova-episode-3-sub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107356, "31888", "3", 140245, "31888:sub", "sub", "aI3X8908K2A", "Magic User's Club Season 1 OVA Episode 3 (Sub): The Whirligig, Akane, and Forbidden Magic", "2026-09-15T19:32:07.983Z", "2026-09-15T19:32:07.984Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-ova-episode-4-dub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107357, "31889", "4", 140248, "31889:dub", "dub", "UouEMUggtlI", "Magic User's Club Season 1 OVA Episode 4 (Dub): The Sea, the Cave, and a Magic Party", "2026-09-15T19:45:11.281Z", "2026-09-15T19:45:11.282Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-ova-episode-5-dub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107358, "31890", "5", 140250, "31890:dub", "dub", "fFxYRZcnsyE", "Magic User's Club Season 1 OVA Episode 5 (Dub): Nanaka, Aburatsubo, and Confession Magic?", "2026-09-15T19:32:33.026Z", "2026-09-15T19:32:33.027Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-ova-episode-5-sub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107358, "31890", "5", 140249, "31890:sub", "sub", "6mEjQ2EB5CQ", "Magic User's Club Season 1 OVA Episode 5 (Sub): Nanaka, Aburatsubo, and Confession Magic?", "2026-09-15T19:31:53.567Z", "2026-09-15T19:31:53.567Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-ova-episode-6-dub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107359, "31891", "6", 140252, "31891:dub", "dub", "vUarRCtnihI", "Magic User's Club Season 1 OVA Episode 6 (Dub): Sae, Jeff, and the Big Spell", "2026-09-15T19:45:17.280Z", "2026-09-15T19:45:17.280Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-magic-users-club-ova-episode-6-sub", "magic-users-club-ova", 7340, "1677", "magic-user-s-club-ova-sgdtb", "Magic User's Club (OVA)", 107359, "31891", "6", 140251, "31891:sub", "sub", "iclKa89FSmU", "Magic User's Club Season 1 OVA Episode 6 (Sub): Sae, Jeff, and the Big Spell", "2026-09-15T19:32:49.113Z", "2026-09-15T19:32:49.113Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 249, true, "bad3b0ab6d1073f237d176df4d3ec9297269c1c13c73f714c0736a87912b1523"],
  ["nozomi-utena-tv-episode-1-sub", "utena-tv", 7658, "1345", "revolutionary-girl-utena-jgsvr", "Revolutionary Girl Utena", 113427, "23417", "1", 150661, "23417:sub", "sub", "HQxT6yOKzNY", "Revolutionary Girl Utena HD Episode 1 (Sub): The Rose Bride", "2026-09-15T19:32:44.963Z", "2026-09-15T19:32:44.963Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 4, true, "c084350c25b03aa41b772465cd87db447bfd39812549a114231ead5c5d2f7f33"],
  ["nozomi-nadesico-tv-episode-1-dub", "nadesico-tv", 8353, "631", "martian-successor-nadesico-mtaet", "Martian Successor Nadesico", 134708, "10923", "1", 183593, "10923:dub", "dub", "7Tx1DNg9320", "Martian Successor Nadesico HD Episode 1 (Dub): To Go \"Like a Man\"", "2026-09-15T19:31:57.945Z", "2026-09-15T19:31:57.945Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 8, true, "bd48684bdb7da26e510f97cb26ef045a2543b00ee1d83b7b89b899efbedf414c"],
  ["nozomi-junjo-romantica-s1-episode-8-sub", "junjo-romantica-s1", 8421, "561", "junjo-romantica-d7dvc", "Junjo Romantica", 126100, "9940", "8", 170603, "9940:sub", "sub", "CZbbIXSY73A", "Junjo Romantica Season 1 Episode 8 (Sub): Travelers Have No Need for Shame", "2026-09-15T19:32:21.099Z", "2026-09-15T19:32:21.099Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 5, true, "da44a0f77487e3dc9e99ae6e4937429044068641e8ddfb548516863e8e557fa5"],
  ["nozomi-junjo-romantica-s1-episode-9-sub", "junjo-romantica-s1", 8421, "561", "junjo-romantica-d7dvc", "Junjo Romantica", 126101, "9941", "9", 170604, "9941:sub", "sub", "9T78clSUVWE", "Junjo Romantica Season 1 Episode 9 (Sub): Tenderness Is Not Just for the Sake of Others", "2026-09-15T19:32:04.526Z", "2026-09-15T19:32:04.526Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 5, true, "da44a0f77487e3dc9e99ae6e4937429044068641e8ddfb548516863e8e557fa5"],
  ["nozomi-aria-animation-s1-episode-1-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126201, "9849", "1", 170791, "9849:sub", "sub", "y0sZ3-B5Phw", "ARIA The ANIMATION Season 1 Episode 1 (Sub): That Wonderful Miracle…", "2026-09-15T19:45:30.257Z", "2026-09-15T19:45:30.258Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-5-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126205, "9853", "5", 170799, "9853:sub", "sub", "3-2kS-Mr4lk", "ARIA The ANIMATION Season 1 Episode 5 (Sub): To That Island Which Shouldn't Exist...", "2026-09-15T19:31:42.941Z", "2026-09-15T19:31:42.942Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-7-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126207, "9855", "7", 170803, "9855:sub", "sub", "XIYD2-E-J1E", "ARIA The ANIMATION Season 1 Episode 7 (Sub): Doing That Wonderful Job...", "2026-09-15T19:45:27.657Z", "2026-09-15T19:45:27.657Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-8-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126208, "9856", "8", 170805, "9856:sub", "sub", "_nviGSrEomQ", "ARIA The ANIMATION Season 1 Episode 8 (Sub): That Melancholy President... / That Cool Hero...", "2026-09-15T19:31:30.172Z", "2026-09-15T19:31:30.173Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-9-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126209, "9857", "9", 170807, "9857:sub", "sub", "0ErJ3ejb2dI", "ARIA The ANIMATION Season 1 Episode 9 (Sub): That Starlike Fairy...", "2026-09-15T19:31:38.196Z", "2026-09-15T19:31:38.197Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-10-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126210, "9858", "10", 170809, "9858:sub", "sub", "hoT51D1z_6w", "ARIA The ANIMATION Season 1 Episode 10 (Sub): That Warm Holiday...", "2026-09-15T19:32:44.419Z", "2026-09-15T19:32:44.419Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-11-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126211, "9859", "11", 170811, "9859:sub", "sub", "VvhclsUNhJU", "ARIA The ANIMATION Season 1 Episode 11 (Sub): Those Orange Days...", "2026-09-15T19:45:17.701Z", "2026-09-15T19:45:17.701Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-12-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126212, "9860", "12", 170813, "9860:sub", "sub", "6UnwvZsl4h8", "ARIA The ANIMATION Season 1 Episode 12 (Sub): That Soft Wish...", "2026-09-15T19:31:54.959Z", "2026-09-15T19:31:54.960Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
  ["nozomi-aria-animation-s1-episode-13-sub", "aria-animation-s1", 8427, "557", "aria-the-animation-htdoq", "Aria the Animation", 126213, "9861", "13", 170815, "9861:sub", "sub", "tqKcAbUWN9Q", "ARIA The ANIMATION Season 1 Episode 13 (Sub): That White Morning...", "2026-09-15T19:45:05.205Z", "2026-09-15T19:45:05.205Z", "Nozomi Entertainment", "https://www.youtube.com/@nozomient", 2, true, "a8a05a36425ed8db846d67099db77f2066ded6ed149b08047c2c175525bfc06f"],
] as const satisfies readonly NozomiOfficialApprovalRow[];

export function materializeNozomiApprovalCandidates(
  rows: readonly NozomiOfficialApprovalRow[] = NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_ROWS,
): NozomiOfficialApprovalCandidate[] {
  const approvals: NozomiOfficialApprovalCandidate[] = rows.map((row) => {
    const [approvalId, crosswalkId, titleId, titleSourceId, titleSlug, catalogueTitle,
      episodeId, episodeSourceId, episodeNumber, versionId, versionSourceId, language,
      videoId, videoTitle, playerObservedAt, oEmbedCheckedAt, oEmbedAuthorName,
      oEmbedAuthorUrl, availableCountryCount, availableInUnitedStates, availableCountriesSha256] = row;
    return {
      approvalId,
      crosswalkId,
      state: 'explicit-review-pass-pending-integration' as const,
      autoEnabled: false as const,
      publisher: {
        label: NOZOMI_PUBLISHER_LABEL,
        channelId: NOZOMI_CHANNEL_ID,
        channelUrl: NOZOMI_CHANNEL_URL,
        evidenceUrls: NOZOMI_PUBLISHER_EVIDENCE_URLS,
      },
      catalogue: {
        titleId, titleSourceId, titleSlug, title: catalogueTitle, episodeId,
        episodeSourceId, episodeNumber, versionId, versionSourceId, language,
      },
      video: {
        id: videoId,
        title: videoTitle,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      },
      evidence: {
        playerObservedAt,
        playerAvailability: 'playable' as const,
        playerPlayableInEmbed: true as const,
        oEmbedCheckedAt,
        oEmbedAuthorName: oEmbedAuthorName as typeof NOZOMI_PUBLISHER_LABEL,
        oEmbedAuthorUrl,
        availableCountryCount,
        availableInUnitedStates,
        availableCountriesSha256,
      },
    };
  });
  validateNozomiApprovalCandidates(approvals);
  return approvals;
}

export function validateNozomiApprovalCandidates(candidates: readonly NozomiOfficialApprovalCandidate[]): void {
  const approvalIds = new Set<string>();
  const videoIds = new Set<string>();
  const versionIdentities = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.approvalId.startsWith('nozomi-') || approvalIds.has(candidate.approvalId)) throw new Error('NOZOMI_APPROVAL_ID_INVALID_OR_DUPLICATE');
    if (candidate.publisher.label !== NOZOMI_PUBLISHER_LABEL
      || candidate.publisher.channelId !== NOZOMI_CHANNEL_ID
      || candidate.publisher.channelUrl !== NOZOMI_CHANNEL_URL
      || candidate.publisher.evidenceUrls.join('|') !== NOZOMI_PUBLISHER_EVIDENCE_URLS.join('|'))
      throw new Error('NOZOMI_PUBLISHER_IDENTITY_MISMATCH');
    if (!/^[A-Za-z0-9_-]{11}$/.test(candidate.video.id) || videoIds.has(candidate.video.id)
      || candidate.video.watchUrl !== `https://www.youtube.com/watch?v=${candidate.video.id}`
      || candidate.video.embedUrl !== `https://www.youtube-nocookie.com/embed/${candidate.video.id}`)
      throw new Error('NOZOMI_VIDEO_IDENTITY_INVALID_OR_DUPLICATE');
    if (!Number.isSafeInteger(candidate.catalogue.titleId) || candidate.catalogue.titleId < 1
      || !Number.isSafeInteger(candidate.catalogue.episodeId) || candidate.catalogue.episodeId < 1
      || !Number.isSafeInteger(candidate.catalogue.versionId) || candidate.catalogue.versionId < 1
      || candidate.catalogue.versionSourceId !== `${candidate.catalogue.episodeSourceId}:${candidate.catalogue.language}`)
      throw new Error('NOZOMI_CATALOGUE_IDENTITY_INVALID');
    if (candidate.state !== 'explicit-review-pass-pending-integration' || candidate.autoEnabled !== false)
      throw new Error('NOZOMI_APPROVAL_STATE_INVALID');
    if (candidate.evidence.playerAvailability !== 'playable' || candidate.evidence.playerPlayableInEmbed !== true
      || candidate.evidence.oEmbedAuthorName !== NOZOMI_PUBLISHER_LABEL
      || candidate.evidence.oEmbedAuthorUrl !== 'https://www.youtube.com/@nozomient'
      || !Number.isFinite(Date.parse(candidate.evidence.playerObservedAt))
      || !Number.isFinite(Date.parse(candidate.evidence.oEmbedCheckedAt))
      || !Number.isSafeInteger(candidate.evidence.availableCountryCount)
      || candidate.evidence.availableCountryCount < 1
      || !/^[a-f0-9]{64}$/.test(candidate.evidence.availableCountriesSha256))
      throw new Error('NOZOMI_LIVE_EVIDENCE_INVALID');
    const versionIdentity = `${candidate.catalogue.titleSourceId}:${candidate.catalogue.versionSourceId}`;
    if (versionIdentities.has(versionIdentity)) throw new Error('NOZOMI_VERSION_IDENTITY_DUPLICATE');
    approvalIds.add(candidate.approvalId);
    videoIds.add(candidate.video.id);
    versionIdentities.add(versionIdentity);
  }
}

export const NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES = materializeNozomiApprovalCandidates();
