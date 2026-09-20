import { normalizeTournamentRegistrationType, type TournamentRegistrationType } from './tournament-types';

export interface RealTournamentInsertOptions {
  name: string;
  slug: string;
  scoringMode: string;
  leagueCategory: 'male' | 'hfi';
  registrationType: TournamentRegistrationType | string | null | undefined;
  adminPassword: string;
  isPrivate: boolean;
  countryLimit: string | null;
  description: string | null;
  showDescription: boolean;
  adminEmail: string | null;
  maxTeams: number | null;
  organizerId: number | null;
  organizerName: string | null;
  thumbnailIndex?: number;
}

export function getRandomTournamentThumbnailIndex() {
  return Math.floor(Math.random() * 17) + 1;
}

/** Shared persisted defaults for non-sandbox tournament creation. */
export function buildRealTournamentInsert(options: RealTournamentInsertOptions) {
  const registrationType = normalizeTournamentRegistrationType(options.registrationType);
  if (registrationType === 'sandbox') {
    throw new Error('Sandbox tournaments must use the sandbox creation flow.');
  }

  return {
    name: options.name,
    slug: options.slug,
    scoring_mode: options.scoringMode,
    league_category: options.leagueCategory,
    registration_type: registrationType,
    admin_password: options.adminPassword,
    is_private: options.isPrivate,
    country_limit: options.countryLimit,
    description: options.showDescription ? options.description : null,
    show_description: options.showDescription,
    admin_email: options.adminEmail,
    thumbnail_index: options.thumbnailIndex ?? getRandomTournamentThumbnailIndex(),
    max_teams: options.maxTeams,
    season: 1,
    status: 'open' as const,
    is_test: false,
    chpp_only_join: true,
    organizer_id: options.organizerId,
    organizer_name: options.organizerName,
  };
}
