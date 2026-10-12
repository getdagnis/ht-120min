/**
 * Static WorldDetails-derived country population snapshot supplied from Forge
 * Leagues on 2026-10-12. It covers the supplied catalogue through 1200 active
 * teams; countries outside that snapshot must fail closed when this rule is used.
 */
export const COUNTRY_ACTIVE_TEAM_COUNTS_CHECKED_AT = '2026-10-12T15:23:39.644Z';

/** Hattrick league ID -> active team count (Forge Leagues snapshot). */
const ACTIVE_TEAMS_BY_LEAGUE_ID: Readonly<Record<number, number>> = {
  133: 96, 123: 98, 71: 99, 136: 102, 140: 102, 162: 102, 132: 103, 128: 105,
  120: 106, 158: 107, 144: 107, 124: 108, 156: 108, 164: 108, 146: 109, 160: 110,
  122: 111, 138: 111, 106: 111, 152: 111, 110: 112, 154: 113, 143: 113, 137: 114,
  139: 115, 155: 118, 127: 118, 102: 119, 130: 120, 148: 120, 100: 122, 141: 122,
  145: 122, 157: 128, 113: 128, 142: 130, 126: 131, 95: 132, 161: 132, 147: 134,
  121: 134, 119: 135, 80: 140, 60: 142, 118: 144, 159: 147, 151: 148, 55: 153,
  94: 158, 75: 158, 125: 159, 79: 160, 166: 168, 111: 169, 129: 175, 112: 175,
  99: 176, 149: 179, 131: 184, 31: 187, 173: 190, 135: 193, 77: 194, 171: 195,
  47: 195, 83: 195, 59: 198, 93: 200, 45: 202, 97: 203, 76: 209, 168: 209, 33: 210,
  169: 210, 105: 213, 167: 217, 165: 222, 103: 226, 30: 239, 73: 240, 153: 241,
  27: 248, 107: 250, 61: 253, 101: 254, 175: 258, 172: 263, 170: 275, 89: 276,
  81: 279, 177: 285, 20: 293, 117: 293, 174: 302, 163: 302, 91: 303, 176: 315,
  84: 315, 72: 338, 38: 353, 98: 356, 134: 358, 104: 365, 70: 370, 74: 382,
  88: 407, 22: 407, 54: 510, 21: 554, 96: 599, 26: 610, 35: 624, 68: 693,
  29: 810, 56: 821, 69: 828, 1000: 980, 17: 984, 64: 1113, 53: 1136,
};

import { HATTRICK_WORLD_DETAILS } from './worlddetails.js';

const ACTIVE_TEAMS_BY_COUNTRY_ID: Readonly<Record<number, number>> = Object.values(HATTRICK_WORLD_DETAILS)
  .reduce<Record<number, number>>((counts, league) => {
    const count = ACTIVE_TEAMS_BY_LEAGUE_ID[league.leagueId];
    if (league.countryId !== null && count !== undefined) counts[league.countryId] = count;
    return counts;
  }, {});

export function getCountryActiveTeamCount(countryId: number | null | undefined): number | null {
  if (countryId == null || !Number.isSafeInteger(countryId)) return null;
  return ACTIVE_TEAMS_BY_COUNTRY_ID[countryId] ?? null;
}
