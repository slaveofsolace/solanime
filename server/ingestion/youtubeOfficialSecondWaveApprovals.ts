import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';
import { REMOW_PUBLISHER, TMS_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';

export type SecondWaveApprovalRow = readonly [
  episodeNumber: string,
  episodeSourceId: string,
  expectedEpisodeId: number,
  versionSourceId: string,
  expectedVersionId: number,
  videoId: string,
  videoTitle: string,
  observedAt: string,
];

type SeriesApprovalDefinition = Readonly<{
  idPrefix: string;
  titleSourceId: string;
  titleSlug: string;
  expectedTitleId: number;
  publisher: typeof REMOW_PUBLISHER | typeof TMS_PUBLISHER;
  publisherIdentityUrl: string;
  titleIdentityUrl: string;
}>;

export type SecondWaveCatalogueIdentity = Readonly<{
  approvalId: string;
  expectedTitleId: number;
  expectedEpisodeId: number;
  expectedVersionId: number;
}>;

const catalogueIdentities: SecondWaveCatalogueIdentity[] = [];

function buildSeriesApprovals(
  definition: SeriesApprovalDefinition,
  rows: readonly SecondWaveApprovalRow[],
): readonly OfficialYouTubeEpisodeApproval[] {
  return Object.freeze(rows.map(([
    episodeNumber,
    episodeSourceId,
    expectedEpisodeId,
    versionSourceId,
    expectedVersionId,
    videoId,
    videoTitle,
    observedAt,
  ]) => {
    if (versionSourceId !== `${episodeSourceId}:sub`) {
      throw new Error(`INVALID_SECOND_WAVE_VERSION_IDENTITY:${definition.idPrefix}:${episodeNumber}`);
    }
    const id = `${definition.idPrefix}-episode-${episodeNumber}`;
    catalogueIdentities.push(Object.freeze({
      approvalId: id,
      expectedTitleId: definition.expectedTitleId,
      expectedEpisodeId,
      expectedVersionId,
    }));
    return Object.freeze({
      id,
      catalogue: {
        source: 'anikoto' as const,
        titleSourceId: definition.titleSourceId,
        titleSlug: definition.titleSlug,
        episodeSourceId,
        episodeNumber,
        versionSourceId,
        language: 'sub',
      },
      video: {
        id: videoId,
        title: videoTitle,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        channelId: definition.publisher.channelId,
        channelUrl: definition.publisher.channelUrl,
        handleUrl: definition.publisher.handleUrl,
      },
      publisherIdentityUrl: definition.publisherIdentityUrl,
      titleIdentityUrl: definition.titleIdentityUrl,
      episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,
      observedAt,
    });
  }));
}

// Explicit rows generated from the immutable 2026-09-15 v3 review. Numeric IDs
// are audit evidence only; runtime lookup remains fail-closed on stable Anikoto
// title, slug, episode, version, and language identities.
export const TMS_NEW_TETSUJIN_28_APPROVAL_ROWS = [
  ["1", "38558", 101055, "38558:sub", 131429, "AuceLU556dU", "New Tetsujin 28 - EP01 The Plot to Steal the Sun | English Sub | Full Episode", "2026-09-13T23:04:10.573Z"],
  ["2", "38559", 101056, "38559:sub", 131431, "N1_FSrnlnCY", "New Tetsujin 28 - EP02 Hands of the Enemy | English Sub | Full Episode", "2026-09-13T23:12:40.917Z"],
  ["3", "38560", 101057, "38560:sub", 131433, "i_BH-ahKoJc", "New Tetsujin 28 - EP03 Deadly Doctor Doom | English Sub | Full Episode", "2026-09-13T23:08:26.556Z"],
  ["4", "38561", 101058, "38561:sub", 131435, "-N5R3kQcL5U", "New Tetsujin 28 - EP04 The Robot Birdman | English Sub | Full Episode", "2026-09-13T23:04:02.379Z"],
  ["5", "38562", 101059, "38562:sub", 131437, "P_x59_nptiQ", "New Tetsujin 28 - EP05 The Phantom Robot | English Sub | Full Episode", "2026-09-13T23:09:49.646Z"],
  ["6", "38563", 101060, "38563:sub", 131439, "BtknmAJyVLY", "New Tetsujin 28 - EP06 Monster of the Deep | English Sub | Full Episode", "2026-09-13T23:10:56.902Z"],
  ["7", "38564", 101061, "38564:sub", 131441, "nWSQnv6PkUY", "New Tetsujin 28 - EP07 The Crashing Satellite | English Sub | Full Episode", "2026-09-13T23:17:07.434Z"],
  ["8", "38565", 101062, "38565:sub", 131443, "kUxrFVWPXLw", "New Tetsujin 28 - EP08 The Dreaded Double Robot | English Sub | Full Episode", "2026-09-13T23:19:01.451Z"],
  ["9", "38566", 101063, "38566:sub", 131445, "36-iZwEnGRI", "New Tetsujin 28 - EP09 Menace from Space | English Sub | Full Episode", "2026-09-13T23:13:08.942Z"],
  ["10", "38567", 101064, "38567:sub", 131447, "ATSKBOfQ8-o", "New Tetsujin 28 - EP10 Bitter Revenge | English Sub | Full Episode", "2026-09-13T23:03:48.431Z"],
  ["11", "38568", 101065, "38568:sub", 131449, "KpWQ023DK_Q", "New Tetsujin 28 - EP11 The Invisible Enemy | English Sub | Full Episode", "2026-09-13T23:04:20.956Z"],
  ["12", "38569", 101066, "38569:sub", 131451, "Zki42BgivPk", "New Tetsujin 28 - EP12 The Robot Runners | English Sub | Full Episode", "2026-09-13T23:16:14.911Z"],
  ["13", "38570", 101067, "38570:sub", 131453, "FyLdVvmk7bk", "New Tetsujin 28 - EP13 Will the Real Gigantor Please Stand Up? | English Sub | Full Episode", "2026-09-13T23:19:00.099Z"],
  ["14", "38571", 101068, "38571:sub", 131455, "wpIJ09dKsJI", "New Tetsujin 28 - EP14 The Abominable Iceman | English Sub | Full Episode", "2026-09-13T23:07:46.191Z"],
  ["15", "38572", 101069, "38572:sub", 131457, "gZwjcme9U98", "New Tetsujin 28 - EP15 The Dragon Master | English Sub | Full Episode", "2026-09-13T23:14:59.324Z"],
  ["16", "38573", 101070, "38573:sub", 131459, "1IYIL_1ABgU", "New Tetsujin 28 - EP16 The Guardian of Evil | English Sub | Full Episode", "2026-09-13T23:11:50.944Z"],
  ["17", "38574", 101071, "38574:sub", 131461, "zMGUGHhCtYo", "New Tetsujin 28 - EP17 The Manta Marauders | English Sub | Full Episode", "2026-09-13T23:04:18.610Z"],
  ["18", "38575", 101072, "38575:sub", 131463, "KEa-owb89c4", "New Tetsujin 28 - EP18 The Pirate Submarine | English Sub | Full Episode", "2026-09-13T23:19:20.404Z"],
  ["19", "38576", 101073, "38576:sub", 131465, "KVsH5oE-IYQ", "New Tetsujin 28 - EP19 The Sting of the Scorpion | English Sub | Full Episode", "2026-09-13T23:03:56.070Z"],
  ["20", "38577", 101074, "38577:sub", 131467, "9pf1Mw0IPCI", "New Tetsujin 28 - EP20 The Fearsome Pharaoh | English Sub | Full Episode", "2026-09-13T23:05:41.514Z"],
  ["21", "38578", 101075, "38578:sub", 131469, "UamiMWRYZJY", "New Tetsujin 28 - EP21 The Shrinking Ray | English Sub | Full Episode", "2026-09-13T23:12:12.446Z"],
  ["22", "38579", 101076, "38579:sub", 131471, "tBHV0FGgkf8", "New Tetsujin 28 - EP22 Kid Warriors | English Sub | Full Episode", "2026-09-13T23:13:41.185Z"],
  ["23", "38580", 101077, "38580:sub", 131473, "Hm17dIE29Mo", "New Tetsujin 28 - EP23 Red Devil | English Sub | Full Episode", "2026-09-13T23:14:42.097Z"],
  ["24", "38581", 101078, "38581:sub", 131475, "NJzi-niWhK8", "New Tetsujin 28 - EP24 The Fiery Robosaurus | English Sub | Full Episode", "2026-09-13T23:09:46.950Z"],
  ["25", "38582", 101079, "38582:sub", 131477, "Fnsz0R4VjUM", "New Tetsujin 28 - EP25 Invaders from Space | English Sub | Full Episode", "2026-09-13T23:06:16.422Z"],
  ["26", "38583", 101080, "38583:sub", 131479, "UnldvfLNMLU", "New Tetsujin 28 - EP26 The Master of Space | English Sub | Full Episode", "2026-09-13T23:05:16.016Z"],
] as const satisfies readonly SecondWaveApprovalRow[];

export const TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS = buildSeriesApprovals({
  idPrefix: "tms-new-tetsujin-28",
  titleSourceId: "2151",
  titleSlug: "tetsujin-28-c15he",
  expectedTitleId: 6889,
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_NEW_TETSUJIN_28_APPROVAL_ROWS);

export const TMS_GOD_MAZINGER_APPROVAL_ROWS = [
  ["1", "72840", 68012, "72840:sub", 87443, "C7fiFtVrC7A", "GOD MAZINGER - EP01 Ressurection of the Legendary Giant | English Sub | Full Episode", "2026-09-13T23:10:37.902Z"],
  ["2", "72841", 68013, "72841:sub", 87444, "U1FhxfttbDg", "GOD MAZINGER - EP02 Fate of the Chosen One | English Sub | Full Episode", "2026-09-13T23:08:17.336Z"],
  ["3", "72842", 68014, "72842:sub", 87445, "RbCkDO_hAEo", "GOD MAZINGER - EP03 Mystery of the Light Bearer | English Sub | Full Episode", "2026-09-13T23:04:41.007Z"],
  ["4", "72843", 68015, "72843:sub", 87446, "ceJ2D5LgDXs", "GOD MAZINGER - EP04 Mazinger's Secret | English Sub | Full Episode", "2026-09-13T23:15:26.581Z"],
  ["5", "72844", 68016, "72844:sub", 87447, "yKnK6F241z4", "GOD MAZINGER - EP05 Prince Eld's Ambush | English Sub | Full Episode", "2026-09-13T23:14:55.614Z"],
  ["6", "72845", 68017, "72845:sub", 87448, "vcPn1ggXCm4", "GOD MAZINGER - EP06 Save Aira! | English Sub | Full Episode", "2026-09-13T23:04:35.838Z"],
  ["7", "72846", 68018, "72846:sub", 87449, "HprPE2pSJQM", "GOD MAZINGER - EP07 Missing Mazinger | English Sub | Full Episode", "2026-09-13T23:18:38.793Z"],
  ["8", "72847", 68019, "72847:sub", 87450, "_mRguqIZdrw", "GOD MAZINGER - EP08 Hurry, Warrior Yamato! | English Sub | Full Episode", "2026-09-13T23:07:08.608Z"],
  ["9", "72848", 68020, "72848:sub", 87451, "Nnd-1lM8FWo", "GOD MAZINGER - EP09 Discovery of the Dinosaur Factory! | English Sub | Full Episode", "2026-09-13T23:14:08.085Z"],
  ["10", "72849", 68021, "72849:sub", 87452, "fY4722XUG1g", "GOD MAZINGER - EP10 The Terrible Secret | English Sub | Full Episode", "2026-09-13T23:03:52.230Z"],
  ["11", "72850", 68022, "72850:sub", 87453, "5p6rimZckHM", "GOD MAZINGER - EP11 The Captive Aira | English Sub | Full Episode", "2026-09-13T23:11:47.145Z"],
  ["12", "72851", 68023, "72851:sub", 87454, "IDDKdcvlTbQ", "GOD MAZINGER - EP12 The Stolen Clue | English Sub | Full Episode", "2026-09-13T23:06:48.536Z"],
  ["13", "72852", 68024, "72852:sub", 87455, "X3WX1MsGI20", "GOD MAZINGER - EP13 Mazinger in Peril | English Sub | Full Episode", "2026-09-13T23:18:10.871Z"],
  ["14", "72853", 68025, "72853:sub", 87456, "uQTmCbFrs1I", "GOD MAZINGER - EP14 The Terror of the Light Bearer | English Sub | Full Episode", "2026-09-13T23:03:34.747Z"],
  ["15", "72854", 68026, "72854:sub", 87457, "hvO7CxB70A8", "GOD MAZINGER - EP15 The Wandering Muvians | English Sub | Full Episode", "2026-09-13T23:15:41.262Z"],
  ["16", "72855", 68027, "72855:sub", 87458, "C0UpPhzaT_k", "GOD MAZINGER - EP16 The Death of Muraji | English Sub | Full Episode", "2026-09-13T23:09:10.730Z"],
  ["17", "72856", 68028, "72856:sub", 87459, "sLugJRddrRo", "GOD MAZINGER - EP17 Eld's Secret Base | English Sub | Full Episode", "2026-09-13T23:04:51.863Z"],
  ["18", "72857", 68029, "72857:sub", 87460, "VGCwHCL2NVY", "GOD MAZINGER - EP18 The Miracle at the Bottom of the Sea | English Sub | Full Episode", "2026-09-13T23:03:32.090Z"],
  ["19", "72858", 68030, "72858:sub", 87461, "g4rz66bXY-Q", "GOD MAZINGER - EP19 Do-or-Die Investigation in the Depths | English Sub | Full Episode", "2026-09-13T23:15:38.554Z"],
  ["20", "72859", 68031, "72859:sub", 87462, "XVyUrXrY5e8", "GOD MAZINGER - EP20 Dorado's Fury | English Sub | Full Episode", "2026-09-13T23:10:24.527Z"],
  ["21", "72860", 68032, "72860:sub", 87463, "Nh5ZgzhnIJ0", "GOD MAZINGER - EP21 Yamato Versus Dorado! | English Sub | Full Episode", "2026-09-13T23:09:33.491Z"],
  ["22", "72861", 68033, "72861:sub", 87464, "w9W5UTqa0rk", "GOD MAZINGER - EP22 Yamato is Dead?! | English Sub | Full Episode", "2026-09-13T23:06:43.191Z"],
  ["23", "72862", 68034, "72862:sub", 87465, "Q5wfCUsYiUc", "GOD MAZINGER - EP23 Yamato Versus Eld | English Sub | Full Episode", "2026-09-13T23:13:10.288Z"],
] as const satisfies readonly SecondWaveApprovalRow[];

export const TMS_GOD_MAZINGER_EPISODE_APPROVALS = buildSeriesApprovals({
  idPrefix: "tms-god-mazinger",
  titleSourceId: "4410",
  titleSlug: "god-mazinger-fsqyu",
  expectedTitleId: 4692,
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_GOD_MAZINGER_APPROVAL_ROWS);

export const TMS_ACTUALLY_I_AM_APPROVAL_ROWS = [
  ["1", "55077", 85421, "55077:sub", 109513, "NLJ4bnj11Wc", "Actually, I am… - EP01 I'll Confess! | English Sub | Full Episode", "2026-09-13T23:08:01.217Z"],
  ["2", "55078", 85422, "55078:sub", 109514, "VvFIgUbw8Ko", "Actually, I am… - EP02 I'll Keep This Secret! | English Sub | Full Episode", "2026-09-13T23:04:30.537Z"],
  ["3", "55079", 85423, "55079:sub", 109515, "LNNIG5hZTxY", "Actually, I am… - EP03 Beware Childhood Friends! | English Sub | Full Episode", "2026-09-13T23:07:12.698Z"],
  ["4", "55080", 85424, "55080:sub", 109516, "sC4w0l44cB4", "Actually, I am… - EP04 Help the Class Rep! | English Sub | Full Episode", "2026-09-13T23:05:22.622Z"],
  ["5", "55081", 85425, "55081:sub", 109517, "l1cz2ihDtt8", "Actually, I am… - EP05 Let's Go on a... Date? | English Sub | Full Episode", "2026-09-13T23:15:46.781Z"],
  ["6", "55082", 85426, "55082:sub", 109518, "idkj474ZAf4", "Actually, I am… - EP06 Beware of the Wolf Man! | English Sub | Full Episode", "2026-09-13T23:03:37.321Z"],
  ["7", "55083", 85427, "55083:sub", 109519, "wnUKwHMnEp0", "Actually, I am… - EP07 Let's Get Sexy! | English Sub | Full Episode", "2026-09-13T23:06:39.324Z"],
  ["8", "55084", 85428, "55084:sub", 109520, "a3aBG9mtb4Q", "Actually, I am… - EP08 Let's Save the World! | English Sub | Full Episode", "2026-09-13T23:15:10.243Z"],
  ["9", "55085", 85429, "55085:sub", 109521, "z9O22Ch-6Ms", "Actually, I am… - EP09 Let's Put On Our Swimsuits! | English Sub | Full Episode", "2026-09-13T23:13:51.935Z"],
  ["10", "55086", 85430, "55086:sub", 109522, "L6If0MNhHh8", "Actually, I am… - EP10 Let's Be Honest! | English Sub | Full Episode", "2026-09-13T23:12:42.076Z"],
  ["11", "55087", 85431, "55087:sub", 109523, "TrfYmz806AE", "Actually, I am… - EP11 Let's Go to the Summer Festival! | English Sub | Full Episode", "2026-09-13T23:17:24.912Z"],
  ["12", "55088", 85432, "55088:sub", 109524, "vzb6iyMtGS4", "Actually, I am… - EP12 Let's Stop This Confession! | English Sub | Full Episode", "2026-09-13T23:11:44.363Z"],
  ["13", "55089", 85433, "55089:sub", 109525, "IAzvfAzDKHU", "Actually, I am… - EP13 Let's Go Home Together! | English Sub | Full Episode", "2026-09-13T23:19:14.961Z"],
] as const satisfies readonly SecondWaveApprovalRow[];

export const TMS_ACTUALLY_I_AM_EPISODE_APPROVALS = buildSeriesApprovals({
  idPrefix: "tms-actually-i-am",
  titleSourceId: "3252",
  titleSlug: "actually-i-am-nuieb",
  expectedTitleId: 5819,
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_ACTUALLY_I_AM_APPROVAL_ROWS);

export const TMS_WE_RENT_TSUKUMOGAMI_APPROVAL_ROWS = [
  ["1", "59674", 80967, "59674:sub", 103802, "uz8z67RqyPI", "We Rent Tsukumogami - EP01 Rikyu-nezumi | English Sub | Full Episode", "2026-09-13T23:07:56.917Z"],
  ["2", "59675", 80968, "59675:sub", 103803, "DsKJEoMaa_8", "We Rent Tsukumogami - EP02 Kuchinashi | English Sub | Full Episode", "2026-09-13T23:13:50.584Z"],
  ["3", "59676", 80969, "59676:sub", 103804, "HjOkfRhZSVo", "We Rent Tsukumogami - EP03 Nadeshiko | English Sub | Full Episode", "2026-09-13T23:15:16.911Z"],
  ["4", "59677", 80970, "59677:sub", 103805, "qkkNUA_NDtQ", "We Rent Tsukumogami - EP04 Kogare-kou | English Sub | Full Episode", "2026-09-13T23:16:34.912Z"],
  ["5", "59678", 80971, "59678:sub", 103806, "GE_OzPiKgJg", "We Rent Tsukumogami - EP05 Fukagawa-nezumi | English Sub | Full Episode", "2026-09-13T23:08:56.000Z"],
  ["6", "59679", 80972, "59679:sub", 103807, "zsv5ig3sfg8", "We Rent Tsukumogami - EP06 Heki-ruri | English Sub | Full Episode", "2026-09-13T23:10:44.914Z"],
  ["7", "59680", 80973, "59680:sub", 103808, "lZTWxBhvmdU", "We Rent Tsukumogami - EP07 Uraha-yanagi | English Sub | Full Episode", "2026-09-13T23:08:47.981Z"],
  ["8", "59681", 80974, "59681:sub", 103809, "aZ_Nq0XlElU", "We Rent Tsukumogami - EP08 Edo-murasaki | English Sub | Full Episode", "2026-09-13T23:14:06.743Z"],
  ["9", "59682", 80975, "59682:sub", 103810, "5aWjL-oaBGs", "We Rent Tsukumogami - EP09 Hisoku | English Sub | Full Episode", "2026-09-13T23:05:17.268Z"],
  ["10", "59683", 80976, "59683:sub", 103811, "bjAfzkhom30", "We Rent Tsukumogami - EP10 Binrouji-zome | English Sub | Full Episode", "2026-09-13T23:16:31.006Z"],
  ["11", "59684", 80977, "59684:sub", 103812, "N8gE1WrIW4A", "We Rent Tsukumogami - EP11 Nise-murasaki | English Sub | Full Episode", "2026-09-13T23:03:18.874Z"],
  ["12", "59685", 80978, "59685:sub", 103813, "PJ2MB4TXr34", "We Rent Tsukumogami - EP12 Suou | English Sub | Full Episode", "2026-09-13T23:06:28.599Z"],
] as const satisfies readonly SecondWaveApprovalRow[];

export const TMS_WE_RENT_TSUKUMOGAMI_EPISODE_APPROVALS = buildSeriesApprovals({
  idPrefix: "tms-we-rent-tsukumogami",
  titleSourceId: "3587",
  titleSlug: "we-rent-tsukumogami-bpfgm",
  expectedTitleId: 5492,
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_WE_RENT_TSUKUMOGAMI_APPROVAL_ROWS);

export const TMS_BRAVE_10_APPROVAL_ROWS = [
  ["1", "50296", 89582, "50296:sub", 115262, "P7k8OrgUkFw", "BRAVE 10 - EP01 The Fateful Two | English Sub | Full Episode", "2026-09-13T23:19:04.482Z"],
  ["2", "50297", 89583, "50297:sub", 115263, "c_CpDA59xRc", "BRAVE 10 - EP02 Dark and Light | English Sub | Full Episode", "2026-09-13T23:08:02.483Z"],
  ["3", "50298", 89584, "50298:sub", 115264, "BmksNsBPfi8", "BRAVE 10 - EP03 Valley of the Whirlwinds | English Sub | Full Episode", "2026-09-13T23:03:26.711Z"],
  ["4", "50299", 89585, "50299:sub", 115265, "Wj52TlvUsTs", "BRAVE 10 - EP04 The Souls of the Gods | English Sub | Full Episode", "2026-09-13T23:04:45.168Z"],
  ["5", "50300", 89586, "50300:sub", 115266, "EQOBXgy5djw", "BRAVE 10 - EP05 The Heart of the Dragon | English Sub | Full Episode", "2026-09-13T23:04:49.297Z"],
  ["6", "50301", 89587, "50301:sub", 115267, "pbBsFws_7aU", "BRAVE 10 - EP06 Taizan Meido | English Sub | Full Episode", "2026-09-13T23:07:24.631Z"],
  ["7", "50302", 89588, "50302:sub", 115268, "1Kh4zZEY4SE", "BRAVE 10 - EP07 Sword and Fan | English Sub | Full Episode", "2026-09-13T23:19:10.958Z"],
  ["8", "50303", 89589, "50303:sub", 115269, "FOH20bbYDJg", "BRAVE 10 - EP08 The Birth of a Warrior | English Sub | Full Episode", "2026-09-13T23:16:10.896Z"],
  ["9", "50304", 89590, "50304:sub", 115270, "dOyXrUQmYJ0", "BRAVE 10 - EP09 The True Face of Ice | English Sub | Full Episode", "2026-09-13T23:16:06.827Z"],
  ["10", "50305", 89591, "50305:sub", 115271, "VbLtE7Vm-hs", "BRAVE 10 - EP10 The Start of a Tradegy | English Sub | Full Episode", "2026-09-13T23:07:58.235Z"],
  ["11", "50306", 89592, "50306:sub", 115272, "Qk7_-jzDM_A", "BRAVE 10 - EP11 The Wall of Darkness | English Sub | Full Episode", "2026-09-13T23:07:16.653Z"],
  ["12", "50307", 89593, "50307:sub", 115273, "LEaFCtB4Z-M", "BRAVE 10 - EP12 The Warrior of Light | English Sub | Full Episode", "2026-09-13T23:14:01.391Z"],
] as const satisfies readonly SecondWaveApprovalRow[];

export const TMS_BRAVE_10_EPISODE_APPROVALS = buildSeriesApprovals({
  idPrefix: "tms-brave-10",
  titleSourceId: "2933",
  titleSlug: "brave-10-oa1k6",
  expectedTitleId: 6128,
  publisher: TMS_PUBLISHER,
  publisherIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
  titleIdentityUrl: "https://tmsanime.com/anime-on-tms-official-channel",
}, TMS_BRAVE_10_APPROVAL_ROWS);

export const REMOW_BOOGIEPOP_PHANTOM_APPROVAL_ROWS = [
  ["1", "44348", 95395, "44348:sub", 123617, "PxpuBJBud4U", "Full Episode 1 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:02:07.489Z"],
  ["2", "44349", 95396, "44349:sub", 123619, "FY7-1MugKJY", "Full Episode 2 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:01:22.988Z"],
  ["3", "44350", 95397, "44350:sub", 123621, "VKglYSE_b-g", "Full Episode 3 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:00:56.121Z"],
  ["4", "44351", 95398, "44351:sub", 123623, "mbpdDoZfWPA", "Full Episode 4 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:01:04.217Z"],
  ["5", "44352", 95399, "44352:sub", 123625, "aYTLPXhJW88", "Full Episode 5 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:00:53.317Z"],
  ["6", "44353", 95400, "44353:sub", 123627, "D3oWxf1DCCQ", "Full Episode 6 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:02:22.346Z"],
  ["7", "44354", 95401, "44354:sub", 123629, "n0vOJHofQSE", "Full Episode 7 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:02:06.255Z"],
  ["8", "44355", 95402, "44355:sub", 123631, "pzjjnZEkS20", "Full Episode 8 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:00:39.889Z"],
  ["9", "44356", 95403, "44356:sub", 123633, "cvtDhF-Ge3Q", "Full Episode 9 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T23:01:33.725Z"],
  ["10", "44357", 95404, "44357:sub", 123635, "O0jfK5n4GN0", "Full Episode 10 | BOOGIEPOP PHANTOM | It's Anime［Multi-Subs］", "2026-09-13T22:59:57.009Z"],
  ["11", "44358", 95405, "44358:sub", 123637, "rqOp_mxOtk8", "Full Episode 11 | BOOGIEPOP PHANTOM | It's Anime [Multi-Sub]", "2026-09-13T23:00:55.123Z"],
  ["12", "44359", 95406, "44359:sub", 123639, "q1n6wcAEBjg", "Full Episode 12 | BOOGIEPOP PHANTOM | It's Anime [Multi-Sub]", "2026-09-13T23:01:37.914Z"],
] as const satisfies readonly SecondWaveApprovalRow[];

export const REMOW_BOOGIEPOP_PHANTOM_EPISODE_APPROVALS = buildSeriesApprovals({
  idPrefix: "remow-boogiepop-phantom",
  titleSourceId: "2540",
  titleSlug: "boogiepop-phantom-92c6a",
  expectedTitleId: 6510,
  publisher: REMOW_PUBLISHER,
  publisherIdentityUrl: "https://www.remow.com/en/service/",
  titleIdentityUrl: "https://www.remow.com/en/service/",
}, REMOW_BOOGIEPOP_PHANTOM_APPROVAL_ROWS);

export const SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = Object.freeze([
  ...TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS,
  ...TMS_GOD_MAZINGER_EPISODE_APPROVALS,
  ...TMS_ACTUALLY_I_AM_EPISODE_APPROVALS,
  ...TMS_WE_RENT_TSUKUMOGAMI_EPISODE_APPROVALS,
  ...TMS_BRAVE_10_EPISODE_APPROVALS,
  ...REMOW_BOOGIEPOP_PHANTOM_EPISODE_APPROVALS,
]);

export const SECOND_WAVE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES = Object.freeze([
  ...catalogueIdentities,
]);
