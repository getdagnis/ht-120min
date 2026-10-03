import { getCountryIdByName, getCountryWorldDetails, type HattrickWorldLeague } from '../../shared/worlddetails.js';
import { formatTournamentSlug } from '../utils/tournament-names.js';
import { TOURNAMENT_DEFAULT_120MIN_DEFAULTS } from './descriptions.js';

export const EXOTIC_HFI_GROUP_TITLE = 'Exotic small HFI leagues';
export const EXOTIC_HFI_QUEENS_SLUG = 'queens-of-the-pacific-cup';

const EXOTIC_HFI_COUNTRY_NAMES = [
  'Saint Kitts and Nevis',
  'San Marino',
  'Tahiti',
  'Faroe Islands',
  'Gibraltar',
  'Bhutan',
  'Curaçao',
  'Barbados',
  'São Tomé e Príncipe',
  'Liechtenstein',
  'Saint Vincent and the Grenadines',
  'Malta',
  'Andorra',
  'Bahamas',
  'Madagascar',
  'Maldives',
  'Cabo Verde',
  'Suriname',
  'Brunei',
  'Comoros',
  'Trinidad & Tobago',
] as const;

export interface ExoticHfiTournamentTarget {
  country: HattrickWorldLeague;
  displayName: string;
  countryLimit: string;
  name: string;
  slug: string;
  description: string;
}

function resolveCampaignCountry(sourceName: string): HattrickWorldLeague {
  const countryId = getCountryIdByName(sourceName);
  const country = countryId ? getCountryWorldDetails(Number(countryId)) : null;
  if (!country || country.countryId === null) {
    throw new Error(`Exotic HFI campaign country could not be resolved: ${sourceName}`);
  }
  return country;
}

function getCampaignDisplayName(sourceName: string, country: HattrickWorldLeague) {
  // This is the one intentional local-name preference selected for the campaign.
  return sourceName === 'Cabo Verde' ? country.countryName || sourceName : country.fullName;
}

export const EXOTIC_HFI_TOURNAMENTS: readonly ExoticHfiTournamentTarget[] = EXOTIC_HFI_COUNTRY_NAMES.map(
  (sourceName, index) => {
    const country = resolveCampaignCountry(sourceName);
    const displayName = getCampaignDisplayName(sourceName, country);
    const slug = formatTournamentSlug(`exotic-hfi-${displayName}`, 'validated');

    return {
      country,
      displayName,
      countryLimit: String(country.countryId),
      name: `Exotic HFI — ${displayName} ${country.emoji}`,
      slug,
      description: TOURNAMENT_DEFAULT_120MIN_DEFAULTS[index % TOURNAMENT_DEFAULT_120MIN_DEFAULTS.length],
    };
  },
);

export const EXOTIC_HFI_CAMPAIGN_SLUGS = [
  EXOTIC_HFI_QUEENS_SLUG,
  'exotic-hfi-san-marino',
  ...EXOTIC_HFI_TOURNAMENTS.map((target) => target.slug).filter((slug) => slug !== 'exotic-hfi-san-marino'),
] as const;
export const EXOTIC_HFI_CAMPAIGN_SLUG_SET = new Set<string>(EXOTIC_HFI_CAMPAIGN_SLUGS);

const EXOTIC_HFI_CAMPAIGN_ORDER = new Map(EXOTIC_HFI_CAMPAIGN_SLUGS.map((slug, index) => [slug, index]));

type ExoticHfiMatch = {
  completed?: boolean | null;
  status?: string | null;
};

type ExoticHfiRound = {
  round_number?: number | null;
  matches?: ExoticHfiMatch[] | null;
};

type ExoticHfiSortable = {
  slug: string;
  status?: string | null;
  created_at?: string | Date | null;
  rounds?: ExoticHfiRound[] | null;
};

function isCompletedMatch(match: ExoticHfiMatch) {
  return Boolean(match.completed) || match.status === 'misarranged';
}

function getExoticHfiProgress(tournament: ExoticHfiSortable) {
  const rounds = tournament.rounds ?? [];
  const matches = rounds.flatMap((round) => round.matches || []);
  const completedMatches = matches.filter(isCompletedMatch).length;
  const completedRounds = rounds
    .filter((round) => {
      const roundMatches = round.matches || [];
      return roundMatches.length > 0 && roundMatches.every(isCompletedMatch);
    })
    .toSorted((left, right) => (right.round_number ?? 0) - (left.round_number ?? 0));
  const lastCompletedRoundMatchCount = completedRounds[0]?.matches?.length || 0;

  return {
    isActive: rounds.length > 0 && matches.length > completedMatches && tournament.status !== 'finished',
    hasCompletedRound: completedRounds.length > 0,
    lastCompletedRoundMatchCount,
  };
}

function getCreatedAtTimestamp(value: string | Date | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

// Keep the public campaign list and authenticated organizer lists on one activity ordering.
export function orderExoticHfiTournaments<T extends ExoticHfiSortable>(tournaments: T[]) {
  return [...tournaments].sort((left, right) => {
    const leftProgress = getExoticHfiProgress(left);
    const rightProgress = getExoticHfiProgress(right);

    if (leftProgress.isActive !== rightProgress.isActive) return leftProgress.isActive ? -1 : 1;
    if (leftProgress.hasCompletedRound !== rightProgress.hasCompletedRound) return leftProgress.hasCompletedRound ? -1 : 1;
    if (leftProgress.lastCompletedRoundMatchCount !== rightProgress.lastCompletedRoundMatchCount) {
      return rightProgress.lastCompletedRoundMatchCount - leftProgress.lastCompletedRoundMatchCount;
    }

    const campaignOrder =
      (EXOTIC_HFI_CAMPAIGN_ORDER.get(left.slug) ?? Number.MAX_SAFE_INTEGER) -
      (EXOTIC_HFI_CAMPAIGN_ORDER.get(right.slug) ?? Number.MAX_SAFE_INTEGER);
    if (campaignOrder !== 0) return campaignOrder;

    return getCreatedAtTimestamp(right.created_at) - getCreatedAtTimestamp(left.created_at);
  });
}
