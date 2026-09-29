import type { OfficialYouTubePublisher } from '../../shared/playback.ts';
import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';

export type BeybladeOfficialApprovalRow = readonly [
  episodeNumber: string,
  episodeSourceId: string,
  expectedEpisodeId: number,
  versionSourceId: string,
  expectedVersionId: number,
  videoId: string,
  videoTitle: string,
  observedAt: string,
];

type BeybladeSeriesDefinition = Readonly<{
  idPrefix: string;
  titleSourceId: string;
  titleSlug: string;
  expectedTitleId: number;
}>;

export type BeybladeOfficialCatalogueIdentity = Readonly<{
  approvalId: string;
  expectedTitleId: number;
  expectedEpisodeId: number;
  expectedVersionId: number;
}>;

export const BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER = Object.freeze({
  label: 'BEYBLADE English - Official Channel',
  channelId: 'UCktgoAFaL39_rYfiMZiD9jw',
  channelUrl: 'https://www.youtube.com/channel/UCktgoAFaL39_rYfiMZiD9jw',
  handleUrl: 'https://www.youtube.com/@BeybladeOfficial',
}) satisfies Readonly<OfficialYouTubePublisher>;

export const BEYBLADE_OFFICIAL_PUBLISHER_IDENTITY_URL = 'https://beyblade.com/episodes/';

const catalogueIdentities: BeybladeOfficialCatalogueIdentity[] = [];

function buildBeybladeSeriesApprovals(
  definition: BeybladeSeriesDefinition,
  rows: readonly BeybladeOfficialApprovalRow[],
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
    if (versionSourceId !== `${episodeSourceId}:dub`) {
      throw new Error(`INVALID_BEYBLADE_DUB_IDENTITY:${definition.idPrefix}:${episodeNumber}`);
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
        language: 'dub',
      },
      video: {
        id: videoId,
        title: videoTitle,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
        channelId: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.channelId,
        channelUrl: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.channelUrl,
        handleUrl: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.handleUrl,
      },
      publisherIdentityUrl: BEYBLADE_OFFICIAL_PUBLISHER_IDENTITY_URL,
      titleIdentityUrl: BEYBLADE_OFFICIAL_PUBLISHER_IDENTITY_URL,
      episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,
      observedAt,
    });
  }));
}

// Explicit rows from the immutable 2026-09-15 strict review. Numeric IDs
// are audit evidence; runtime lookup remains fail-closed on the stable
// title, slug, episode, version, and dub-language identities.
export const BEYBLADE_X_OFFICIAL_APPROVAL_ROWS = [
  ["1", "98983", 3852, "98983:dub", 5732, "v9ok0BuXnZc", "BEYBLADE X | NEW EPISODE! | Ep.1 X", "2026-09-15T19:09:46.012Z"],
  ["2", "98984", 3853, "98984:dub", 5734, "fR1bGAsXebU", "BEYBLADE X | NEW EPISODE! | Ep.2 Multi-Colored Ambush", "2026-09-15T19:09:46.038Z"],
  ["3", "98985", 3854, "98985:dub", 5736, "yhrsDPZiG1U", "BEYBLADE X | NEW EPISODE! | Ep.3 Team Persona", "2026-09-15T19:09:46.029Z"],
  ["4", "98986", 3855, "98986:dub", 5738, "5gMkOr0aW-0", "BEYBLADE X | NEW EPISODE! | Ep.4 Bey Sponsor", "2026-09-15T19:09:45.998Z"],
  ["5", "98987", 3856, "98987:dub", 5740, "Lo5lNjHXuVA", "BEYBLADE X | NEW EPISODE! | Ep.5 To The X", "2026-09-15T19:09:46.004Z"],
  ["6", "98988", 3857, "98988:dub", 5742, "8TS0uYE3YNw", "BEYBLADE X | NEW EPISODE! | Ep.6 Lion’s Jungle", "2026-09-15T19:09:45.997Z"],
  ["7", "98989", 3858, "98989:dub", 5744, "9hPrddHLXcY", "BEYBLADE X | NEW EPISODE! | Ep.7 Team Zooganic", "2026-09-15T19:09:45.983Z"],
  ["8", "98990", 3859, "98990:dub", 5746, "tJoUo9X9PL0", "BEYBLADE X | NEW EPISODE! | Ep.8 The Mask and the King", "2026-09-15T19:09:45.975Z"],
  ["9", "98991", 3860, "98991:dub", 5748, "ALMLqyhd_yw", "BEYBLADE X | NEW EPISODE! | Ep.9 Beycrafter", "2026-09-15T19:09:46.005Z"],
  ["10", "98992", 3861, "98992:dub", 5750, "EWUv6geNP6E", "BEYBLADE X | NEW EPISODE! | Ep.10 The Pro Realm", "2026-09-15T19:09:45.967Z"],
  ["11", "98993", 3862, "98993:dub", 5752, "wAMniA2oNS0", "BEYBLADE X | NEW EPISODE! | Ep.11 Warden’s Exam", "2026-09-15T19:09:45.946Z"],
  ["12", "98994", 3863, "98994:dub", 5754, "4doX8fwPos0", "BEYBLADE X | NEW EPISODE! | Ep.12 The Final Battle", "2026-09-15T19:09:45.964Z"],
  ["13", "98995", 3864, "98995:dub", 5756, "qUi7onzFfLw", "BEYBLADE X | NEW EPISODE! | Ep.13 The First Fan", "2026-09-15T19:09:45.951Z"],
  ["14", "98996", 3865, "98996:dub", 5758, "ze3Byfzjkgs", "BEYBLADE X | NEW EPISODE! | Ep.14 Jax-ercise", "2026-09-15T19:09:45.941Z"],
  ["15", "98997", 3866, "98997:dub", 5760, "tjOKXv9hkC0", "BEYBLADE X | NEW EPISODE! | Ep.15 Riddles and Beys", "2026-09-15T19:09:45.913Z"],
  ["16", "98998", 3867, "98998:dub", 5762, "v_ijy4nv-jI", "BEYBLADE X | NEW EPISODE! | Ep.16 Noblesse Oblige", "2026-09-15T19:09:45.937Z"],
  ["17", "98999", 3868, "98999:dub", 5764, "_Z50em4bJBA", "BEYBLADE X | NEW EPISODE! | Ep.17 Bey Timeshift", "2026-09-15T19:09:45.919Z"],
  ["18", "99000", 3869, "99000:dub", 5766, "Pu4j12uk2QQ", "BEYBLADE X | NEW EPISODE! | Ep.18 Pride", "2026-09-15T19:09:45.909Z"],
  ["19", "99001", 3870, "99001:dub", 5768, "tuHpN5VjpsM", "BEYBLADE X | NEW EPISODE! | Ep.19 Zip and Zoom", "2026-09-15T19:09:45.892Z"],
  ["20", "99002", 3871, "99002:dub", 5770, "g3BGdWJ3mpY", "BEYBLADE X | NEW EPISODE! | Ep.20 Memories of Sushi", "2026-09-15T19:09:45.897Z"],
  ["21", "99003", 3872, "99003:dub", 5772, "NW4lg8omxRI", "BEYBLADE X | NEW EPISODE! | Ep. 21 Popularity Production", "2026-09-15T19:09:45.906Z"],
  ["22", "99004", 3873, "99004:dub", 5774, "3xaDXBHP8P0", "BEYBLADE X | NEW EPISODE! | Ep. 22 Black and White", "2026-09-15T19:09:45.878Z"],
  ["23", "99005", 3874, "99005:dub", 5776, "cip2-QiRozo", "BEYBLADE X | NEW EPISODE! | Ep. 23 True Heart", "2026-09-15T19:09:45.855Z"],
  ["24", "99006", 3875, "99006:dub", 5778, "ZvJo_pwU7yE", "BEYBLADE X | NEW EPISODE! | Ep. 24 Arrival of The Fastest", "2026-09-15T19:09:45.872Z"],
  ["25", "99007", 3876, "99007:dub", 5780, "rGVXhLRIdBQ", "BEYBLADE X | NEW EPISODE! | Ep. 25 Proof of the Fastest", "2026-09-15T19:09:45.836Z"],
  ["26", "99008", 3877, "99008:dub", 5782, "khtppjltlIE", "BEYBLADE X | NEW EPISODE! | Ep.26 Invitation", "2026-09-15T19:09:45.850Z"],
  ["27", "99009", 3878, "99009:dub", 5784, "2bHqu9iBZhM", "BEYBLADE X | NEW EPISODE! | Ep.27 The End of Persistence", "2026-09-15T19:09:45.873Z"],
  ["28", "99010", 3879, "99010:dub", 5786, "Kl95nTncaYw", "BEYBLADE X | NEW EPISODE! | Ep.28 The King and The Phoenix", "2026-09-15T19:09:45.841Z"],
  ["29", "99011", 3880, "99011:dub", 5788, "t3trMEyuj_U", "BEYBLADE X | NEW EPISODE! | Ep.29 Mask and Meat Buns", "2026-09-15T19:09:45.836Z"],
  ["30", "99012", 3881, "99012:dub", 5790, "n6AiOQ-OYM4", "BEYBLADE X | NEW EPISODE! | Ep.30 Riddles and Pop", "2026-09-15T19:09:45.814Z"],
  ["31", "99013", 3882, "99013:dub", 5792, "hLPYt1iCGHM", "BEYBLADE X | NEW EPISODE! | Ep.31 My Teammates", "2026-09-15T19:09:45.798Z"],
  ["32", "99014", 3883, "99014:dub", 5794, "09cUqiXcb30", "BEYBLADE X | NEW EPISODE! | Ep.32 New Partner", "2026-09-15T19:09:45.820Z"],
  ["33", "99015", 3884, "99015:dub", 5796, "K5Tb-teGiN8", "BEYBLADE X | NEW EPISODE! | Ep.33 Our Promise", "2026-09-15T19:09:45.764Z"],
  ["34", "99016", 3885, "99016:dub", 5798, "yJwJh1PaiXc", "BEYBLADE X | NEW EPISODE! | Ep.34 A Rainbow Guest", "2026-09-15T19:09:45.800Z"],
  ["35", "99017", 3886, "99017:dub", 5800, "-1wRWcHtcII", "BEYBLADE X | NEW EPISODE! | Ep.35 The Dream Contest", "2026-09-15T19:09:45.776Z"],
  ["36", "99018", 3887, "99018:dub", 5802, "pknVESfhjgY", "BEYBLADE X | NEW EPISODE! | Ep.36 Bladership", "2026-09-15T19:09:45.788Z"],
  ["37", "99019", 3888, "99019:dub", 5804, "xurHtmK0K-w", "BEYBLADE X | NEW EPISODE! | Ep.37 Unpredictable", "2026-09-15T19:09:45.777Z"],
  ["38", "99020", 3889, "99020:dub", 5806, "zrm3i15Mwlg", "BEYBLADE X | NEW EPISODE! | Ep.38 Return of the Queen", "2026-09-15T19:09:45.762Z"],
  ["39", "99021", 3890, "99021:dub", 5808, "GAQ61Dl3WUE", "BEYBLADE X | NEW EPISODE! | Ep.39 The Greatest Blader", "2026-09-15T19:09:45.725Z"],
  ["40", "99022", 3891, "99022:dub", 5810, "4uxz_0BYG8M", "BEYBLADE X | NEW EPISODE! | Ep.40 The Other Mask", "2026-09-15T19:09:45.723Z"],
  ["41", "99023", 3892, "99023:dub", 5812, "2yXaxUEpbCU", "BEYBLADE X | NEW EPISODE! | Ep.41 The Three Masks", "2026-09-15T19:09:45.729Z"],
  ["42", "99024", 3893, "99024:dub", 5814, "ZUr6U_uh8nU", "BEYBLADE X | NEW EPISODE! | Ep.42 XYZ", "2026-09-15T19:09:45.712Z"],
  ["43", "99025", 3894, "99025:dub", 5816, "CkA8gB5qPdo", "BEYBLADE X | NEW EPISODE! | Ep.43 Pendragon, Back Then", "2026-09-15T19:09:45.691Z"],
  ["44", "99026", 3895, "99026:dub", 5818, "TG5exeEy6gI", "BEYBLADE X | NEW EPISODE! | Ep.44 Family, Back Then", "2026-09-15T19:09:45.706Z"],
  ["45", "99027", 3896, "99027:dub", 5820, "LTC6KV4nIps", "BEYBLADE X | NEW EPISODE! | Ep.45 You, Back Then", "2026-09-15T19:09:45.671Z"],
  ["46", "99028", 3897, "99028:dub", 5822, "eZeZ8qwqylA", "BEYBLADE X | NEW EPISODE! | Ep.46 Time Off", "2026-09-15T19:09:45.751Z"],
  ["47", "99029", 3898, "99029:dub", 5824, "UuX0kmU1V4o", "BEYBLADE X | NEW EPISODE! | Ep.47 Battle at the Top", "2026-09-15T19:09:45.662Z"],
  ["48", "99030", 3899, "99030:dub", 5826, "5AlXujnYCtY", "BEYBLADE X | NEW EPISODE! | Ep.48 The Nana-iro Showdown", "2026-09-15T19:09:45.632Z"],
  ["49", "99031", 3900, "99031:dub", 5828, "RaA6cqYli38", "BEYBLADE X | NEW EPISODE! | Ep.49 Something Xtraordinary", "2026-09-15T19:09:45.652Z"],
  ["50", "99032", 3901, "99032:dub", 5830, "nIHZCREARfI", "BEYBLADE X | NEW EPISODE! | Ep.50 The Two Xs", "2026-09-15T19:09:45.662Z"],
  ["51", "99033", 3902, "99033:dub", 5832, "pv4X2w4yUhA", "BEYBLADE X | NEW EPISODE! | Ep.51 The Most Fun Ever", "2026-09-15T19:09:45.618Z"],
  ["52", "111995", 3903, "111995:dub", 5834, "21_KQbzw6K4", "BEYBLADE X | NEW EPISODE! | Ep.52 Restart", "2026-09-15T19:09:45.618Z"],
  ["53", "112201", 3904, "112201:dub", 5836, "heWZLJqdGD4", "BEYBLADE X | NEW EPISODE! | Ep.53 Signs of a New Era", "2026-09-15T19:09:45.600Z"],
  ["54", "112202", 3905, "112202:dub", 5838, "Eojh3GN4CBE", "BEYBLADE X | NEW EPISODE! | Ep.54 Path of Resolve", "2026-09-15T19:09:45.588Z"],
  ["55", "112203", 3906, "112203:dub", 5840, "ceebkcNFnwY", "BEYBLADE X | NEW EPISODE! | Ep.55 Advance Bey Timeshift", "2026-09-15T19:09:45.723Z"],
  ["56", "112204", 3907, "112204:dub", 5842, "SEdaB6lb8aE", "BEYBLADE X | NEW EPISODE! | Ep.56 Star Plot", "2026-09-15T19:09:45.584Z"],
  ["57", "112504", 3908, "112504:dub", 5844, "a3rwXxbHQZw", "BEYBLADE X | NEW EPISODE! | Ep.57 Tri-Blader Battle", "2026-09-15T19:09:45.588Z"],
  ["58", "112524", 3909, "112524:dub", 5846, "K3OUqiMozTg", "BEYBLADE X | NEW EPISODE! | Ep.58 Triple Battle", "2026-09-15T19:09:45.571Z"],
  ["59", "113273", 3910, "113273:dub", 5848, "GulxnC2Jy5M", "BEYBLADE X | NEW EPISODE! | Ep.59 Blader S", "2026-09-15T19:09:45.596Z"],
  ["60", "113812", 3911, "113812:dub", 5850, "oizfQiU15fU", "BEYBLADE X | NEW EPISODE! | Ep.60 Multi-Colored Trial", "2026-09-15T19:09:45.590Z"],
  ["61", "114298", 3912, "114298:dub", 5852, "dcl0r5VLm10", "BEYBLADE X | NEW EPISODE! | Ep.61 Invincible", "2026-09-15T19:09:45.521Z"],
  ["62", "114519", 3913, "114519:dub", 5854, "5m200vHJCsM", "BEYBLADE X | NEW EPISODE! | Ep.62 The Prestigious Bey Academy", "2026-09-15T19:09:45.521Z"],
  ["63", "115098", 3914, "115098:dub", 5856, "r4LiBIFZ6xs", "BEYBLADE X | NEW EPISODE! | Ep.63 The Manju Clan", "2026-09-15T19:09:45.538Z"],
  ["64", "115137", 3915, "115137:dub", 5858, "HfGJSGTj4YY", "BEYBLADE X | NEW EPISODE! | Ep.64 The Shapeless Shadow", "2026-09-15T19:09:45.538Z"],
  ["65", "115268", 3916, "115268:dub", 5860, "uhVMF8-qj9Y", "BEYBLADE X | NEW EPISODE! | Ep.65 First Flight", "2026-09-15T19:09:45.555Z"],
  ["66", "115365", 3917, "115365:dub", 5862, "_c-AonHus4w", "BEYBLADE X | NEW EPISODE! | Ep.66 Something Captivating", "2026-09-15T19:09:45.546Z"],
  ["67", "115604", 3918, "115604:dub", 5864, "Obf5b3eTbnA", "BEYBLADE X | NEW EPISODE! | Ep.67 Silver Wolf", "2026-09-15T19:09:45.526Z"],
  ["68", "115807", 3919, "115807:dub", 5866, "cRq7PmDKrl8", "BEYBLADE X | NEW EPISODE! | Ep.68 Light and Dark", "2026-09-15T19:09:45.502Z"],
  ["69", "115922", 3920, "115922:dub", 5868, "hFhZSxs8Y50", "BEYBLADE X | NEW EPISODE! | Ep.69 Shadowy Underground", "2026-09-15T19:09:45.475Z"],
  ["70", "116445", 3921, "116445:dub", 5870, "AlXBSh3mGJs", "BEYBLADE X | NEW EPISODE! | Ep.70 Dread Dragon", "2026-09-15T19:09:45.478Z"],
  ["71", "116672", 3922, "116672:dub", 5872, "y-8O_3HABBo", "BEYBLADE X | NEW EPISODE! | Ep.71 To That Place", "2026-09-15T19:09:45.470Z"],
  ["72", "116736", 3923, "116736:dub", 5874, "FbKlB73cR8M", "BEYBLADE X | NEW EPISODE! | Ep.72 Labyrinth of Riddles and Terror", "2026-09-15T19:09:45.475Z"],
  ["73", "117061", 3924, "117061:dub", 5876, "kk3d3jG74wY", "BEYBLADE X | NEW EPISODE! | Ep.73 The Star Battle", "2026-09-15T19:09:45.462Z"],
  ["74", "117127", 3925, "117127:dub", 5878, "o2eE0yT-ERg", "BEYBLADE X | NEW EPISODE! | Ep.74 Cursed", "2026-09-15T19:09:45.460Z"],
  ["75", "117229", 3926, "117229:dub", 5880, "MNWL8IG41Aw", "BEYBLADE X | NEW EPISODE! | Ep.75 Return of the Knight", "2026-09-15T19:09:45.431Z"],
  ["76", "117414", 3927, "117414:dub", 5882, "XxoraKRhWUA", "BEYBLADE X | NEW EPISODE! | Ep.76 White Nova", "2026-09-15T19:09:45.475Z"],
  ["77", "117517", 3928, "117517:dub", 5884, "HnfIZA9zSxc", "BEYBLADE X | NEW EPISODE! | Ep.77 Blue Dragon and Dread Dragon", "2026-09-15T19:09:45.437Z"],
  ["78", "120142", 3929, "120142:dub", 5886, "sInAjn0_6vg", "BEYBLADE X | NEW EPISODE! | Ep.78 Customization", "2026-09-15T19:09:45.431Z"],
  ["79", "120372", 3930, "120372:dub", 5888, "t--GuJXfQNU", "BEYBLADE X | NEW EPISODE! | Ep.79 King and Queen", "2026-09-15T19:09:45.428Z"],
  ["80", "120666", 3931, "120666:dub", 5890, "4_8rWQeRpSo", "BEYBLADE X | NEW EPISODE! | Ep.80 The Gradual One", "2026-09-15T19:09:45.381Z"],
  ["81", "120700", 3932, "120700:dub", 5892, "ABDBiKn0dCw", "BEYBLADE X | NEW EPISODE! | Ep.81 All In", "2026-09-15T19:09:45.360Z"],
  ["82", "120911", 3933, "120911:dub", 5894, "UN_sJ6MADpk", "BEYBLADE X | NEW EPISODE! | Ep.82 Multi-Colored Decision", "2026-09-15T19:09:45.374Z"],
  ["83", "121070", 3934, "121070:dub", 5896, "cJPKfBxUFb8", "BEYBLADE X | NEW EPISODE! | Ep.83 Partner", "2026-09-15T19:09:45.316Z"],
  ["84", "121260", 3935, "121260:dub", 5898, "VVlq9dBGh_c", "BEYBLADE X | NEW EPISODE! | Ep.84 Proxy Conflict", "2026-09-15T19:09:45.316Z"],
  ["85", "121615", 3936, "121615:dub", 5900, "Cu5kDPoS8_4", "BEYBLADE X | NEW EPISODE! | Ep.85 Pop vs Curse", "2026-09-15T19:09:45.293Z"],
  ["86", "121787", 3937, "121787:dub", 5902, "H4g4Or4xJw0", "BEYBLADE X | NEW EPISODE! | Ep.86 Red Confrontation", "2026-09-15T19:09:45.271Z"],
  ["87", "121932", 3938, "121932:dub", 5904, "ltCNnWgZq0k", "BEYBLADE X | NEW EPISODE! | Ep.87 Path of the Dread Dragon", "2026-09-15T19:09:45.077Z"],
  ["88", "122070", 3939, "122070:dub", 5906, "MyyppeW9yT0", "BEYBLADE X | NEW EPISODE! | Ep.88 Blading Soul", "2026-09-15T19:09:45.064Z"],
  ["89", "122480", 3940, "122480:dub", 5908, "L31t8gpMNt4", "BEYBLADE X | NEW EPISODE! | Ep.89 What Must be Done", "2026-09-15T19:09:45.044Z"],
  ["90", "122516", 3941, "122516:dub", 5910, "u1COiJHm2ko", "BEYBLADE X | NEW EPISODE! | Ep.90 Nine-Tailed Fox", "2026-09-15T19:09:45.006Z"],
  ["91", "122635", 3942, "122635:dub", 5912, "Ge4dA66S-7s", "BEYBLADE X | NEW EPISODE! | Ep.91 Dream Match", "2026-09-15T19:09:44.973Z"],
  ["92", "123119", 3943, "123119:dub", 5914, "oDtlEqvbi04", "BEYBLADE X | NEW EPISODE! | Ep.92 Perseus the Messenger", "2026-09-15T19:09:44.960Z"],
  ["93", "123231", 3944, "123231:dub", 5916, "82-7NxOYsig", "BEYBLADE X | NEW EPISODE! | Ep.93 Super Champion Challenger Chooser Match", "2026-09-15T19:09:44.926Z"],
  ["94", "123502", 3945, "123502:dub", 5918, "LCR6Q77k2Cw", "BEYBLADE X | NEW EPISODE! | Ep.94 Unknown", "2026-09-15T19:09:44.942Z"],
  ["95", "124751", 3946, "124751:dub", 5920, "vgVHOVkPTLA", "BEYBLADE X | NEW EPISODE! | Ep.95 Foxes Enchant, Tanukis Bewitch", "2026-09-15T19:09:44.922Z"],
] as const satisfies readonly BeybladeOfficialApprovalRow[];

export const BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS = buildBeybladeSeriesApprovals({
  idPrefix: "beyblade-official-beyblade-x",
  titleSourceId: "6414",
  titleSlug: "beyblade-x-aj6fn",
  expectedTitleId: 110,
}, BEYBLADE_X_OFFICIAL_APPROVAL_ROWS);

export const BEYBLADE_BURST_TURBO_OFFICIAL_APPROVAL_ROWS = [
  ["1", "81229", 59788, "81229:dub", 77128, "sj6_oe5Z0oU", "BEYBLADE BURST TURBO Episode 1: Time to go Turbo! Videos For Kids", "2026-09-15T19:09:46.365Z"],
  ["2", "81230", 59789, "81230:dub", 77130, "CVd5P5IyTLU", "BEYBLADE BURST TURBO Episode 2: Achilles Vs Forneus", "2026-09-15T19:09:46.371Z"],
  ["3", "81231", 59790, "81231:dub", 77132, "IMHVPqa3qLE", "BEYBLADE BURST TURBO Episode 3: Duel At Sunset", "2026-09-15T19:09:46.361Z"],
  ["4", "81232", 59791, "81232:dub", 77134, "hMJ4QEfmbsc", "BEYBLADE BURST TURBO Episode 4: Land it! Z Breaker! Videos For Kids", "2026-09-15T19:09:46.385Z"],
  ["5", "81233", 59792, "81233:dub", 77136, "igwOcZEOJkw", "BEYBLADE BURST TURBO Episode 5: Turbo Match! Valtryek Vs Luinor!", "2026-09-15T19:09:46.362Z"],
  ["6", "81234", 59793, "81234:dub", 77138, "ei2dcxo34rY", "BEYBLADE BURST TURBO Episode 6: Winter Knight! Battle Royale!", "2026-09-15T19:09:46.331Z"],
  ["7", "81235", 59794, "81235:dub", 77140, "wIgkZ4H8xY8", "BEYBLADE BURST TURBO Episode 7 : Curtains Rise! The Luinor Cup!", "2026-09-15T19:09:46.321Z"],
  ["8", "81236", 59795, "81236:dub", 77142, "Lp_j2aTtP2M", "BEYBLADE BURST TURBO Episode 8 : Transformation! Heat Salamander!", "2026-09-15T19:09:46.321Z"],
  ["9", "81237", 59796, "81237:dub", 77144, "8r383-QwjFc", "BEYBLADE BURST TURBO Episode 9 : Swirling Inferno!", "2026-09-15T19:09:46.312Z"],
  ["10", "81238", 59797, "81238:dub", 77146, "160yA95jqrE", "BEYBLADE BURST TURBO Episode 10 : Achilles vs Roktavor!", "2026-09-15T19:09:46.310Z"],
  ["11", "81239", 59798, "81239:dub", 77148, "2ESqqavoSjs", "BEYBLADE BURST TURBO Episode 11 : Battle of Betrayal", "2026-09-15T19:09:46.311Z"],
  ["12", "81240", 59799, "81240:dub", 77150, "KVEyb-sh4_I", "BEYBLADE BURST TURBO Episode 12 : \"Bull’s-eye! Archer Hercules!\"", "2026-09-15T19:09:46.343Z"],
  ["13", "81241", 59800, "81241:dub", 77152, "GxNpNBBXmnI", "BEYBLADE BURST TURBO Episode 13 : \"Lúinor Cup! Final Battle!\"", "2026-09-15T19:09:46.277Z"],
  ["14", "81242", 59801, "81242:dub", 77154, "_f9JdpRdUBk", "BEYBLADE BURST TURBO Episode 14 : Raging Dragon! Brutal Lúinor!", "2026-09-15T19:09:46.294Z"],
  ["15", "81243", 59802, "81243:dub", 77156, "ZgbF-Xy-DTg", "BEYBLADE BURST TURBO Episode 15 : Trial by Fire! Defeat Lui!", "2026-09-15T19:09:46.284Z"],
  ["16", "81244", 59803, "81244:dub", 77158, "bVrOM9WAYYQ", "BEYBLADE BURST TURBO Episode 16 : Epic Voyage! Battleship Cruise!", "2026-09-15T19:09:46.258Z"],
  ["17", "81245", 59804, "81245:dub", 77160, "0O-45yj4Inc", "BEYBLADE BURST TURBO Episode 17 : Sword of the Legendary Hero!", "2026-09-15T19:09:46.292Z"],
  ["18", "81246", 59805, "81246:dub", 77162, "6jo2jSsSl-4", "BEYBLADE BURST TURBO Episode 18 : Ghost Ship! Adventure on the High Seas!", "2026-09-15T19:09:46.254Z"],
  ["19", "81247", 59806, "81247:dub", 77164, "J7YvjEzsemI", "BEYBLADE BURST TURBO Episode 19 : Super Rumble! Beyathlon!", "2026-09-15T19:09:46.245Z"],
  ["20", "81248", 59807, "81248:dub", 77166, "B7C41yz_-_A", "BEYBLADE BURST TURBO Episode 20 : Explosive Flames! Revive Phoenix!", "2026-09-15T19:09:46.266Z"],
  ["21", "81249", 59808, "81249:dub", 77168, "lZdKJReT9ys", "BEYBLADE BURST TURBO Episode 21 : Cooperation! Tag-Team Battle!", "2026-09-15T19:09:46.245Z"],
  ["22", "81250", 59809, "81250:dub", 77170, "iRp1eSvM33I", "BEYBLADE BURST TURBO Episode 22 : Three-Way Stand-Off!", "2026-09-15T19:09:46.221Z"],
  ["23", "81251", 59810, "81251:dub", 77172, "R91XjrJA3xs", "BEYBLADE BURST TURBO Episode 23 : Operation: Protect the Bey Stars!", "2026-09-15T19:09:46.211Z"],
  ["24", "81252", 59811, "81252:dub", 77174, "nIS6PsyedO4", "BEYBLADE BURST TURBO Episode 24 : Achilles vs Xcalius!", "2026-09-15T19:09:46.211Z"],
  ["25", "81253", 59812, "81253:dub", 77176, "2ihdGoH58RQ", "BEYBLADE BURST TURBO Episode 25 : Super Dragon! Geist Fafnir!", "2026-09-15T19:09:46.201Z"],
  ["26", "81254", 59813, "81254:dub", 77178, "kmsBPMzzjUM", "BEYBLADE BURST TURBO Episode 26 : Battleship Cruise! Final Voyage!", "2026-09-15T19:09:46.222Z"],
  ["27", "81255", 59814, "81255:dub", 77180, "8NxBYRacGjk", "BEYBLADE BURST TURBO Episode 27 : Road to Glory!", "2026-09-15T19:09:46.214Z"],
  ["28", "81256", 59815, "81256:dub", 77182, "YKGTwApaZSE", "BEYBLADE BURST TURBO Episode 28 : Valt vs Aiger!", "2026-09-15T19:09:46.198Z"],
  ["29", "81257", 59816, "81257:dub", 77184, "eX99EpwUvZI", "BEYBLADE BURST TURBO Episode 29 : Dark Prince! Dread Hades!", "2026-09-15T19:09:46.180Z"],
  ["30", "81258", 59817, "81258:dub", 77186, "AcN58XAA4UA", "BEYBLADE BURST TURBO Episode 30 : Aiger Goes Wild!", "2026-09-15T19:09:46.175Z"],
  ["31", "81259", 59818, "81259:dub", 77188, "KpDXb5xhuyA", "BEYBLADE BURST TURBO Episode 31 : Rebirth! Turbo Valtryek!", "2026-09-15T19:09:46.189Z"],
  ["32", "81260", 59819, "81260:dub", 77190, "LesSZo1jkpk", "BEYBLADE BURST TURBO Episode 32 : Dark Citadel! The Dread Tower!", "2026-09-15T19:09:46.168Z"],
  ["33", "81261", 59820, "81261:dub", 77192, "bEmDNGmHEFY", "BEYBLADE BURST TURBO Episode 33 : Trapped in the Dread Tower!", "2026-09-15T19:09:46.161Z"],
  ["35", "81263", 59822, "81263:dub", 77196, "bRcRGiLUMJc", "BEYBLADE BURST TURBO Episode 35 : Spirit of Flame! Turbo Spryzen!", "2026-09-15T19:09:46.146Z"],
  ["36", "81264", 59823, "81264:dub", 77198, "a-Ab_GqIzNc", "BEYBLADE BURST TURBO Episode 36 : The Darkness Within!", "2026-09-15T19:09:46.132Z"],
  ["37", "81265", 59824, "81265:dub", 77200, "IHSUMkMsJuo", "BEYBLADE BURST TURBO Episode 37 : Turbo Clash! Showdown at the Dark Citadel!", "2026-09-15T19:09:46.128Z"],
  ["38", "81266", 59825, "81266:dub", 77202, "VJQL1vaJYaM", "BEYBLADE BURST TURBO Episode 38 : Rebirth! Turbo Achilles!", "2026-09-15T19:09:46.120Z"],
  ["39", "81267", 59826, "81267:dub", 77204, "D2MofBvhefU", "BEYBLADE BURST TURBO Episode 39 : Aiger's Rematch! Unbreakable Bond!", "2026-09-15T19:09:46.103Z"],
  ["40", "81268", 59827, "81268:dub", 77206, "SfPoucL37h0", "BEYBLADE BURST TURBO Episode 40 : Master of the Wind! Air Knight!", "2026-09-15T19:09:46.092Z"],
  ["41", "81269", 59828, "81269:dub", 77208, "Wb52_HL_hn8", "BEYBLADE BURST TURBO Episode 41 : Hyde vs Phi!", "2026-09-15T19:09:46.110Z"],
  ["42", "81270", 59829, "81270:dub", 77210, "72mduy7mQr8", "BEYBLADE BURST TURBO Episode 42 : Battle Royale! Beyblade Heroes!", "2026-09-15T19:09:46.162Z"],
  ["43", "81271", 59830, "81271:dub", 77212, "dq-h4yxOqZM", "BEYBLADE BURST TURBO Episode 43 : Lord of Destruction! Dread Phoenix!", "2026-09-15T19:09:46.084Z"],
  ["44", "81272", 59831, "81272:dub", 77214, "CwEppX-afJU", "BEYBLADE BURST TURBO Episode 44 : Turbo Training! Xavier’s Kingdom!", "2026-09-15T19:09:46.075Z"],
  ["45", "81273", 59832, "81273:dub", 77216, "v81BTWXnj9s", "BEYBLADE BURST TURBO Episode 45 : Turbo Training! Survival on the Savanna!", "2026-09-15T19:09:46.095Z"],
  ["46", "81274", 59833, "81274:dub", 77218, "HDVGlcU_K88", "BEYBLADE BURST TURBO Episode 46 : Take Flight! Aerial Showdown!", "2026-09-15T19:09:46.058Z"],
  ["47", "81275", 59834, "81275:dub", 77220, "dBgsNYOZx94", "BEYBLADE BURST TURBO Episode 47 : Spirit of Flame vs Lord of Destruction!", "2026-09-15T19:09:46.046Z"],
  ["48", "81276", 59835, "81276:dub", 77222, "aRhrGdIvIho", "BEYBLADE BURST TURBO Episode 48 : Blading Together! Turbo Awakening!", "2026-09-15T19:09:46.050Z"],
  ["49", "81277", 59836, "81277:dub", 77224, "9uEN0RAbXCk", "BEYBLADE BURST TURBO Episode 49 : Aiger vs Phi!", "2026-09-15T19:09:46.034Z"],
  ["51", "81279", 59838, "81279:dub", 77228, "9bZOc1Sojtg", "BEYBLADE BURST TURBO Episode 51 : Bonding! Aiger vs Valt!", "2026-09-15T19:09:46.060Z"],
] as const satisfies readonly BeybladeOfficialApprovalRow[];

export const BEYBLADE_BURST_TURBO_OFFICIAL_EPISODE_APPROVALS = buildBeybladeSeriesApprovals({
  idPrefix: "beyblade-official-burst-turbo",
  titleSourceId: "5136",
  titleSlug: "beyblade-burst-turbo-kogdk",
  expectedTitleId: 3979,
}, BEYBLADE_BURST_TURBO_OFFICIAL_APPROVAL_ROWS);

export const BEYBLADE_BURST_OFFICIAL_APPROVAL_ROWS = [
  ["1", "74343", 66576, "74343:dub", 85595, "14jIoizA--c", "BEYBLADE BURST Episode 1: Let’s Go! Valtryek!", "2026-09-15T19:09:46.818Z"],
  ["2", "74344", 66577, "74344:dub", 85597, "QSYDxm-ySY8", "BEYBLADE BURST Episode 2: Kerbeus: Guard Dog of the Underworld!", "2026-09-15T19:09:46.139Z"],
  ["3", "74345", 66578, "74345:dub", 85599, "oTTkkalya5Y", "BEYBLADE BURST Episode 3: Blast Off! Rush Launch!", "2026-09-15T19:09:46.810Z"],
  ["4", "74346", 66579, "74346:dub", 85601, "Vft4GDdOhrk", "BEYBLADE BURST Episode 4: Beyblade Club: Let’s Get Started!", "2026-09-15T19:09:46.780Z"],
  ["13", "74355", 66588, "74355:dub", 85619, "ml31HDr6J1g", "BEYBLADE BURST Episode 13: Shu's Test!", "2026-09-15T19:09:46.126Z"],
] as const satisfies readonly BeybladeOfficialApprovalRow[];

export const BEYBLADE_BURST_OFFICIAL_EPISODE_APPROVALS = buildBeybladeSeriesApprovals({
  idPrefix: "beyblade-official-burst",
  titleSourceId: "4540",
  titleSlug: "beyblade-burst-tulpp",
  expectedTitleId: 4568,
}, BEYBLADE_BURST_OFFICIAL_APPROVAL_ROWS);

export const BEYBLADE_METAL_FUSION_OFFICIAL_APPROVAL_ROWS = [
  ["1", "62306", 78298, "62306:dub", 100195, "q8l9UGsmvWs", "BEYBLADE METAL FUSION | Ep.1 Pegasus Has Landed!", "2026-09-15T19:09:45.410Z"],
  ["2", "62307", 78299, "62307:dub", 100197, "d7do-uEMWdY", "BEYBLADE METAL FUSION | Ep.2 Leone’s Roar", "2026-09-15T19:09:45.475Z"],
  ["3", "62308", 78300, "62308:dub", 100199, "l6Q2zyGzdiI", "BEYBLADE METAL FUSION | Ep.3 The Wolf’s Ambition!", "2026-09-15T19:09:45.416Z"],
  ["4", "62309", 78301, "62309:dub", 100201, "wzUtJBzg4Bs", "BEYBLADE METAL FUSION | Ep.4 Charge! Bull Power!", "2026-09-15T19:09:45.373Z"],
  ["5", "62310", 78302, "62310:dub", 100203, "ddP9Hk4JaG4", "BEYBLADE METAL FUSION | Ep.5 Vengeful Gasher", "2026-09-15T19:09:45.377Z"],
  ["6", "62311", 78303, "62311:dub", 100205, "kF4h4jPHPLc", "BEYBLADE METAL FUSION | Ep.6 Aquario’s Challenge", "2026-09-15T19:09:45.364Z"],
  ["7", "62312", 78304, "62312:dub", 100207, "S4N4kWSQoGM", "BEYBLADE METAL FUSION | Ep.7 It’s Our Special Move! Sagittario", "2026-09-15T19:09:45.342Z"],
  ["8", "62313", 78305, "62313:dub", 100209, "deXzwHoobR8", "BEYBLADE METAL FUSION | Ep.8 Merci’s Dangerous Trap", "2026-09-15T19:09:45.308Z"],
  ["9", "62314", 78306, "62314:dub", 100211, "NpCK26y9EvQ", "BEYBLADE METAL FUSION | Ep.9 Leone’s Counterattack", "2026-09-15T19:09:45.308Z"],
  ["10", "62315", 78307, "62315:dub", 100213, "2CgUT-jo4do", "BEYBLADE METAL FUSION | Ep.10 Heated Battle! Gingka versus Kyoya", "2026-09-15T19:09:45.271Z"],
  ["11", "62316", 78308, "62316:dub", 100215, "ETmU2uF3s7Q", "BEYBLADE METAL FUSION | Ep.11 Chase the Wolf!", "2026-09-15T19:09:45.220Z"],
  ["12", "62317", 78309, "62317:dub", 100217, "qv3smJ9cy3E", "BEYBLADE METAL FUSION | Ep.12 Infiltrate the Dark Nebula’s Castle!", "2026-09-15T19:09:45.224Z"],
  ["13", "62318", 78310, "62318:dub", 100219, "1SRnnvWUedQ", "BEYBLADE METAL FUSION | Ep.13 L-Drago Awakens!", "2026-09-15T19:09:45.210Z"],
  ["14", "62319", 78311, "62319:dub", 100221, "vYMh263VV0c", "BEYBLADE METAL FUSION | Ep.14 Memories of Ryo", "2026-09-15T19:09:45.190Z"],
  ["15", "62320", 78312, "62320:dub", 100223, "tLhXsamTU5M", "BEYBLADE METAL FUSION | Ep.15 The Mysterious Hyoma", "2026-09-15T19:09:45.155Z"],
  ["16", "62321", 78313, "62321:dub", 100225, "RaFZeRQx7vg", "BEYBLADE METAL FUSION | Ep.16 The Magnificent Aries", "2026-09-15T19:09:45.179Z"],
  ["17", "62322", 78314, "62322:dub", 100227, "NG15DHQgljI", "BEYBLADE METAL FUSION | Ep.17 The Silver Pegasus", "2026-09-15T19:09:45.140Z"],
  ["18", "62323", 78315, "62323:dub", 100229, "rtelau90QCo", "BEYBLADE METAL FUSION | Ep.18 The Green Hades", "2026-09-15T19:09:45.112Z"],
  ["19", "62324", 78316, "62324:dub", 100231, "coBBz8OyYy4", "BEYBLADE METAL FUSION | Ep.19 Conquer the Tag-Team Battle!", "2026-09-15T19:09:45.109Z"],
  ["20", "62325", 78317, "62325:dub", 100233, "yA8QSn4IK9o", "BEYBLADE METAL FUSION | Ep.20 Begin! The Survival Battle", "2026-09-15T19:09:45.112Z"],
  ["21", "62326", 78318, "62326:dub", 100235, "3ZKsWO-TQ_s", "BEYBLADE METAL FUSION | Ep.21 Warriors on the Deserted Island", "2026-09-15T19:09:45.072Z"],
  ["22", "62327", 78319, "62327:dub", 100237, "UXHDT6xqv9Q", "BEYBLADE METAL FUSION | Ep.22 The Fearsome Libra", "2026-09-15T19:09:45.080Z"],
  ["23", "62328", 78320, "62328:dub", 100239, "74H3H7c-Ark", "BEYBLADE METAL FUSION | Ep.23 The Road to the Battle Bladers", "2026-09-15T19:09:45.033Z"],
  ["24", "62329", 78321, "62329:dub", 100241, "ztQItGp9apc", "BEYBLADE METAL FUSION | Ep.24 The Beautiful Eagle", "2026-09-15T19:09:45.002Z"],
  ["25", "62330", 78322, "62330:dub", 100243, "cYyqmL7WUwc", "BEYBLADE METAL FUSION | Ep.25 The Sniper, Capricorn", "2026-09-15T19:09:44.999Z"],
  ["26", "62331", 78323, "62331:dub", 100245, "8aIJRTkvLzQ", "BEYBLADE METAL FUSION | Ep.26 Tsubasa Flies into the Dark", "2026-09-15T19:09:44.981Z"],
  ["27", "62332", 78324, "62332:dub", 100247, "dpkn4AC6_m4", "BEYBLADE METAL FUSION | Ep.27 Intruders in the Challenge Match!", "2026-09-15T19:09:44.967Z"],
  ["28", "62333", 78325, "62333:dub", 100249, "YdcSSGho8PQ", "BEYBLADE METAL FUSION | Ep.28 Dark Gasher’s Big, Crabby-Crabby Operation!", "2026-09-15T19:09:44.925Z"],
] as const satisfies readonly BeybladeOfficialApprovalRow[];

export const BEYBLADE_METAL_FUSION_OFFICIAL_EPISODE_APPROVALS = buildBeybladeSeriesApprovals({
  idPrefix: "beyblade-official-metal-fusion",
  titleSourceId: "3754",
  titleSlug: "beyblade-metal-fusion-bdh7k",
  expectedTitleId: 5327,
}, BEYBLADE_METAL_FUSION_OFFICIAL_APPROVAL_ROWS);

export const BEYBLADE_METAL_MASTERS_OFFICIAL_APPROVAL_ROWS = [
  ["1", "56704", 83799, "56704:dub", 183870, "dH0rb40Cca4", "BEYBLADE METAL MASTERS | Ep.1 Seeking the Legend", "2026-09-15T19:09:45.374Z"],
  ["2", "56705", 83800, "56705:dub", 183871, "XZlhwc07mHE", "BEYBLADE METAL MASTERS | Ep.2 The Persistent Challenger", "2026-09-15T19:09:45.351Z"],
  ["3", "56706", 83801, "56706:dub", 183873, "AvHElnOrk1k", "BEYBLADE METAL MASTERS | Ep.3 A New Challenge", "2026-09-15T19:09:45.337Z"],
  ["4", "56707", 83802, "56707:dub", 183875, "EVbydcHCtNg", "BEYBLADE METAL MASTERS | Ep.4 Ticket to the World", "2026-09-15T19:09:45.326Z"],
  ["5", "56708", 83803, "56708:dub", 183872, "rzrdI-pOI54", "BEYBLADE METAL MASTERS | Ep.5 Final Battle! Leone vs. Eagle", "2026-09-15T19:09:45.297Z"],
  ["6", "56709", 83804, "56709:dub", 183874, "Dmz68ANxlkQ", "BEYBLADE METAL MASTERS | Ep.6 Soar into the World!", "2026-09-15T19:09:45.279Z"],
  ["7", "56710", 83805, "56710:dub", 183877, "Lsm_9aoRHos", "BEYBLADE METAL MASTERS | Ep.7 The Beylin Temple in the Sky", "2026-09-15T19:09:45.256Z"],
  ["8", "56711", 83806, "56711:dub", 183878, "RCfe-Q7tl3k", "BEYBLADE METAL MASTERS | Ep.8 The Third Man", "2026-09-15T19:09:45.238Z"],
  ["9", "56712", 83807, "56712:dub", 183876, "2e2MhldguWI", "BEYBLADE METAL MASTERS | Ep.9 The World Championships Begin!", "2026-09-15T19:09:45.217Z"],
  ["10", "56713", 83808, "56713:dub", 183879, "CbwUNBP2kyQ", "BEYBLADE METAL MASTERS | Ep.10 Lacerta’s Will", "2026-09-15T19:09:45.234Z"],
  ["11", "56714", 83809, "56714:dub", 183880, "GVP6ZAx0NmY", "BEYBLADE METAL MASTERS | Ep.11 The 4,000 Year Old Secret", "2026-09-15T19:09:45.210Z"],
  ["12", "56715", 83810, "56715:dub", 183881, "TbvkMiUQwQA", "BEYBLADE METAL MASTERS | Ep.12 The Bey with a Hero’s Name", "2026-09-15T19:09:45.151Z"],
  ["13", "56716", 83811, "56716:dub", 183883, "5ytkMdAsdeo", "BEYBLADE METAL MASTERS | Ep.13 The Wintry Land of Russia", "2026-09-15T19:09:45.151Z"],
  ["14", "56717", 83812, "56717:dub", 183884, "zoy5j8eB3bA", "BEYBLADE METAL MASTERS | Ep.14 How Grand! The Cage Match!", "2026-09-15T19:09:45.183Z"],
  ["15", "56718", 83813, "56718:dub", 183882, "OvuRewj0QxQ", "BEYBLADE METAL MASTERS | Ep.15 Libra Departs for the Front!", "2026-09-15T19:09:45.129Z"],
  ["16", "56719", 83814, "56719:dub", 183887, "W15H9HYuE5Y", "BEYBLADE METAL MASTERS | Ep.16 The Festival of Warriors", "2026-09-15T19:09:45.128Z"],
  ["17", "56720", 83815, "56720:dub", 183885, "1Kkg2uiJOZI", "BEYBLADE METAL MASTERS | Ep.17 We Meet Again! Wang Hu Zhong", "2026-09-15T19:09:45.090Z"],
  ["18", "56721", 83816, "56721:dub", 183886, "Ja7kQg6P9ZI", "BEYBLADE METAL MASTERS | Ep.18 The Scorching Hot Lion", "2026-09-15T19:09:45.058Z"],
  ["19", "56722", 83817, "56722:dub", 183888, "qtBX1GmB9Ow", "BEYBLADE METAL MASTERS | Ep.19 The Shocking Wild Fang", "2026-09-15T19:09:45.038Z"],
  ["20", "56723", 83818, "56723:dub", 183889, "gJh5-iJ2lFg", "BEYBLADE METAL MASTERS | Ep.20 Horuseus vs. Striker", "2026-09-15T19:09:45.058Z"],
  ["21", "56724", 83819, "56724:dub", 183890, "N_R_EDohyr4", "BEYBLADE METAL MASTERS | Ep.21 Eternal Rivals", "2026-09-15T19:09:44.973Z"],
  ["22", "56725", 83820, "56725:dub", 183891, "euluhlKf-ck", "BEYBLADE METAL MASTERS | Ep.22 The Third Match, on the Edge", "2026-09-15T19:09:44.989Z"],
  ["23", "56726", 83821, "56726:dub", 183892, "qFNCV_2VPzM", "BEYBLADE METAL MASTERS | Ep.23 The End of a Fierce Struggle!", "2026-09-15T19:09:44.936Z"],
  ["24", "56727", 83822, "56727:dub", 183893, "DH1B-UTTMfs", "BEYBLADE METAL MASTERS | Ep.24 The Creeping Darkness", "2026-09-15T19:09:44.929Z"],
  ["25", "56728", 83823, "56728:dub", 183895, "LjjKYhlr6eY", "BEYBLADE METAL MASTERS | Ep.25 The Axe of Destruction", "2026-09-15T19:09:44.927Z"],
] as const satisfies readonly BeybladeOfficialApprovalRow[];

export const BEYBLADE_METAL_MASTERS_OFFICIAL_EPISODE_APPROVALS = buildBeybladeSeriesApprovals({
  idPrefix: "beyblade-official-metal-masters",
  titleSourceId: "3370",
  titleSlug: "beyblade-metal-masters-w0bxk",
  expectedTitleId: 5705,
}, BEYBLADE_METAL_MASTERS_OFFICIAL_APPROVAL_ROWS);

export const BEYBLADE_BURST_EVOLUTION_OFFICIAL_APPROVAL_ROWS = [
  ["1", "56463", 84062, "56463:dub", 107775, "1R1YrGoqKXQ", "BEYBLADE BURST EVOLUTION Episode 1: Fresh Start! Valtryek's Evolution!", "2026-09-15T19:09:46.780Z"],
  ["2", "56464", 84063, "56464:dub", 107777, "LJ6CLQN0zxQ", "BEYBLADE BURST EVOLUTION Episode 2: Fighting Spirit! Berserk Roktavor!", "2026-09-15T19:09:46.780Z"],
  ["3", "56465", 84064, "56465:dub", 107779, "jukKs-sZ4IM", "BEYBLADE BURST EVOLUTION Episode 3: Drain Fafnir! Winding Up!", "2026-09-15T19:09:46.768Z"],
  ["4", "56466", 84065, "56466:dub", 107781, "qP3uZZ0r7bU", "BEYBLADE BURST EVOLUTION Episode 4: Whirlwind! Tempest Wyvron!", "2026-09-15T19:09:46.753Z"],
  ["5", "56467", 84066, "56467:dub", 107783, "vP9EVTkBGIQ", "BEYBLADE BURST EVOLUTION Episode 5: Surprise Attack! Kinetic Satomb!", "2026-09-15T19:09:46.826Z"],
  ["6", "56468", 84067, "56468:dub", 107785, "RZpFoavy9P4", "BEYBLADE BURST EVOLUTION Episode 6: Squad Shake Up!", "2026-09-15T19:09:46.741Z"],
  ["7", "56469", 84068, "56469:dub", 107787, "oyrkcyVaeUo", "BEYBLADE BURST EVOLUTION Episode 7: Journey to the Top!", "2026-09-15T19:09:46.748Z"],
  ["8", "56470", 84069, "56470:dub", 107789, "CcAbYf-lWMU", "BEYBLADE BURST EVOLUTION Episode 8: Season Opener! European League!", "2026-09-15T19:09:46.745Z"],
  ["9", "56471", 84070, "56471:dub", 107791, "-L1wQEeVcGE", "BEYBLADE BURST EVOLUTION Episode 9: Alter Cognite! The Shape Shifter!", "2026-09-15T19:09:46.739Z"],
  ["10", "56472", 84071, "56472:dub", 107793, "yji93G7CdKk", "BEYBLADE BURST EVOLUTION Episode 10: Free to Launch!", "2026-09-15T19:09:46.735Z"],
  ["11", "56473", 84072, "56473:dub", 107795, "6m-FrjEsmBk", "BEYBLADE BURST EVOLUTION Episode 11: BC Sol! A Team Divided!", "2026-09-15T19:09:46.707Z"],
  ["12", "56474", 84073, "56474:dub", 107797, "m0zeuE55Yqc", "BEYBLADE BURST EVOLUTION Episode 12: The Return of Doomscizor!", "2026-09-15T19:09:46.695Z"],
  ["13", "56475", 84074, "56475:dub", 107799, "L9b8oBLVfVM", "BEYBLADE BURST EVOLUTION Episode 13: Twin Scythes! Double Strike!", "2026-09-15T19:09:46.693Z"],
  ["14", "56476", 84075, "56476:dub", 107801, "71lyItF5fp8", "BEYBLADE BURST EVOLUTION Episode 14: Attack! Maximus Garuda!", "2026-09-15T19:09:46.687Z"],
  ["15", "56477", 84076, "56477:dub", 107803, "vCSJlCH-Tk0", "BEYBLADE BURST EVOLUTION Episode 15: Ghasem! The Airborne Blader!", "2026-09-15T19:09:46.693Z"],
  ["16", "56478", 84077, "56478:dub", 107805, "MUD2DOYwBII", "BEYBLADE BURST EVOLUTION Episode 16: The Search for Shu!", "2026-09-15T19:09:46.680Z"],
  ["17", "56479", 84078, "56479:dub", 107807, "XP95RJjM1i4", "BEYBLADE BURST EVOLUTION Episode 17: Shadow Magic! The Snake Pit!", "2026-09-15T19:09:46.694Z"],
  ["18", "56480", 84079, "56480:dub", 107809, "fQgqljFzowU", "BEYBLADE BURST EVOLUTION Episode 18: The Underground Maze", "2026-09-15T19:09:46.659Z"],
  ["19", "56481", 84080, "56481:dub", 107811, "EdOi3V3ufx8", "BEYBLADE BURST EVOLUTION Episode 19: Secret Fire! Red Eye!", "2026-09-15T19:09:46.651Z"],
  ["20", "56482", 84081, "56482:dub", 107813, "Ux53C6pjlvE", "BEYBLADE BURST EVOLUTION Episode 20: New Teammates! New Rivals!", "2026-09-15T19:09:46.648Z"],
  ["21", "56483", 84082, "56483:dub", 107815, "fOQZsETvTDc", "BEYBLADE BURST EVOLUTION Episode 21: Joshua vs. the Space Ninjas!", "2026-09-15T19:09:46.635Z"],
  ["22", "56484", 84083, "56484:dub", 107816, "NtoJRmvxG8g", "BEYBLADE BURST EVOLUTION Episode 22: Blast Jinnius! Caller of Storms!", "2026-09-15T19:09:46.624Z"],
  ["23", "56485", 84084, "56485:dub", 107817, "v2USwzeaT7Y", "BEYBLADE BURST EVOLUTION Episode 23: Infinity Stadium! Raul’s Challenge!", "2026-09-15T19:09:46.621Z"],
  ["24", "56486", 84085, "56486:dub", 107818, "DsbBLYSyPDs", "BEYBLADE BURST EVOLUTION Episode 24: World League! Setting the Stage!", "2026-09-15T19:09:46.614Z"],
  ["25", "56487", 84086, "56487:dub", 107819, "cTB3aXE1YIM", "BEYBLADE BURST EVOLUTION Episode 25: Showdown! Surge Xcalius!", "2026-09-15T19:09:46.627Z"],
  ["26", "56488", 84087, "56488:dub", 107820, "IcMR8Kr6TYM", "BEYBLADE BURST EVOLUTION Episode 26: Genesis Reboot!", "2026-09-15T19:09:46.567Z"],
  ["27", "56489", 84088, "56489:dub", 107821, "HiD0bEg0OYw", "BEYBLADE BURST EVOLUTION Episode 27: Worlds Collide! Home Turf! | Anime | Animation", "2026-09-15T19:09:46.566Z"],
  ["28", "56490", 84089, "56490:dub", 107822, "uNsjsaVBvi0", "BEYBLADE BURST EVOLUTION Episode 28: Vampire! Deep Caynox! | Anime | Animation", "2026-09-15T19:09:46.585Z"],
  ["29", "56491", 84090, "56491:dub", 107823, "PDkhGgqc18c", "BEYBLADE BURST EVOLUTION Episode 29: The Fortress! Shelter Regulus! | Anime | Animation", "2026-09-15T19:09:46.568Z"],
  ["30", "56492", 84091, "56492:dub", 107824, "v2H31FvicZM", "BEYBLADE BURST EVOLUTION Episode 30: Collision Course! To the Finals! | Anime | Animation", "2026-09-15T19:09:46.542Z"],
  ["31", "56493", 84092, "56493:dub", 107825, "h9k7lgsVh20", "BEYBLADE BURST EVOLUTION Episode 31: Big 5! Breaking Through! | Anime | Animation", "2026-09-15T19:09:46.531Z"],
  ["32", "56494", 84093, "56494:dub", 107826, "nZqmM2tYDA8", "BEYBLADE BURST EVOLUTION Episode 32: Unrivaled! Triple Saber! | Anime | Animation", "2026-09-15T19:09:46.541Z"],
  ["33", "56495", 84094, "56495:dub", 107827, "u4_a79IQzv0", "BEYBLADE BURST EVOLUTION Episode 33: The World League Final!", "2026-09-15T19:09:46.514Z"],
  ["34", "56496", 84095, "56496:dub", 107828, "0fPsuE_x-tI", "BEYBLADE BURST EVOLUTION Episode 34: Full Power! Spring Attack! | Anime | Animation", "2026-09-15T19:09:46.514Z"],
  ["35", "56497", 84096, "56497:dub", 107829, "7yHSUCDfs0c", "BEYBLADE BURST EVOLUTION Episode 35: To the Podium! | Anime | Animation", "2026-09-15T19:09:46.505Z"],
  ["36", "56498", 84097, "56498:dub", 107830, "pYjVlYeY-sI", "BEYBLADE BURST EVOLUTION Episode 36: Lúinor vs. Spryzen! | Anime | Animation", "2026-09-15T19:09:46.497Z"],
  ["37", "56499", 84098, "56499:dub", 107831, "5EyFLRLJOMg", "BEYBLADE BURST EVOLUTION Episode 37: Challenge of Champions!", "2026-09-15T19:09:46.478Z"],
  ["38", "56500", 84099, "56500:dub", 107832, "eFS-QNE81wc", "BEYBLADE BURST EVOLUTION Episode 38: Requiem Project! Spryzen Unleashed! | Anime | Animation", "2026-09-15T19:09:46.460Z"],
  ["39", "56501", 84100, "56501:dub", 107833, "K7ElHNqv0bk", "BEYBLADE BURST EVOLUTION Episode 39: Emperor of the Underground! | Anime | Animation", "2026-09-15T19:09:46.493Z"],
  ["40", "56502", 84101, "56502:dub", 107834, "2zLWzWPD5vg", "BEYBLADE BURST EVOLUTION Episode 40: Bow Down! Boom Khalzar! | Anime | Animation", "2026-09-15T19:09:46.469Z"],
  ["41", "56503", 84102, "56503:dub", 107835, "cf0RjpcLZA8", "BEYBLADE BURST EVOLUTION Episode 41: Colossus Hammer! Twin Noctemis! | Anime | Animation", "2026-09-15T19:09:46.447Z"],
  ["42", "56504", 84103, "56504:dub", 107836, "kBioX4BsjtI", "BEYBLADE BURST EVOLUTION Episode 42: BC Sol Scorcher! | Anime | Animation", "2026-09-15T19:09:46.455Z"],
  ["43", "56505", 84104, "56505:dub", 107837, "vZrIpNz0JXs", "BEYBLADE BURST EVOLUTION Episode 43: White Hot Rivals! | Anime | Animation", "2026-09-15T19:09:46.438Z"],
  ["44", "56506", 84105, "56506:dub", 107838, "Df81GMfGktQ", "BEYBLADE BURST EVOLUTION Episode 44: Epic Evolution! Strike Valtryek! | Anime | Animation", "2026-09-15T19:09:46.419Z"],
  ["45", "56507", 84106, "56507:dub", 107839, "jnDjbD0UKxY", "BEYBLADE BURST EVOLUTION Episode 45: Spryzen the Destroyer! | Anime | Animation", "2026-09-15T19:09:46.423Z"],
  ["46", "56508", 84107, "56508:dub", 107840, "_ZrmVrJxaRA", "BEYBLADE BURST EVOLUTION Episode 46: No Limits! Free vs. Lui!", "2026-09-15T19:09:46.400Z"],
  ["47", "56509", 84108, "56509:dub", 107841, "hur01woah0c", "BEYBLADE BURST EVOLUTION Episode 47: Full Force! Charging Up!", "2026-09-15T19:09:46.413Z"],
  ["48", "56510", 84109, "56510:dub", 107842, "rAPerhbP_m8", "BEYBLADE BURST EVOLUTION Episode 48: Teamwork! To the Semi-Finals!", "2026-09-15T19:09:46.422Z"],
  ["49", "56511", 84110, "56511:dub", 107843, "RQnrTidTZ1E", "BEYBLADE BURST EVOLUTION Episode 49: The Fierce Four!", "2026-09-15T19:09:46.407Z"],
  ["51", "56513", 84112, "56513:dub", 107845, "8aW0xyAKJII", "BEYBLADE BURST EVOLUTION Episode 51: A Champion is Crowned! Videos For Kids", "2026-09-15T19:09:46.384Z"],
] as const satisfies readonly BeybladeOfficialApprovalRow[];

export const BEYBLADE_BURST_EVOLUTION_OFFICIAL_EPISODE_APPROVALS = buildBeybladeSeriesApprovals({
  idPrefix: "beyblade-official-burst-evolution",
  titleSourceId: "3351",
  titleSlug: "beyblade-burst-evolution-ylr1c",
  expectedTitleId: 5724,
}, BEYBLADE_BURST_EVOLUTION_OFFICIAL_APPROVAL_ROWS);

export const BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = Object.freeze([
  ...BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS,
  ...BEYBLADE_BURST_TURBO_OFFICIAL_EPISODE_APPROVALS,
  ...BEYBLADE_BURST_OFFICIAL_EPISODE_APPROVALS,
  ...BEYBLADE_METAL_FUSION_OFFICIAL_EPISODE_APPROVALS,
  ...BEYBLADE_METAL_MASTERS_OFFICIAL_EPISODE_APPROVALS,
  ...BEYBLADE_BURST_EVOLUTION_OFFICIAL_EPISODE_APPROVALS,
]);

export const BEYBLADE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES = Object.freeze([
  ...catalogueIdentities,
]);
