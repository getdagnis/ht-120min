import { getCountryIdByName, getCountryWorldDetails, type HattrickWorldLeague } from '../../shared/worlddetails';
import { formatTournamentSlug } from '../utils/tournament-names';
import { TOURNAMENT_DEFAULT_120MIN_DEFAULTS } from './descriptions';

export const EXOTIC_HFI_GROUP_TITLE = 'Exotic small HFI leagues';
export const EXOTIC_HFI_QUEENS_SLUG = 'queens-of-the-pacific-cup';

const EXOTIC_HFI_COUNTRY_NAMES = [
  'Saint Kitts and Nevis',
  'Gibraltar',
  'Liechtenstein',
  'San Marino',
  'Andorra',
  'Faroe Islands',
  'Saint Vincent and the Grenadines',
  'Tahiti',
  'Curaçao',
  'São Tomé e Príncipe',
  'Barbados',
  'Madagascar',
  'Bahamas',
  'Maldives',
  'Bhutan',
  'Cabo Verde',
  'Malta',
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

export const EXOTIC_HFI_CAMPAIGN_SLUGS = [EXOTIC_HFI_QUEENS_SLUG, ...EXOTIC_HFI_TOURNAMENTS.map((target) => target.slug)] as const;
export const EXOTIC_HFI_CAMPAIGN_SLUG_SET = new Set<string>(EXOTIC_HFI_CAMPAIGN_SLUGS);

const EXOTIC_HFI_CAMPAIGN_ORDER = new Map(EXOTIC_HFI_CAMPAIGN_SLUGS.map((slug, index) => [slug, index]));

export function orderExoticHfiTournaments<T extends { slug: string }>(tournaments: T[]) {
  return [...tournaments].sort(
    (left, right) =>
      (EXOTIC_HFI_CAMPAIGN_ORDER.get(left.slug) ?? Number.MAX_SAFE_INTEGER) -
      (EXOTIC_HFI_CAMPAIGN_ORDER.get(right.slug) ?? Number.MAX_SAFE_INTEGER),
  );
}
