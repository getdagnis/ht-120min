import { getCountryWorldDetails, getLeagueWorldDetails, HATTRICK_WORLD_DETAILS } from '../../shared/worlddetails';

export const normalizeTournamentName = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

export const normalizeTournamentSlug = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export function formatTournamentSlug(name: string, registrationType?: string | null) {
  const slug = normalizeTournamentSlug(name);
  if (!slug || registrationType !== 'sandbox' || slug.endsWith('-test')) return slug;
  return `${slug}-test`;
}

export interface TournamentNameSuffixOptions {
  registrationType?: string | null;
  leagueCategory?: string | null;
  countryLimit?: string | number | null;
  includeCountryFlag?: boolean;
}

function getNameMetadata(countryLimit?: string | number | null) {
  if (countryLimit === undefined || countryLimit === null || countryLimit === '') return null;
  const id = Number(countryLimit);
  if (!Number.isFinite(id)) return null;
  return getLeagueWorldDetails(id) ?? getCountryWorldDetails(id);
}

export function hasCountryFlagSuffix(name: string, countryLimit?: string | number | null) {
  const metadata = getNameMetadata(countryLimit);
  return Boolean(metadata && metadata.countryId !== null && !metadata.suffix && name.trimEnd().endsWith(` ${metadata.emoji}`));
}

export function stripGeneratedTournamentNameSuffix(name: string) {
  let result = name.trim();
  const suffixes = Object.values(HATTRICK_WORLD_DETAILS).flatMap((entry) => {
    const values = entry.suffix ? [` (${entry.suffix})`] : [];
    if (entry.countryId !== null) values.push(` ${entry.emoji}`);
    return values;
  });

  const knownSuffixes = [...suffixes, ' (test)'].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of knownSuffixes) {
      if (result.endsWith(suffix)) {
        result = result.slice(0, -suffix.length).trimEnd();
        changed = true;
        break;
      }
    }
  }
  return result;
}

export function formatTournamentName(name: string, options: TournamentNameSuffixOptions = {}) {
  const baseName = stripGeneratedTournamentNameSuffix(name);
  if (!baseName) return baseName;
  if (options.registrationType === 'sandbox') return `${baseName} (test)`;

  let formattedName = baseName;
  const specialLeague = options.leagueCategory === 'hfi' ? getNameMetadata(3000) : getNameMetadata(options.countryLimit);
  if (specialLeague?.suffix) formattedName += ` (${specialLeague.suffix})`;

  const country = getNameMetadata(options.countryLimit);
  if (options.includeCountryFlag !== false && country && country.countryId !== null && !country.suffix) {
    formattedName += ` ${country.emoji}`;
  }
  return formattedName;
}
