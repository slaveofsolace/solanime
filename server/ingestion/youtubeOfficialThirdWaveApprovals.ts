import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';
import { REMOW_PUBLISHER, TMS_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

// Generated from the immutable v5 official-publisher review. The generator
// requires a unique catalogue crosswalk, exact series identity in a title-bearing
// segment, US availability, standard embed support, and one complete episode.
type ThirdWaveRow = readonly [episodeNumber: string, episodeSourceId: string, videoId: string, videoTitle: string, observedAt: string];
type Definition = Readonly<{ idPrefix: string; titleSourceId: string; titleSlug: string; language: 'sub' | 'dub'; publisher: typeof REMOW_PUBLISHER | typeof TMS_PUBLISHER; publisherIdentityUrl: string; titleIdentityUrl: string }>;

function buildApprovals(definition: Definition, rows: readonly ThirdWaveRow[]): readonly OfficialYouTubeEpisodeApproval[] {
  return Object.freeze(rows.map(([episodeNumber, episodeSourceId, videoId, videoTitle, observedAt]) => ({
    id: `${definition.idPrefix}-episode-${episodeNumber}`,
    catalogue: { source: 'anikoto' as const, titleSourceId: definition.titleSourceId, titleSlug: definition.titleSlug, episodeSourceId, episodeNumber, versionSourceId: `${episodeSourceId}:${definition.language}`, language: definition.language },
    video: { id: videoId, title: videoTitle, watchUrl: `https://www.youtube.com/watch?v=${videoId}`, channelId: definition.publisher.channelId, channelUrl: definition.publisher.channelUrl, handleUrl: definition.publisher.handleUrl },
    publisherIdentityUrl: definition.publisherIdentityUrl,
    titleIdentityUrl: definition.titleIdentityUrl,
    episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,
    observedAt,
  })));
}

const TMS_SONIC_X_DUB_ROWS = [
  ["1", "64113", "9CGih4gMRlk", "SONIC X - EP01 Chaos Control Freaks | English Dub | Full Episode", "2026-09-13T23:15:14.321Z"],
  ["2", "64114", "aBgPO32-ka0", "SONIC X - EP02 Sonic to the Rescue | English Dub | Full Episode", "2026-09-13T23:03:28.002Z"],
  ["3", "64115", "PzifMBqaEvU", "SONIC X - EP03 Missile Wrist Rampage | English Dub | Full Episode", "2026-09-13T23:17:48.998Z"],
  ["4", "64116", "BNi7ZoeJOOE", "SONIC X - EP04 Chaos Emerald Chaos | English Dub | Full Episode", "2026-09-13T23:16:27.209Z"],
  ["5", "64117", "qBsRxGQhDKs", "SONIC X - EP05 Cracking Knuckles | English Dub | Full Episode", "2026-09-13T23:15:21.163Z"],
  ["6", "64118", "ZDygQeO9jzo", "SONIC X - EP06 Techno Teacher | English Dub | Full Episode", "2026-09-13T23:14:17.766Z"],
  ["7", "64119", "7tB2LgOx8fA", "SONIC X - EP07 Party Hardly | English Dub | Full Episode", "2026-09-13T23:17:31.612Z"],
  ["8", "64120", "9KYeihPwS7Q", "SONIC X - EP08 Satellite Swindle | English Dub | Full Episode", "2026-09-13T23:04:39.917Z"],
  ["9", "64121", "ZcYxdLTcGvA", "SONIC X - EP09 The Last Resort | English Dub | Full Episode", "2026-09-13T23:13:37.199Z"],
  ["10", "64122", "VwYQ0DnPjWI", "SONIC X - EP10 Unfair Ball | English Dub | Full Episode", "2026-09-13T23:15:12.856Z"],
  ["12", "64124", "EbmRA75fF6Y", "SONIC X - EP12 Beating Eggman Part 1 | English Dub | Full Episode", "2026-09-13T23:17:03.391Z"],
  ["13", "64125", "WurTQwB-j-U", "SONIC X - EP13 Beating Eggman Part 2 | English Dub | Full Episode", "2026-09-13T23:06:00.282Z"],
  ["14", "64126", "uNqSxwLTjG4", "SONIC X - EP14 That's What Friends Are for | English Dub | Full Episode", "2026-09-13T23:18:17.684Z"],
  ["15", "64127", "w0uuhC6LlFM", "SONIC X - EP15 Skirmish in the Sky | English Dub | Full Episode", "2026-09-13T23:19:31.316Z"],
  ["16", "64128", "B_uTFBTNI7o", "SONIC X - EP16 Depth of Danger | English Dub | Full Episode", "2026-09-13T23:04:11.807Z"],
  ["17", "64129", "Vc1z6_nBWKA", "SONIC X - EP17 The Adventures of Knuckles and Hawk | English Dub | Full Episode", "2026-09-13T23:05:54.894Z"],
  ["18", "64130", "hnUYv2VhcY8", "SONIC X - EP18 The Dam Scam | English Dub | Full Episode", "2026-09-13T23:18:01.413Z"],
  ["19", "64131", "cE7WXrzkKrI", "SONIC X - EP19 Sonic's Scream Test | English Dub | Full Episode", "2026-09-13T23:09:28.364Z"],
  ["20", "64132", "c8W-VVZtiyk", "SONIC X - EP20 Cruise Blues | English Dub | Full Episode", "2026-09-13T23:13:06.673Z"],
  ["21", "64133", "z8QGrmRQsqw", "SONIC X - EP21 Fast Friends | English Dub | Full Episode", "2026-09-13T23:08:03.792Z"],
  ["22", "64134", "nMJG40ht_sw", "SONIC X - EP22 Little Chao Lost | English Dub | Full Episode", "2026-09-13T23:17:10.136Z"],
  ["23", "64135", "1TAE09a_nwE", "SONIC X - EP23 Emerald Anniversary | English Dub | Full Episode", "2026-09-13T23:11:39.336Z"],
  ["24", "64136", "039J77RlR5M", "SONIC X - EP24 How to Catch a Hedgehog | English Dub | Full Episode", "2026-09-13T23:11:36.262Z"],
  ["25", "64137", "gyUnw0KCDT0", "SONIC X - EP25 A Dastardly Deed | English Dub | Full Episode", "2026-09-13T23:05:32.379Z"],
  ["26", "64138", "Lj6TQAJaj4s", "SONIC X - EP26 Countdown to Chaos | English Dub | Full Episode", "2026-09-13T23:07:52.920Z"],
  ["27", "64139", "WkRmNHUgIVk", "SONIC X - EP27 Pure Chaos | English Dub | Full Episode", "2026-09-13T23:10:31.199Z"],
  ["28", "64140", "PnDHLNS58FY", "SONIC X - EP28 A Chaotic Day | English Dub | Full Episode", "2026-09-13T23:03:59.072Z"],
  ["29", "64141", "gbn7h1VqKIU", "SONIC X - EP29 A Robot Rebels | English Dub | Full Episode", "2026-09-13T23:04:08.932Z"],
  ["30", "64142", "V26oyi5GDVw", "SONIC X - EP30 Head's up, Tail | English Dub | Full Episode", "2026-09-13T23:16:55.580Z"],
  ["31", "64143", "kEOn7Y6wE5c", "SONIC X - EP31 Revenge of the Robot | English Dub | Full Episode", "2026-09-13T23:13:17.039Z"],
  ["32", "64144", "OwYJkhG6xNc", "SONIC X - EP32 Flood Fight | English Dub | Full Episode", "2026-09-13T23:06:51.225Z"],
  ["33", "64145", "eqyhH0FaBgc", "SONIC X - EP33 Project Shadow | English Dub | Full Episode", "2026-09-13T23:16:23.013Z"],
  ["34", "64146", "NqrXRFdb684", "SONIC X - EP34 Shadow Knows | English Dub | Full Episode", "2026-09-13T23:04:46.605Z"],
  ["35", "64147", "NEypfVRripI", "SONIC X - EP35 Sonic's Big Break | English Dub | Full Episode", "2026-09-13T23:11:15.785Z"],
  ["36", "64148", "CoDKAOsd7Uc", "SONIC X - EP36 Shadow World | English Dub | Full Episode", "2026-09-13T23:18:24.173Z"],
  ["37", "64149", "pR7I8loqsC8", "SONIC X - EP37 Robotnik's Revenge | English Dub | Full Episode", "2026-09-13T23:07:13.985Z"],
  ["39", "64151", "s32IbFff9i0", "SONIC X - EP39 Defective Detectives | English Dub | Full Episode", "2026-09-13T23:13:22.353Z"],
  ["40", "64152", "XliSh3Ar0AQ", "SONIC X - EP40 Sunblock Solution | English Dub | Full Episode", "2026-09-13T23:07:42.090Z"],
  ["41", "64153", "vIz7_2tjcOU", "SONIC X - EP41 Eggman for President | English Dub | Full Episode", "2026-09-13T23:03:33.534Z"],
  ["42", "64154", "2M9mpXbnK30", "SONIC X - EP42 A Robot Rebels | English Dub | Full Episode", "2026-09-13T23:19:12.476Z"],
  ["43", "64155", "GxZnyfL9xFw", "SONIC X - EP43 Mean Machines | English Dub | Full Episode", "2026-09-13T23:13:55.961Z"],
  ["44", "64156", "Gb7GBxRTRr0", "SONIC X - EP44 Sewer Search | English Dub | Full Episode", "2026-09-13T23:08:08.901Z"],
  ["45", "64157", "fQXfRxizraE", "SONIC X - EP45 Prize Fights | English Dub | Full Episode", "2026-09-13T23:03:29.593Z"],
  ["46", "64158", "b-qHbNGKnYE", "SONIC X - EP46 A Wild Win | English Dub | Full Episode", "2026-09-13T23:10:04.584Z"],
  ["47", "64159", "AcYkCcRdCLo", "SONIC X - EP47 Map of Mayhem | English Dub | Full Episode", "2026-09-13T23:16:49.837Z"],
  ["48", "64160", "bmjLqrc8ugQ", "SONIC X - EP48 The Volcanic Venture | English Dub | Full Episode", "2026-09-13T23:06:52.815Z"],
  ["49", "64161", "rpb3jpNSyDI", "SONIC X - EP49 The Beginning of the End | English Dub | Full Episode", "2026-09-13T23:05:50.898Z"],
  ["50", "64162", "-INdp_kaWAc", "SONIC X - EP50 Running out of Time | English Dub | Full Episode", "2026-09-13T23:11:29.077Z"],
  ["51", "64163", "bAo4Tiifwjk", "SONIC X - EP51 Friends 'Til the End | English Dub | Full Episode", "2026-09-13T23:18:59.083Z"],
  ["52", "64164", "qAtidd45kzI", "SONIC X - EP52 A New Start | English Dub | Full Episode", "2026-09-13T23:13:19.965Z"],
  ["53", "64165", "7blfEcxZ_U8", "SONIC X - EP 53 A Cosmic Call | English Dub | Full Episode", "2026-09-13T23:06:03.016Z"],
  ["54", "64166", "30b-BHrYDms", "SONIC X - EP 54 Cosmic Crisis | English Dub | Full Episode", "2026-09-13T23:06:55.259Z"],
  ["55", "64167", "a8QEVZIFypY", "SONIC X - EP 55 H2 Whoa | English Dub | Full Episode", "2026-09-13T23:14:53.938Z"],
  ["56", "64168", "S6TgUS3H7M8", "SONIC X - EP 56 An Enemy in Need | English Dub | Full Episode", "2026-09-13T23:15:09.042Z"],
  ["57", "64169", "0T_If4pEFRc", "SONIC X - EP 57 Chilling Discovery | English Dub | Full Episode", "2026-09-13T23:16:17.661Z"],
  ["58", "64170", "yCAwN9HPSlY", "SONIC X - EP 58 Desperately Seeking Sonic | English Dub | Full Episode", "2026-09-13T23:14:00.074Z"],
  ["59", "64171", "lBH6JASM4dk", "SONIC X - EP 59 Galactic Gumshoes | English Dub | Full Episode", "2026-09-13T23:05:10.500Z"],
  ["60", "64172", "-b2KKXXHJPs", "SONIC X - EP 60 Trick Sand | English Dub | Full Episode", "2026-09-13T23:05:42.931Z"],
  ["61", "64173", "SKHF26ZySME", "SONIC X - EP 61 Ship of Doom | English Dub | Full Episode", "2026-09-13T23:06:09.729Z"],
  ["62", "64174", "_KiEP2atRwU", "SONIC X - EP 62 An Underground Odyssey | English Dub | Full Episode", "2026-09-13T23:11:10.353Z"],
  ["63", "64175", "N9nr9uqgN9I", "SONIC X - EP 63 Station Break-In | English Dub | Full Episode", "2026-09-13T23:12:27.474Z"],
  ["64", "64176", "hq9LlgTLmP0", "SONIC X - EP 64 A Materex Melee | English Dub | Full Episode", "2026-09-13T23:09:32.165Z"],
  ["65", "64177", "uv3Jdfkymc8", "SONIC X - EP 65 Mission: Match Up | English Dub | Full Episode", "2026-09-13T23:14:36.374Z"],
  ["66", "64178", "We3UBNdfbnM", "SONIC X - EP 66 Clash in the Cloister | English Dub | Full Episode", "2026-09-13T23:13:47.887Z"],
  ["67", "64179", "8ykblfGXgcI", "SONIC X - EP 67 Testing Time | English Dub | Full Episode", "2026-09-13T23:05:08.194Z"],
  ["68", "64180", "CL9tRwaOIzU", "SONIC X - EP 68 A Revolutionary Tale | English Dub | Full Episode", "2026-09-13T23:15:37.488Z"],
  ["69", "64181", "QbzRj1lHeP8", "SONIC X - EP 69 The Planet of Misfortune | English Dub | Full Episode", "2026-09-13T23:17:08.663Z"],
  ["70", "64182", "1pZpQ9lfrJA", "SONIC X - EP 70 Terror On the Typhoon | English Dub | Full Episode", "2026-09-13T23:16:56.549Z"],
  ["71", "64183", "SOHgRGpqd8Y", "SONIC X - EP 71 Hedgehog Hunt | English Dub | Full Episode", "2026-09-13T23:04:19.758Z"],
  ["72", "64184", "0LGDfZngevs", "SONIC X - EP 72 Zelkova Strikes Back | English Dub | Full Episode", "2026-09-13T23:05:36.245Z"],
  ["73", "64185", "CkI-2j6V7sQ", "SONIC X - EP 73 The Cosmo Conspiracy | English Dub | Full Episode", "2026-09-13T23:13:46.678Z"],
  ["75", "64187", "MRPAoi0PjU8", "SONIC X - EP 75 Agent of Mischief | English Dub | Full Episode", "2026-09-13T23:10:28.754Z"],
  ["76", "64188", "7lTR0Ys6k7o", "SONIC X - EP 76 The Light in the Darkness | English Dub | Full Episode", "2026-09-13T23:05:13.267Z"],
  ["77", "64189", "rU_nFxK4iek", "SONIC X - EP 77 A Fearless Friend | English Dub | Full Episode", "2026-09-13T23:17:00.680Z"],
  ["78", "64190", "WszPVaOgfR8", "SONIC X - EP 78 So Long Sonic | English Dub | Full Episode", "2026-09-13T23:08:07.864Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_SONIC_X_DUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-sonic-x-dub",
  titleSourceId: "3848",
  titleSlug: "sonic-x-hnkvr",
  language: "dub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_SONIC_X_DUB_ROWS);

const TMS_SONIC_X_SUB_ROWS = [
  ["51", "64163", "SjGwAZYedE4", "Sonic X Ep51 - Japanese (English Subtitled)", "2026-09-13T23:05:29.431Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_SONIC_X_SUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-sonic-x-sub",
  titleSourceId: "3848",
  titleSlug: "sonic-x-hnkvr",
  language: "sub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_SONIC_X_SUB_ROWS);

const TMS_ROSE_OF_VERSAILLES_ROWS = [
  ["1", "24627", "5KJSOa0vcpc", "Oscar! The Destiny of the Rose | Lady Oscar: The Rose of Versailles - EP01 | English Sub", "2026-09-13T23:11:59.072Z"],
  ["2", "24628", "p_0HiC6CeMc", "Fly! The Butterfly of Austria | Lady Oscar: The Rose of Versailles - EP02 | English Sub", "2026-09-13T23:04:04.950Z"],
  ["4", "24630", "8bKXJdnjqOA", "Roses, Wine and the Conspiracy… | Lady Oscar: The Rose of Versailles - EP04 | English Sub", "2026-09-13T23:13:49.353Z"],
  ["5", "24631", "vL0bgHF0m2U", "With Tears of Dignity… | Lady Oscar: The Rose of Versailles - EP05 | English Sub", "2026-09-13T23:13:13.056Z"],
  ["6", "24632", "r9TVwx_JUDc", "The Silk Dress and the Ragged Dress | Lady Oscar: The Rose of Versailles - EP06 | English Sub", "2026-09-13T23:13:29.096Z"],
  ["7", "24633", "hAnMiX0AFGo", "Who Wrote the Love Letter | Lady Oscar: The Rose of Versailles - EP07 | English Sub", "2026-09-13T23:08:58.695Z"],
  ["8", "24634", "v2Fx3jg48Z4", "Oscar in My Heart | Lady Oscar: The Rose of Versailles - EP08 | English Sub", "2026-09-13T23:04:47.753Z"],
  ["9", "24635", "tE0J14jfhyU", "The Sun Sets, the Sun Rises | Lady Oscar: The Rose of Versailles - EP09 | English Sub", "2026-09-13T23:04:14.279Z"],
  ["10", "24636", "LhMfXjd0oHM", "The Beautiful Devil, Jeanne | Lady Oscar: The Rose of Versailles - EP10 | English Sub", "2026-09-13T23:17:26.283Z"],
  ["11", "24637", "PZCC-3v81r4", "Fersen Leaves for the Northern Lands | Lady Oscar: The Rose of Versailles - EP11 | English Sub", "2026-09-13T23:13:21.054Z"],
  ["12", "24638", "x3yvHaY3ABY", "On the Morning of the Duel, Will Oscar…? | Lady Oscar: The Rose of Versailles - EP12 | English Sub", "2026-09-13T23:04:43.933Z"],
  ["13", "24639", "eXHXhpkW7mA", "Winds of Arras, Answer Me… | Lady Oscar: The Rose of Versailles - EP13 | English Sub", "2026-09-13T23:12:28.687Z"],
  ["14", "24640", "0SsEQvZz08E", "The Angel's Secret | Lady Oscar: The Rose of Versailles - EP14 | English Sub", "2026-09-13T23:14:28.199Z"],
  ["15", "24641", "nlUvu7ghQNA", "The Countess of the Casino | Lady Oscar: The Rose of Versailles - EP15 | English Sub", "2026-09-13T23:09:36.125Z"],
  ["16", "24642", "wRS7uMA_dkU", "Mother, Her Name is...? | Lady Oscar: The Rose of Versailles - EP16 | English Sub", "2026-09-13T23:05:47.016Z"],
  ["17", "24643", "C-yWxQeOxdM", "Now, the Moment of Encounter | Lady Oscar: The Rose of Versailles - EP17 | English Sub", "2026-09-13T23:18:15.048Z"],
  ["18", "24644", "EOlEYMJYo5M", "Suddenly, Like Icarus | Lady Oscar: The Rose of Versailles - EP18 | English Sub", "2026-09-13T23:10:39.487Z"],
  ["19", "24645", "UYxoEBTP9cs", "Farewell, Little Sister! | Lady Oscar: The Rose of Versailles - EP19 | English Sub", "2026-09-13T23:11:26.528Z"],
  ["20", "24646", "CUnU5Jl14Ck", "Fersen, a Farewell Rondeau | Lady Oscar: The Rose of Versailles - EP20 | English Sub", "2026-09-13T23:19:08.641Z"],
  ["21", "24647", "ck61iEePN1s", "The Black Rose Blooms at Night | Lady Oscar: The Rose of Versailles - EP21 | English Sub", "2026-09-13T23:04:12.948Z"],
  ["22", "24648", "4mM_rdVpjtc", "The Necklace Shines Ominously | Lady Oscar: The Rose of Versailles - EP22 | English Sub", "2026-09-13T23:08:54.792Z"],
  ["23", "24649", "PfIwo3O-GaA", "Cunningly and Resiliently! | Lady Oscar: The Rose of Versailles - EP23 | English Sub", "2026-09-13T23:06:36.362Z"],
  ["24", "24650", "wVozSnHq8_o", "Adieu, My Youth | Lady Oscar: The Rose of Versailles - EP24 | English Sub", "2026-09-13T23:17:23.505Z"],
  ["25", "24651", "xySePbwWISo", "Minuet of the Unrequited | Lady Oscar: The Rose of Versailles - EP25 | English Sub", "2026-09-13T23:17:42.306Z"],
  ["26", "24652", "UwZjQx11Tm8", "A Sought Encounter with the Black Knight | Lady Oscar: The Rose of Versailles - EP26 | English Sub", "2026-09-13T23:06:04.285Z"],
  ["27", "24653", "H2Cb79vdFj8", "Even if I should Lose the Light | Lady Oscar: The Rose of Versailles - EP27 | English Sub", "2026-09-13T23:19:29.975Z"],
  ["28", "24654", "cjYxZ3tbC_8", "André, a Green Lemon | Lady Oscar: The Rose of Versailles - EP28 | English Sub", "2026-09-13T23:07:49.051Z"],
  ["29", "24655", "vr4IpQ3ecFw", "The Doll that Began to Walk | Lady Oscar: The Rose of Versailles - EP29 | English Sub", "2026-09-13T23:06:12.330Z"],
  ["30", "24656", "7xZn2K7hzyE", "You are the Light, I am the Shadow | Lady Oscar: The Rose of Versailles - EP30 | English Sub", "2026-09-13T23:18:40.161Z"],
  ["31", "24657", "tfY6nCZbsng", "A Lilac Blooming in the Barracks | Lady Oscar: The Rose of Versailles - EP31 | English Sub", "2026-09-13T23:13:02.143Z"],
  ["32", "24658", "L0YRBreKdNM", "Prelude to the Storm | Lady Oscar: The Rose of Versailles - EP32 | English Sub", "2026-09-13T23:10:51.375Z"],
  ["34", "24660", "bbgJkcBM7uw", "Now, the Moment of Encounter | Lady Oscar: The Rose of Versailles - EP34 | English Sub", "2026-09-13T23:08:38.943Z"],
  ["35", "24661", "LwOX6-BU4_o", "“Now, ‘The Tennis Court Oath' | Lady Oscar: The Rose of Versailles - EP35 | English Sub", "2026-09-13T23:15:15.582Z"],
  ["36", "24662", "YjBnhBPxbhA", "The Watchword is ‘Au Revoir’ | Lady Oscar: The Rose of Versailles - EP36 | English Sub", "2026-09-13T23:18:21.598Z"],
  ["37", "24663", "AAkXPbDT_W8", "On the Night of Their Passionate Vows | Lady Oscar: The Rose of Versailles - EP37 | English Sub", "2026-09-13T23:06:35.268Z"],
  ["38", "24664", "id_7igI_ce4", "Before the Door of Fate | Lady Oscar: The Rose of Versailles - EP38 | English Sub", "2026-09-13T23:19:06.922Z"],
  ["39", "24665", "Clw1r-TOYE8", "His Smile is Lost Forever! | Lady Oscar: The Rose of Versailles - EP39 | English Sub", "2026-09-13T23:13:26.626Z"],
  ["40", "24666", "uiSjgAcJBPw", "Adieu, My Beloved Oscar | Lady Oscar: The Rose of Versailles - EP40 | English Sub", "2026-09-13T23:09:22.990Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_ROSE_OF_VERSAILLES_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-rose-of-versailles",
  titleSourceId: "1409",
  titleSlug: "the-rose-of-versailles-23fba",
  language: "sub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_ROSE_OF_VERSAILLES_ROWS);

const TMS_DEVIL_LADY_DUB_ROWS = [
  ["1", "61173", "Jg2gJ3zKN3s", "Go Nagai's \"The Devil Lady\" - EP01 Beast | English Dub | Full Episode", "2026-09-13T23:09:01.263Z"],
  ["2", "61174", "Ygsl3lE1Kcs", "Go Nagai's \"The Devil Lady\" - EP02 Blood | English Dub | Full Episode", "2026-09-13T23:08:49.211Z"],
  ["3", "61175", "FmWPyVO_xNo", "Go Nagai's \"The Devil Lady\" - EP03 Wings | English Dub | Full Episode", "2026-09-13T23:17:47.630Z"],
  ["4", "61176", "u1oqypcgX_c", "Go Nagai's \"The Devil Lady\" - EP04 Embryo | English Dub | Full Episode", "2026-09-13T23:13:23.877Z"],
  ["5", "61177", "_EmIc_9Zkhk", "Go Nagai's \"The Devil Lady\" - EP05 Shark | English Dub | Full Episode", "2026-09-13T23:12:52.859Z"],
  ["6", "61178", "XpQSVoFkfbg", "Go Nagai's \"The Devil Lady\" - EP06 Cat | English Dub | Full Episode", "2026-09-13T23:13:34.565Z"],
  ["7", "61179", "AA10o7001jY", "Go Nagai's \"The Devil Lady\" - EP07 Fog | English Dub | Full Episode", "2026-09-13T23:18:41.507Z"],
  ["8", "61180", "N6gjGi8SfmA", "Go Nagai's \"The Devil Lady\" - EP08 Enemy | English Dub | Full Episode", "2026-09-13T23:12:47.726Z"],
  ["9", "61181", "Ig_W-JdwRok", "Go Nagai's \"The Devil Lady\" - EP09 Eyes | English Dub | Full Episode", "2026-09-13T23:06:19.015Z"],
  ["10", "61182", "exXOEz_ZHeQ", "Go Nagai's \"The Devil Lady\" - EP10 Flames | English Dub | Full Episode", "2026-09-13T23:11:03.671Z"],
  ["11", "61183", "kP51hHUoKg8", "Go Nagai's \"The Devil Lady\" - EP11 Box | English Dub | Full Episode", "2026-09-13T23:16:37.802Z"],
  ["12", "61184", "gMD00NuwQzk", "Go Nagai's \"The Devil Lady\" - EP12 Faces | English Dub | Full Episode", "2026-09-13T23:04:27.750Z"],
  ["13", "61185", "VJ-4_xXuaG4", "Go Nagai's \"The Devil Lady\" - EP13 Rope | English Dub | Full Episode", "2026-09-13T23:11:41.549Z"],
  ["14", "61186", "FECygPlX5zI", "Go Nagai's \"The Devil Lady\" - EP14 Home | English Dub | Full Episode", "2026-09-13T23:12:09.902Z"],
  ["15", "61187", "bGn0BLrvdwg", "Go Nagai's \"The Devil Lady\" - EP15 Crows | English Dub | Full Episode", "2026-09-13T23:18:33.583Z"],
  ["16", "61188", "iD6bp8fmeGA", "Go Nagai's \"The Devil Lady\" - EP16 Voice | English Dub | Full Episode", "2026-09-13T23:13:01.093Z"],
  ["17", "61189", "hF0ExzXhy78", "Go Nagai's \"The Devil Lady\" - EP17 Hunger | English Dub | Full Episode", "2026-09-13T23:04:23.712Z"],
  ["18", "61190", "nsZnNi1EEKo", "Go Nagai's \"The Devil Lady\" - EP18 Body | English Dub | Full Episode", "2026-09-13T23:10:20.824Z"],
  ["19", "61191", "bjfP3TKRVVw", "Go Nagai's \"The Devil Lady\" - EP19 Shakles | English Dub | Full Episode", "2026-09-13T23:10:35.339Z"],
  ["20", "61192", "Srh-mhT-mdI", "Go Nagai's \"The Devil Lady\" - EP20 Corpses | English Dub | Full Episode", "2026-09-13T23:12:32.555Z"],
  ["21", "61193", "9O_cNGkJEk4", "Go Nagai's \"The Devil Lady\" - EP21 Signs | English Dub | Full Episode", "2026-09-13T23:08:46.688Z"],
  ["22", "61194", "rgAdeKyUKgI", "Go Nagai's \"The Devil Lady\" - EP22 Wish | English Dub | Full Episode", "2026-09-13T23:04:31.844Z"],
  ["23", "61195", "SqphATiHgnQ", "Go Nagai's \"The Devil Lady\" - EP23 Life | English Dub | Full Episode", "2026-09-13T23:18:37.598Z"],
  ["24", "61196", "OpC6xWRITqg", "Go Nagai's \"The Devil Lady\" - EP24 Heart | English Dub | Full Episode", "2026-09-13T23:08:19.761Z"],
  ["25", "61197", "yWjQgNAf8Y8", "Go Nagai's \"The Devil Lady\" - EP25 God | English Dub | Full Episode", "2026-09-13T23:03:50.799Z"],
  ["26", "61198", "qOwZVw35ODI", "Go Nagai's \"The Devil Lady\" - EP26 Man | English Dub | Full Episode", "2026-09-13T23:04:29.053Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_DEVIL_LADY_DUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-devil-lady-dub",
  titleSourceId: "3684",
  titleSlug: "the-devil-lady-lysyk",
  language: "dub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_DEVIL_LADY_DUB_ROWS);

const TMS_MAGIC_KNIGHT_RAYEARTH_DUB_ROWS = [
  ["1", "2622", "eutBzS30qhM", "MAGIC KNIGHT RAYEARTH - EP01 The Birth of the Legendary Magic Knights! | English Dub", "2026-09-13T23:18:29.612Z"],
  ["2", "2623", "GhybZYP8KrA", "MAGIC KNIGHT RAYEARTH - EP02 Presea, The Master Smith In The Forest Of Silence | English Dub", "2026-09-13T23:13:28.046Z"],
  ["3", "2624", "o668yHA9E4M", "MAGIC KNIGHT RAYEARTH - EP03 Ferio, the Handsome, Mysterious Swordsman | English Dub", "2026-09-13T23:14:26.995Z"],
  ["4", "2625", "QwVyKWVRQNE", "MAGIC KNIGHT RAYEARTH - EP04 Alcyone, the Vengeful Sorceress | English Dub", "2026-09-13T23:06:23.227Z"],
  ["5", "2626", "Wo3q2svkKvI", "MAGIC KNIGHT RAYEARTH - EP05 Escudo, the Legendary Ore | English Dub", "2026-09-13T23:04:34.356Z"],
  ["6", "2627", "6dK-554U-Rs", "MAGIC KNIGHT RAYEARTH - EP06 Lives at Stake - Presea's Weapons | English Dub", "2026-09-13T23:09:14.720Z"],
  ["7", "2628", "E6R2j2cablI", "MAGIC KNIGHT RAYEARTH - EP07 Ferio in Desperation - A Romance in the Desert | English Dub", "2026-09-13T23:18:28.134Z"],
  ["8", "2629", "xpWDVjpQ-lw", "MAGIC KNIGHT RAYEARTH - EP08 The Horrible Trap of Summoner Ascot | English Dub", "2026-09-13T23:09:50.907Z"],
  ["9", "2630", "K_NuYOEVU20", "MAGIC KNIGHT RAYEARTH - EP09 The Magic Knights' Greatest Crisis | English Dub", "2026-09-13T23:15:58.652Z"],
  ["10", "2631", "wWIkLCQohqM", "MAGIC KNIGHT RAYEARTH - EP10 Revival of Selece, the Legendary Rune-God | English Dub", "2026-09-13T23:09:20.286Z"],
  ["11", "2632", "2GNwAR5UvT4", "MAGIC KNIGHT RAYEARTH - EP11 The Legend of the Rune-Gods - In Cephiro, Another World | English Dub", "2026-09-13T23:09:56.388Z"],
  ["12", "2633", "12BbwAur5n4", "MAGIC KNIGHT RAYEARTH - EP12 The Fearsome Illusionist Caldina | English Dub", "2026-09-13T23:13:45.365Z"],
  ["13", "2634", "bTa7Wlw8NHI", "MAGIC KNIGHT RAYEARTH - EP13 The Most Valuable Thing in this World | English Dub", "2026-09-13T23:05:44.198Z"],
  ["14", "2635", "hqk4w7ZumYU", "MAGIC KNIGHT RAYEARTH - EP14 Hikaru, Umi, and Fuu's Unyielding Wish | English Dub", "2026-09-13T23:15:20.217Z"],
  ["15", "2636", "5zHrefGARYA", "MAGIC KNIGHT RAYEARTH - EP15 The Second Rune-God: Windam, the Lord of the Skies | English Dub", "2026-09-13T23:07:45.000Z"],
  ["16", "2637", "WnJb9n_LKgU", "MAGIC KNIGHT RAYEARTH - EP16 A Powerful Foe! Lafarga the Swordmaster | English Dub", "2026-09-13T23:07:00.792Z"],
  ["17", "2638", "GfRk75E7-d0", "MAGIC KNIGHT RAYEARTH - EP17 The Truth About Inouva, and the Return of Memories | English Dub", "2026-09-13T23:06:41.804Z"],
  ["18", "2639", "uZLKqE2w0tA", "MAGIC KNIGHT RAYEARTH - EP18 The Last Rune-God: Rayearth, the Lord of Fire | English Dub", "2026-09-13T23:18:09.492Z"],
  ["19", "2640", "ZVrKwddgRbI", "MAGIC KNIGHT RAYEARTH - EP19 Showdown! The Magic Knights Versus Zagato | English Dub", "2026-09-13T23:08:11.670Z"],
  ["20", "2641", "IN2J49YgecM", "MAGIC KNIGHT RAYEARTH - EP20 The Unbelievable Truth About the Legendary Magic Knights! | English Dub", "2026-09-13T23:18:11.984Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_MAGIC_KNIGHT_RAYEARTH_DUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-magic-knight-rayearth-dub",
  titleSourceId: "141",
  titleSlug: "magic-knight-rayearth-3xnrr",
  language: "dub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_MAGIC_KNIGHT_RAYEARTH_DUB_ROWS);

const TMS_CYBERSIX_DUB_ROWS = [
  ["1", "32854", "nHlhHImKxyE", "CYBERSIX - EP01 The Mysterious Shadow | English Dub | Full Episode", "2026-09-13T23:16:12.279Z"],
  ["2", "32855", "qPxN2Zw-5yQ", "CYBERSIX - EP02 Data 7 & Julian | English Dub | Full Episode", "2026-09-13T23:08:04.979Z"],
  ["3", "32856", "TgWQ8hHReHg", "CYBERSIX - EP03 Terra | English Dub | Full Episode", "2026-09-13T23:11:43.259Z"],
  ["4", "32857", "YtkXdSNHpbQ", "CYBERSIX - EP04 Yashimoto, Private Eye | English Dub | Full Episode", "2026-09-13T23:16:29.663Z"],
  ["5", "32858", "-bOm04p_OxY", "CYBERSIX - EP05 Lori is Missing | English Dub | Full Episode", "2026-09-13T23:17:43.642Z"],
  ["6", "32859", "GAOntNveMKI", "CYBERSIX - EP06 Blue Birds of Horror | English Dub | Full Episode", "2026-09-13T23:06:27.074Z"],
  ["7", "32860", "xSKz_EF3Cd8", "CYBERSIX - EP07 Brainwashed | English Dub | Full Episode", "2026-09-13T23:16:51.279Z"],
  ["8", "32861", "Pd4K0VZbOs8", "CYBERSIX - EP08 Gone with the Wings | English Dub | Full Episode", "2026-09-13T23:08:51.940Z"],
  ["9", "32862", "cPDqRQ-gg9E", "CYBERSIX - EP09 Full Moon Fascination | English Dub | Full Episode", "2026-09-13T23:17:57.198Z"],
  ["10", "32863", "E5CGDpwijpM", "CYBERSIX - EP10 The Eye | English Dub | Full Episode", "2026-09-13T23:06:57.837Z"],
  ["11", "32864", "cTVypBnUvKA", "CYBERSIX - EP11 The Greatest Show in Meridiana | English Dub | Full Episode", "2026-09-13T23:12:05.765Z"],
  ["12", "32865", "rYzwa_YKxEI", "CYBERSIX - EP12 Daylight Devil | English Dub | Full Episode", "2026-09-13T23:16:32.635Z"],
  ["13", "32866", "UDf0ypp9BmY", "CYBERSIX - EP13 The Final Confrontation | English Dub | Full Episode", "2026-09-13T23:09:41.615Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_CYBERSIX_DUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-cybersix-dub",
  titleSourceId: "1748",
  titleSlug: "cybersix-q6ebk",
  language: "dub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_CYBERSIX_DUB_ROWS);

const TMS_TOMORROWS_JOE_ROWS = [
  ["1", "22597", "-VC0FfMMryM", "Tomorrow's Joe | EP01 | English Sub", "2026-09-13T23:04:17.071Z"],
  ["2", "22598", "j9vRfZGAcfc", "Tomorrow's Joe | EP02 | English Sub", "2026-09-13T23:12:49.022Z"],
  ["3", "22599", "gBt6HRJGpg8", "Tomorrow's Joe | EP03 | English Sub", "2026-09-13T23:06:11.017Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_TOMORROWS_JOE_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-tomorrows-joe",
  titleSourceId: "1280",
  titleSlug: "tomorrow-s-joe-efvdj",
  language: "sub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_TOMORROWS_JOE_ROWS);

const TMS_NOBODYS_BOY_REMI_ROWS = [
  ["16", "14862", "gmm3saVdXbY", "Nobody's Boy: Remi - Episode 16. Two Mothers", "2026-09-13T23:14:21.567Z"],
  ["50", "14896", "CGTNGdK1iZc", "Nobody's Boy: Remi | Remi, Nobody's Boy - Episode 50: The Miracle", "2026-09-13T23:05:59.018Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_NOBODYS_BOY_REMI_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-nobodys-boy-remi",
  titleSourceId: "854",
  titleSlug: "nobody-s-boy-remi-stbd7",
  language: "sub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_NOBODYS_BOY_REMI_ROWS);

const TMS_DR_STONE_DUB_ROWS = [
  ["1", "24941", "0xbdkTQdhOQ", "Dr. STONE | Season 1 Episode 1 Full Episode | English Dub", "2026-09-13T23:10:34.157Z"],
] as const satisfies readonly ThirdWaveRow[];

export const TMS_DR_STONE_DUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "tms-dr-stone-dub",
  titleSourceId: "1432",
  titleSlug: "dr-stone-uenxt",
  language: "dub",
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_DR_STONE_DUB_ROWS);

const REMOW_WATANARE_ROWS = [
  ["2", "122154", "gf5BOg5nhu4", "There's No Freaking Way I'll be Your Lover! Unless… S1:E2 • First Kiss?! No Freaking Way!", "2026-09-18T05:20:04.601Z"],
  ["3", "122287", "DA2sRF4tBmw", "There's No Freaking Way I'll be Your Lover! Unless… S1:E3 • You Can't Freaking Force Me!", "2026-09-18T05:19:55.844Z"],
  ["4", "122451", "Cri-aqlLXTE", "There's No Freaking Way I'll be Your Lover! Unless… S1:E4 • Mai?! No Freaking Way! (…Or maybe?)", "2026-09-18T05:20:15.877Z"],
  ["5", "122598", "oE91dutk1-4", "There's No Freaking Way I'll be Your Lover! Unless… S1:E5 • Girlfriends? No Freaking Way! (Round 2)", "2026-09-18T05:19:56.401Z"],
  ["6", "122885", "o4FFoybllgE", "There's No Freaking Way I'll be Your Lover! Unless… S1:E6 • Too Many Freaking Secrets! [#ItsAnime]", "2026-09-18T05:20:22.435Z"],
  ["7", "123166", "BFagqYKqRqk", "There's No Freaking Way I'll be Your Lover! Unless… S1:E7 • No Freaking Way I'm Surviving This Mess!", "2026-09-18T05:19:40.719Z"],
  ["8", "123450", "dZQmWRyxKNU", "There's No Freaking Way I'll be Your Lover! Unless… S1:E8 • A Perfect Win? No Freaking Way!", "2026-09-18T05:19:50.579Z"],
  ["9", "124701", "8AWSclqy3IE", "There's No Freaking Way I'll be Your Lover! Unless… S1:E9 • Visiting Ajisai's House? No Freaking Way", "2026-09-18T05:20:00.477Z"],
  ["10", "124893", "9r74-dk3qnU", "There's No Freaking Way I'll be Your Lover! Unless… S1:E10 • A Trip With Just the Two of Us?! No Way", "2026-09-18T05:19:37.986Z"],
  ["11", "125019", "Ys6LxgaK0cc", "There's No Freaking Way I'll be Your Lover! Unless… S1:E11 • Is There No Way We Can Stay Like This?", "2026-09-18T05:19:59.220Z"],
  ["12", "125136", "jVh75PAVZfQ", "There's No Freaking Way I'll be Your Lover! Unless… S1:E12 • No Freaking Way Summer Break is Over!", "2026-09-18T05:20:21.355Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_WATANARE_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-watanare",
  titleSourceId: "7955",
  titleSlug: "there-s-no-freaking-way-i-ll-be-your-lover-unless-fmezc",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_WATANARE_ROWS);

const REMOW_HELL_TEACHER_NUBE_ROWS = [
  ["1", "121926", "SbR5xvZgajU", "Hell Teacher: Jigoku Sensei Nube S1:E1 • The 99-Legged Bug | MULTI-SUB", "2026-09-18T05:19:29.945Z"],
  ["2", "121931", "IjLBgdU835A", "Hell Teacher: Jigoku Sensei Nube S1:E2 • Rampage of the Fox Demon | MULTI-SUB", "2026-09-18T05:19:39.768Z"],
  ["3", "122033", "NtN79m9A-cg", "Hell Teacher: Jigoku Sensei Nube S1:E3 • The Midnight Honor Student | MULTI-SUB", "2026-09-18T05:19:47.975Z"],
  ["4", "122182", "vMFcgYrDCMk", "Hell Teacher: Jigoku Sensei Nube S1:E4 • The Rokurokubi | MULTI-SUB", "2026-09-18T05:19:21.732Z"],
  ["5", "122347", "8g5CWhL706Q", "Hell Teacher: Jigoku Sensei Nube S1:E5 • Hatamonba's Curse | MULTI-SUB", "2026-09-18T05:19:51.182Z"],
  ["6", "122629", "hxuUcIuVZOk", "Hell Teacher: Jigoku Sensei Nube S1:E6 • The Teketeke Ghost | MULTI-SUB", "2026-09-18T05:19:36.146Z"],
  ["7", "122946", "5-F__TqPJi4", "Hell Teacher: Jigoku Sensei Nube S1:E7 • The Unseasonable Yuki-onna | MULTI-SUB", "2026-09-18T05:19:57.058Z"],
  ["9", "123498", "G9Wwyilc3mU", "Hell Teacher: Jigoku Sensei Nube S1:E9 • The Girl Who Brings Happiness | MULTI-SUB", "2026-09-18T05:20:13.302Z"],
  ["10", "124731", "sPVtG89y6Bs", "Hell Teacher: Jigoku Sensei Nube S1:E10 • The Night Parade of Yokai | MULTI-SUB", "2026-09-18T05:19:33.959Z"],
  ["11", "124906", "-rdKYEg4jDY", "Hell Teacher: Jigoku Sensei Nube S1:E11 • Demon Hand vs Fire Tail Jutsu | MULTI-SUB", "2026-09-18T05:20:03.891Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_HELL_TEACHER_NUBE_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-hell-teacher-nube",
  titleSourceId: "7915",
  titleSlug: "hell-teacher-jigoku-sensei-nube-3picx",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_HELL_TEACHER_NUBE_ROWS);

const REMOW_STEPMOTHER_STEPSISTERS_ROWS = [
  ["1", "134081", "Pv4j77uL_JA", "My Stepmother and Stepsisters Aren't Wicked EP 1 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:01:17.766Z"],
  ["2", "134172", "BhY0cOQDNp8", "My Stepmother and Stepsisters Aren't Wicked EP 2 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:01:28.393Z"],
  ["3", "134299", "9B2hEvhgaLc", "My Stepmother and Stepsisters Aren't Wicked EP 3 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:00:48.017Z"],
  ["4", "134443", "y3hk3IfFvzs", "My Stepmother and Stepsisters Aren't Wicked EP 4 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:00:03.799Z"],
  ["5", "134620", "CHv5urXQsLk", "My Stepmother and Stepsisters Aren't Wicked EP 5 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:01:52.916Z"],
  ["6", "134712", "M6Itf6l6Vg0", "My Stepmother and Stepsisters Aren't Wicked EP 6 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:02:58.585Z"],
  ["7", "134862", "horLzuO1FN8", "My Stepmother and Stepsisters Aren't Wicked EP 7 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:00:32.333Z"],
  ["8", "134969", "JX6SBkbJoiI", "My Stepmother and Stepsisters Aren't Wicked EP 8 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:03:01.555Z"],
  ["9", "135109", "yZD8c1vfV-w", "My Stepmother and Stepsisters Aren't Wicked EP 9 | MULTI-SUB [#ItsAnime]", "2026-09-13T23:01:14.878Z"],
  ["10", "135245", "g2YBOr3vRLA", "My Stepmother and Stepsisters Aren't Wicked EP 10 | MULTI-SUB [#ItsAnime]", "2026-09-13T22:59:55.578Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_STEPMOTHER_STEPSISTERS_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-stepmother-stepsisters",
  titleSourceId: "8946",
  titleSlug: "my-stepmother-and-stepsisters-aren-t-wicked-7aa48",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_STEPMOTHER_STEPSISTERS_ROWS);

const REMOW_MY_DEER_FRIEND_NOKOTAN_ROWS = [
  ["1", "96790", "z-4pdSmVqls", "My Deer Friend Nokotan S1:E1 • Girl Meets Deer | MULTI-SUB [#ItsAnime]", "2026-09-18T05:19:59.918Z"],
  ["2", "96791", "oBQKmGl9_7w", "My Deer Friend Nokotan S1:E2 • Deer Meets Darkness Girl | MULTI-SUB [#ItsAnime]", "2026-09-18T05:19:42.479Z"],
  ["3", "96792", "VqiVoEot8b4", "My Deer Friend Nokotan S1:E3 • The New Student: Bashame | MULTI-SUB [#ItsAnime]", "2026-09-18T05:19:45.958Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_MY_DEER_FRIEND_NOKOTAN_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-my-deer-friend-nokotan",
  titleSourceId: "6268",
  titleSlug: "my-deer-friend-nokotan-oika3",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_MY_DEER_FRIEND_NOKOTAN_ROWS);

const REMOW_HAIGAKURA_ROWS = [
  ["1", "489", "Ogp2HQ3UGmI", "HAIGAKURA EP1 • The Kagura Dance | MULTI-SUB [#ItsAnime]", "2026-09-13T23:03:16.228Z"],
  ["2", "490", "B6PbHFLZDsg", "HAIGAKURA EP2 • The Thunder Dance | MULTI-SUB [#ItsAnime]", "2026-09-13T23:00:52.078Z"],
  ["3", "111960", "5zVjEdMwlzM", "HAIGAKURA EP3 • The Snowflake Dance | MULTI-SUB [#ItsAnime]", "2026-09-13T23:02:50.434Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_HAIGAKURA_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-haigakura",
  titleSourceId: "39",
  titleSlug: "haigakura-cbud0",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_HAIGAKURA_ROWS);

const REMOW_TASOKARE_HOTEL_ROWS = [
  ["1", "114544", "RQKw8KfDpmk", "TASOKARE HOTEL S1:E1 • Twilight Girl | MULTI-SUB [#ItsAnime]", "2026-09-18T05:19:49.437Z"],
  ["2", "114933", "CL_1y_cYkY8", "TASOKARE HOTEL S1:E2 • The Bet of a Lifetime | MULTI-SUB [#ItsAnime]", "2026-09-18T05:20:01.795Z"],
  ["3", "115071", "8oAc5kGLQ7c", "TASOKARE HOTEL S1:E3 • The Blood-Soaked Pansy | MULTI-SUB [#ItsAnime]", "2026-09-18T05:19:22.373Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_TASOKARE_HOTEL_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-tasokare-hotel",
  titleSourceId: "7448",
  titleSlug: "tasokare-hotel-hynvm",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_TASOKARE_HOTEL_ROWS);

const REMOW_YOUR_FORMA_ROWS = [
  ["1", "117124", "x3dydpzxFsI", "YOUR FORMA EP1 • Mechanical Friends Amicus Robots | MULTI-SUB [#ItsAnime]", "2026-09-13T23:00:47.040Z"],
  ["2", "117239", "CZs2B3SpvLA", "YOUR FORMA EP2 • A Black Box | MULTI-SUB [#ItsAnime]", "2026-09-13T23:01:40.371Z"],
  ["3", "117398", "dc9tK8hN2VQ", "YOUR FORMA EP3 • Pursuit | MULTI-SUB [#ItsAnime]", "2026-09-13T22:59:52.919Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_YOUR_FORMA_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-your-forma",
  titleSourceId: "7563",
  titleSlug: "your-forma-rg974",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_YOUR_FORMA_ROWS);

const REMOW_TOUGEN_ANKI_DUB_ROWS = [
  ["1", "122089", "i361g8Xaevs", "TOUGEN ANKI S1:E1 • Oni's Blood | Dual Audio | Multi-Sub [#ItsAnime]", "2026-09-18T05:19:43.191Z"],
  ["2", "122216", "6-CyGSelp_k", "TOUGEN ANKI S1:E2 • If You Want to Make It, Keep On Winning | Dual Audio | Multi-Sub [#ItsAnime]", "2026-09-18T05:19:58.445Z"],
  ["3", "122390", "D3rpbeNrPdw", "TOUGEN ANKI S1:E3 • Blood Eclipse Release | Dual Audio | Multi-Sub [#ItsAnime]", "2026-09-18T05:19:27.648Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_TOUGEN_ANKI_DUB_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-tougen-anki-dub",
  titleSourceId: "7971",
  titleSlug: "tougen-anki-xb5il",
  language: "dub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_TOUGEN_ANKI_DUB_ROWS);

const REMOW_KILL_BLUE_ROWS = [
  ["1", "132069", "hU7rzDKlH2w", "KILL BLUE EP1 • Let's Go to School | 6 Audio | MULTI-SUB [#ItsAnime]", "2026-09-13T22:59:54.243Z"],
  ["2", "132223", "bAGEVLi0oow", "KILL BLUE EP2 • Noren Mitsuoka | 6 Audio | MULTI-SUB [#ItsAnime]", "2026-09-13T23:00:35.881Z"],
  ["3", "132481", "iqXNPLc7QeI", "KILL BLUE EP3 • Wipe Your Own Butt | MULTI-SUB [#ItsAnime]", "2026-09-13T23:01:55.543Z"],
] as const satisfies readonly ThirdWaveRow[];

export const REMOW_KILL_BLUE_EPISODE_APPROVALS = buildApprovals({
  idPrefix: "remow-kill-blue",
  titleSourceId: "8725",
  titleSlug: "kill-blue-gcqj5",
  language: "sub",
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_KILL_BLUE_ROWS);

export const THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = Object.freeze([
  ...TMS_SONIC_X_DUB_EPISODE_APPROVALS,
  ...TMS_SONIC_X_SUB_EPISODE_APPROVALS,
  ...TMS_ROSE_OF_VERSAILLES_EPISODE_APPROVALS,
  ...TMS_DEVIL_LADY_DUB_EPISODE_APPROVALS,
  ...TMS_MAGIC_KNIGHT_RAYEARTH_DUB_EPISODE_APPROVALS,
  ...TMS_CYBERSIX_DUB_EPISODE_APPROVALS,
  ...TMS_TOMORROWS_JOE_EPISODE_APPROVALS,
  ...TMS_NOBODYS_BOY_REMI_EPISODE_APPROVALS,
  ...TMS_DR_STONE_DUB_EPISODE_APPROVALS,
  ...REMOW_WATANARE_EPISODE_APPROVALS,
  ...REMOW_HELL_TEACHER_NUBE_EPISODE_APPROVALS,
  ...REMOW_STEPMOTHER_STEPSISTERS_EPISODE_APPROVALS,
  ...REMOW_MY_DEER_FRIEND_NOKOTAN_EPISODE_APPROVALS,
  ...REMOW_HAIGAKURA_EPISODE_APPROVALS,
  ...REMOW_TASOKARE_HOTEL_EPISODE_APPROVALS,
  ...REMOW_YOUR_FORMA_EPISODE_APPROVALS,
  ...REMOW_TOUGEN_ANKI_DUB_EPISODE_APPROVALS,
  ...REMOW_KILL_BLUE_EPISODE_APPROVALS,
]);
