export const COUNTRY_TO_ISO: Record<string, string> = {
  Algeria: 'dz',
  Andorra: 'ad',
  Angola: 'ao',
  Argentina: 'ar',
  Armenia: 'am',
  Australia: 'au',
  Austria: 'at',
  Azerbaijan: 'az',
  Bahamas: 'bs',
  Bahrain: 'bh',
  Bangladesh: 'bd',
  Barbados: 'bb',
  Belarus: 'by',
  Belgium: 'be',
  Benin: 'bj',
  Bolivia: 'bo',
  'Bosnia and Herzegovina': 'ba',
  Botswana: 'bw',
  Brazil: 'br',
  Bulgaria: 'bg',
  'Burkina Faso': 'bf',
  Cambodia: 'kh',
  Cameroon: 'cm',
  Canada: 'ca',
  'Cape Verde': 'cv',
  Chile: 'cl',
  China: 'cn',
  'Chinese Taipei': 'tw',
  Colombia: 'co',
  Comoros: 'km',
  'Costa Rica': 'cr',
  "Cote d'Ivoire": 'ci',
  Croatia: 'hr',
  Cuba: 'cu',
  Cyprus: 'cy',
  'Czech Republic': 'cz',
  Denmark: 'dk',
  'Dominican Republic': 'do',
  'DR Congo': 'cd',
  Ecuador: 'ec',
  Egypt: 'eg',
  'El Salvador': 'sv',
  England: 'gb-eng',
  'Equatorial Guinea': 'gq',
  Estonia: 'ee',
  Ethiopia: 'et',
  'Faroe Islands': 'fo',
  Finland: 'fi',
  France: 'fr',
  Georgia: 'ge',
  Germany: 'de',
  Ghana: 'gh',
  Gibraltar: 'gi',
  Greece: 'gr',
  Guam: 'gu',
  Guatemala: 'gt',
  Guinea: 'gn',
  Guyana: 'gy',
  Haiti: 'ht',
  Honduras: 'hn',
  'Hong Kong': 'hk',
  Hungary: 'hu',
  Iceland: 'is',
  India: 'in',
  Indonesia: 'id',
  Iraq: 'iq',
  Ireland: 'ie',
  Israel: 'il',
  Italy: 'it',
  Jamaica: 'jm',
  Japan: 'jp',
  Jordan: 'jo',
  Kazakhstan: 'kz',
  Kenya: 'ke',
  Kuwait: 'kw',
  Kyrgyzstan: 'kg',
  Latvia: 'lv',
  Lebanon: 'lb',
  Liechtenstein: 'li',
  Lithuania: 'lt',
  Luxembourg: 'lu',
  Madagascar: 'mg',
  Malaysia: 'my',
  Maldives: 'mv',
  Malta: 'mt',
  Mexico: 'mx',
  Moldova: 'md',
  Mongolia: 'mn',
  Montenegro: 'me',
  Morocco: 'ma',
  Mozambique: 'mz',
  Myanmar: 'mm',
  Nepal: 'np',
  Netherlands: 'nl',
  'New Zealand': 'nz',
  Nicaragua: 'ni',
  Nigeria: 'ng',
  'North Macedonia': 'mk',
  'Northern Ireland': 'gb-nir',
  Norway: 'no',
  Oman: 'om',
  Pakistan: 'pk',
  Palestine: 'ps',
  Panama: 'pa',
  Paraguay: 'py',
  Peru: 'pe',
  Philippines: 'ph',
  Poland: 'pl',
  Portugal: 'pt',
  'Puerto Rico': 'pr',
  Qatar: 'qa',
  Romania: 'ro',
  Russia: 'ru',
  Rwanda: 'rw',
  'Saint Kitts and Nevis': 'kn',
  'Saint Vincent & the Grenadines': 'vc',
  'San Marino': 'sm',
  'Sao Tome e Principe': 'st',
  'Saudi Arabia': 'sa',
  Scotland: 'gb-sct',
  Senegal: 'sn',
  Serbia: 'rs',
  Singapore: 'sg',
  Slovakia: 'sk',
  Slovenia: 'si',
  'South Africa': 'za',
  'South Korea': 'kr',
  Spain: 'es',
  'Sri Lanka': 'lk',
  Suriname: 'sr',
  Sweden: 'se',
  Switzerland: 'ch',
  Syria: 'sy',
  Tahiti: 'pf',
  Tanzania: 'tz',
  Thailand: 'th',
  'Trinidad & Tobago': 'tt',
  Tunisia: 'tn',
  Turkey: 'tr',
  Uganda: 'ug',
  Ukraine: 'ua',
  'United Arab Emirates': 'ae',
  Uruguay: 'uy',
  USA: 'us',
  Uzbekistan: 'uz',
  Venezuela: 've',
  Vietnam: 'vn',
  Wales: 'gb-wls',
  Yemen: 'ye',
  Zambia: 'zm',
};

// Day: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// Times are in Hattrick Time (Swedish Time - Europe/Stockholm)
export const COUNTRY_FRIENDLY_TIMES: Record<string, { day: number; time: string }> = {
  // Unsorted
  Argentina: { day: 3, time: '23:20' },
  Australia: { day: 3, time: '04:00' },
  Austria: { day: 3, time: '09:30' },
  Belgium: { day: 3, time: '13:30' },
  Bolivia: { day: 2, time: '22:45' },
  Brazil: { day: 3, time: '23:55' },
  Bulgaria: { day: 2, time: '21:15' },
  Canada: { day: 3, time: '23:00' },
  Chile: { day: 3, time: '22:50' },
  China: { day: 3, time: '07:00' },
  Colombia: { day: 3, time: '23:40' },
  'Costa Rica': { day: 3, time: '23:45' },
  Croatia: { day: 3, time: '08:45' },
  Cyprus: { day: 2, time: '20:15' },
  'Czech Republic': { day: 3, time: '14:00' },
  Denmark: { day: 3, time: '16:30' },
  Ecuador: { day: 2, time: '23:45' },
  England: { day: 2, time: '21:00' },
  Estonia: { day: 3, time: '12:15' },
  Finland: { day: 2, time: '20:05' },
  France: { day: 3, time: '15:05' },
  Germany: { day: 2, time: '18:15' },
  Greece: { day: 3, time: '09:45' },
  Honduras: { day: 3, time: '21:55' },
  Hungary: { day: 3, time: '09:45' },
  Indonesia: { day: 3, time: '07:45' },
  Ireland: { day: 3, time: '20:15' },
  Israel: { day: 2, time: '20:30' },
  Italy: { day: 2, time: '19:05' },
  Japan: { day: 3, time: '02:30' },
  Latvia: { day: 3, time: '13:45' },
  Lithuania: { day: 3, time: '19:20' },
  Malaysia: { day: 3, time: '05:00' },
  Mexico: { day: 3, time: '02:30' },
  Netherlands: { day: 3, time: '17:05' },
  'New Zealand': { day: 3, time: '04:00' },
  Norway: { day: 3, time: '16:00' },
  Paraguay: { day: 2, time: '23:15' },
  Peru: { day: 3, time: '22:50' },
  Poland: { day: 3, time: '17:50' },
  Portugal: { day: 3, time: '21:50' },
  Romania: { day: 3, time: '10:00' },
  Russia: { day: 3, time: '08:30' },
  Scotland: { day: 3, time: '11:30' },
  Serbia: { day: 3, time: '12:45' },
  Singapore: { day: 3, time: '04:30' },
  Slovakia: { day: 2, time: '19:25' },
  Slovenia: { day: 2, time: '19:30' },
  'South Africa': { day: 3, time: '21:30' },
  'South Korea': { day: 3, time: '02:00' },
  Spain: { day: 3, time: '12:05' },
  Sweden: { day: 3, time: '19:15' },
  Switzerland: { day: 3, time: '10:35' },
  Thailand: { day: 3, time: '05:30' },
  Turkey: { day: 3, time: '08:00' },
  Ukraine: { day: 3, time: '08:15' },
  Uruguay: { day: 3, time: '22:30' },
  USA: { day: 3, time: '23:25' },
  Venezuela: { day: 3, time: '23:30' },
  Wales: { day: 2, time: '21:30' },

  // Africa
  Algeria: { day: 3, time: '20:10' },
  Angola: { day: 2, time: '19:40' },
  Benin: { day: 3, time: '18:45' },
  Botswana: { day: 3, time: '18:50' },
  'Burkina Faso': { day: 3, time: '18:55' },
  Cameroon: { day: 3, time: '18:55' },
  'Cape Verde': { day: 3, time: '18:25' },
  Comoros: { day: 3, time: '12:40' },
  "Cote d'Ivoire": { day: 3, time: '18:55' },
  'DR Congo': { day: 3, time: '18:50' },
  Egypt: { day: 2, time: '18:50' },
  'Equatorial Guinea': { day: 3, time: '18:50' },
  Ethiopia: { day: 3, time: '18:50' },
  Ghana: { day: 3, time: '18:25' },
  Guinea: { day: 3, time: '18:20' },
  Kenya: { day: 3, time: '12:45' },
  Madagascar: { day: 3, time: '16:40' },
  Morocco: { day: 3, time: '20:50' },
  Mozambique: { day: 3, time: '16:40' },
  Nigeria: { day: 3, time: '18:45' },
  Rwanda: { day: 3, time: '16:20' },
  'Sao Tome e Principe': { day: 3, time: '18:50' },
  Senegal: { day: 3, time: '18:20' },
  Tanzania: { day: 3, time: '12:45' },
  Tunisia: { day: 3, time: '16:45' },
  Uganda: { day: 3, time: '16:20' },
  Zambia: { day: 3, time: '18:50' },

  // Americas
  Jamaica: { day: 3, time: '22:15' },
  'Puerto Rico': { day: 3, time: '22:20' },
  Suriname: { day: 3, time: '23:10' },
  'Trinidad & Tobago': { day: 3, time: '22:20' },

  // Asia / Oceania
  Armenia: { day: 3, time: '14:40' },
  Azerbaijan: { day: 3, time: '14:25' },
  Bahrain: { day: 3, time: '16:50' },
  Bangladesh: { day: 3, time: '06:30' },
  Cambodia: { day: 3, time: '05:15' },
  'Chinese Taipei': { day: 3, time: '03:00' },
  Guam: { day: 3, time: '04:15' },
  'Hong Kong': { day: 3, time: '08:30' },
  India: { day: 3, time: '06:00' },
  Iraq: { day: 3, time: '16:25' },
  Jordan: { day: 3, time: '18:40' },
  Kazakhstan: { day: 3, time: '12:10' },
  Kuwait: { day: 3, time: '16:10' },
  Kyrgyzstan: { day: 3, time: '07:30' },
  Lebanon: { day: 3, time: '17:40' },
  Maldives: { day: 3, time: '06:00' },
  Mongolia: { day: 3, time: '07:50' },
  Myanmar: { day: 3, time: '06:30' },
  Nepal: { day: 3, time: '06:30' },
  Oman: { day: 3, time: '16:40' },
  Pakistan: { day: 3, time: '06:15' },
  Palestine: { day: 3, time: '16:15' },
  Philippines: { day: 3, time: '03:30' },
  Qatar: { day: 3, time: '16:10' },
  'Saudi Arabia': { day: 3, time: '16:20' },
  'Sri Lanka': { day: 3, time: '06:45' },
  Syria: { day: 3, time: '16:35' },
  Tahiti: { day: 2, time: '22:45' },
  'United Arab Emirates': { day: 3, time: '18:45' },
  Uzbekistan: { day: 3, time: '14:30' },
  Vietnam: { day: 3, time: '05:15' },
  Yemen: { day: 3, time: '16:35' },

  // Europe
  Andorra: { day: 3, time: '15:15' },
  Belarus: { day: 3, time: '09:15' },
  'Bosnia and Herzegovina': { day: 3, time: '14:15' },
  'Faroe Islands': { day: 3, time: '16:45' },
  Georgia: { day: 3, time: '14:20' },
  Iceland: { day: 3, time: '20:45' },
  Liechtenstein: { day: 2, time: '19:50' },
  Luxembourg: { day: 3, time: '14:45' },
  Malta: { day: 3, time: '17:15' },
  Moldova: { day: 3, time: '17:45' },
  'North Macedonia': { day: 3, time: '10:15' },
  'Northern Ireland': { day: 2, time: '22:15' },
  'San Marino': { day: 3, time: '17:15' },
};

const DEFAULT_TIME = { day: 2, time: '20:00' };

export function getFriendlyTimeForCountry(countryName?: string) {
  if (!countryName) return DEFAULT_TIME;
  return COUNTRY_FRIENDLY_TIMES[countryName] || DEFAULT_TIME;
}

export function getFlagUrl(countryName?: string) {
  if (!countryName) return null;
  const iso = COUNTRY_TO_ISO[countryName];
  if (!iso) return null;
  return `https://flagcdn.com/w80/${iso.toLowerCase()}.png`;
}

/**
 * Helper to get the offset in minutes between Europe/Stockholm (HT Time) and UTC
 * for a specific date.
 */
function getHTOffsetForDate(date: Date): number {
  try {
    const stockholmStr = date.toLocaleString('en-US', { timeZone: 'Europe/Stockholm', hour12: false });
    const [datePart, timePart] = stockholmStr.split(', ');
    const [m, d, y] = datePart.split('/').map(Number);
    const [h, min, s] = timePart.split(':').map(Number);
    const wallClockHT = Date.UTC(y, m - 1, d, h, min, s);
    return (wallClockHT - date.getTime()) / 60000;
  } catch {
    return 60; // Fallback to CET if TZ not supported
  }
}

/**
 * Calculates the match date for a given round based on the anchor date
 * and the country's friendly match day/time. Deterministic: same inputs = same output.
 * Pass round.created_at as anchor for display of existing rounds.
 * Pass a "now" timestamp as anchor when generating a new schedule.
 */
/**
 * Returns presence display info for a last_seen_at timestamp.
 * color: 'green' = recent/online, 'yellow' = days ago, 'red' = weeks/months ago
 */
export function formatPresence(lastSeenAt: string | null | undefined): {
  label: string;
  tooltip: string;
  color: 'green' | 'yellow' | 'red' | 'grey';
  online: boolean;
} {
  if (!lastSeenAt) {
    return {
      label: '•',
      tooltip: 'No recent activity recorded',
      color: 'grey',
      online: false,
    };
  }

  const lastSeen = new Date(lastSeenAt);
  if (!Number.isFinite(lastSeen.getTime())) {
    return {
      label: '•',
      tooltip: 'No recent activity recorded',
      color: 'grey',
      online: false,
    };
  }

  const mins = (Date.now() - lastSeen.getTime()) / 60000;
  if (mins < 5) {
    return {
      label: '●',
      tooltip: 'Wandering around',
      color: 'green',
      online: true,
    };
  }

  if (mins < 5) return { label: '5m', tooltip: 'Seen less than 5 minutes ago', color: 'green', online: false };
  if (mins < 15) return { label: '15m', tooltip: 'Seen less than 15 minutes ago', color: 'green', online: false };
  if (mins < 30) return { label: '30m', tooltip: 'Seen less than 30 minutes ago', color: 'green', online: false };
  if (mins < 60) return { label: '1h', tooltip: 'Seen less than 1 hour ago', color: 'green', online: false };

  if (mins < 120) return { label: '2h', tooltip: 'Seen less than 4 hours ago', color: 'yellow', online: false };
  if (mins < 240) return { label: '4h', tooltip: 'Seen less than 6 hours ago', color: 'yellow', online: false };
  if (mins < 360) return { label: '6h', tooltip: 'Seen less than 10 hours ago', color: 'yellow', online: false };
  if (mins < 60 * 10) return { label: '10h', tooltip: 'Seen less than 16 hours ago', color: 'yellow', online: false };
  if (mins < 60 * 16) return { label: '16h', tooltip: 'Seen less than 24 hours ago', color: 'yellow', online: false };
  if (mins < 60 * 24) return { label: '24h', tooltip: 'Seen less than 2 days ago', color: 'yellow', online: false };

  if (mins < 60 * 24 * 2) return { label: '1d', tooltip: 'Seen about a day ago', color: 'yellow', online: false };
  if (mins < 60 * 24 * 3) return { label: '2d', tooltip: 'Seen about 2 days ago', color: 'yellow', online: false };
  if (mins < 60 * 24 * 4) return { label: '3d', tooltip: 'Seen about 3 days ago', color: 'yellow', online: false };
  if (mins < 60 * 24 * 5) return { label: '4d', tooltip: 'Seen about 4 days ago', color: 'yellow', online: false };
  if (mins < 60 * 24 * 6) return { label: '5d', tooltip: 'Seen about 5 days ago', color: 'yellow', online: false };
  if (mins < 60 * 24 * 7) return { label: '6d', tooltip: 'Seen about 6 days ago', color: 'yellow', online: false };
  if (mins < 60 * 24 * 14) return { label: '1w', tooltip: 'Seen about a week ago', color: 'yellow', online: false };

  if (mins < 60 * 24 * 21) return { label: '2w', tooltip: 'Seen about 2 weeks ago', color: 'red', online: false };
  if (mins < 60 * 24 * 30) return { label: '3w', tooltip: 'Seen about 3 weeks ago', color: 'red', online: false };
  if (mins < 60 * 24 * 60) return { label: '1m', tooltip: 'Seen about 1 month ago', color: 'red', online: false };
  if (mins < 60 * 24 * 90) return { label: '2m', tooltip: 'Seen about 2 months ago', color: 'red', online: false };
  if (mins < 60 * 24 * 180) return { label: '3m+', tooltip: 'Seen about 6 months ago', color: 'red', online: false };
  if (mins < 60 * 24 * 365) return { label: '1y', tooltip: 'Seen about 1 year ago', color: 'red', online: false };

  return { label: '1y+', tooltip: 'Seen more than a year ago', color: 'red', online: false };
}

export function calculateMatchDate(tournamentCreatedAt: string, roundNumber: number, countryName?: string): Date {
  const { day, time } = getFriendlyTimeForCountry(countryName);
  const [hours, minutes] = time.split(':').map(Number);

  const startDate = new Date(tournamentCreatedAt);
  const matchDate = new Date(startDate.getTime());

  // Find target offset at startDate to get a baseline
  let currentOffset = getHTOffsetForDate(matchDate);

  // Convert startDate to HT wall-clock to find the day of the week in Stockholm
  const htDate = new Date(matchDate.getTime() + currentOffset * 60000);
  const currentHTDay = htDate.getUTCDay();

  // Find days until next target HT day
  let daysUntil = (day - currentHTDay + 7) % 7;

  // If it's the same day, check if the time has already passed
  if (daysUntil === 0) {
    const htHours = htDate.getUTCHours();
    const htMinutes = htDate.getUTCMinutes();
    if (htHours > hours || (htHours === hours && htMinutes >= minutes)) {
      daysUntil = 7;
    }
  }

  matchDate.setUTCDate(matchDate.getUTCDate() + daysUntil);

  // Re-calculate precisely with actual offset at the estimated date
  currentOffset = getHTOffsetForDate(matchDate);
  matchDate.setUTCHours(hours - currentOffset / 60, minutes, 0, 0);

  // Add rounds (1 week per round)
  if (roundNumber > 1) {
    matchDate.setUTCDate(matchDate.getUTCDate() + (roundNumber - 1) * 7);
    // Final check for DST transitions
    currentOffset = getHTOffsetForDate(matchDate);
    matchDate.setUTCHours(hours - currentOffset / 60, minutes, 0, 0);
  }

  return matchDate;
}
