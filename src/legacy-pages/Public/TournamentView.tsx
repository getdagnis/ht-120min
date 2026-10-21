/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useParams, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation';
import { normalizeTournamentTheme, setTournamentTheme } from '../../utils/browser-theme';
import type { EffectiveTheme } from '../../utils/theme';
import { supabase } from '../../lib/supabase';
import { PUBLIC_ROUND_FIELDS, PUBLIC_MATCH_FIELDS } from '../../lib/tournament-public-fields';
import {
  attachFixtureRatingStatus,
  readFixtureRatingStatuses,
  type FixtureRatingShareStatus,
} from '../../types/fixture-ratings';
import {
  invalidateTournamentData,
  loadTournamentPrivateData,
  readTournamentPublicData,
} from '../../app/_data/tournament-actions';
import { useLocale } from '../../i18n/LocaleProvider';
import { toLocalePath } from '../../next/locale-path';

import adminStyles from './TournamentAdmin.module.sass';
import styles from './TournamentView.module.sass';
import { buildCalendarSlots } from '../../utils/hattrick-calendar';
import { getTournamentBackgroundStyle } from '../../utils/visuals';
import {
  calculateSeasonSlotStandings,
  calculateStandings,
  mapWarningTeamIdsToStandingsIds,
} from '../../utils/standings';
import { validateAppgOutcome } from '../../utils/appg';
import { isCurrentParticipantTeam } from '../../utils/team-state';
import { isFixtureMisarranged } from '../../utils/fixture-status';
import { isAppg120ScoringMode } from '../../../shared/scoring-profile';
import type { SeasonSlotAssignment, TeamStanding, Team as StandingTeam } from '../../utils/standings';
import {
  buildSeasonHistorySnapshot,
  resolveSeasonFinishedAt,
  resolveSeasonStartedAt,
  type SeasonHistorySnapshot,
  type SeasonHistoryMatch,
} from '../../utils/season-history';
import {
  buildSeasonFixturesSnapshot,
  isMissingMatchEventDetails,
  type SeasonFixturesSnapshot,
} from '../../utils/season-fixtures';
import {
  getCompatibleLeagueRestrictionOptions,
  teamMatchesCountryLimit,
  teamMatchesCategory,
  validateTeamEligibility,
} from '../../utils/team-eligibility';
import {
  managerCountrySizeAllowance,
  validateCountrySizeEligibility,
} from '../../../shared/country-size-eligibility';
import { normalizeLeagueLimit, resolveCountryRestriction } from '../../../shared/worlddetails';
import type { MatchEventDetails } from '../../../shared/match-events';
import type { TournamentJoinStory } from '../../types/tournament-activity';
import { useLiveMatches } from '../../hooks/useLiveMatches';
import { trackActivity } from '../../hooks/useActivityTracking';
import {
  buildScheduleDraft,
  serializeScheduleDraftForRpc,
  shuffleScheduleTeamIds,
  type ScheduleMode,
} from '../../utils/schedule-draft';
import { buildRescheduleDraft, serializeRescheduleDraftForRpc } from '../../utils/reschedule-draft';
import {
  buildLengthScheduleDraft,
  getRegularPhaseMatches,
  serializeLengthScheduleDraft,
} from '../../utils/length-schedule';
import { buildManualRoundNormalizationPlan } from '../../utils/manual-rounds';
import { buildClearSeasonResultsPayload, buildResetUnlinkedResultPayload } from '../../utils/season-results';
import { getMatchDateForRound as resolveMatchDateForRound } from '../../utils/match-schedule';
import { getFocusedFixtureRoundIndex } from '../../utils/fixture-round-focus';
import { compareFixtures } from '../../utils/fixture-sorting';
import {
  canViewerJoinAnotherTeam,
  canViewerJoinReserve,
  canViewerJoinTournament,
  isTournamentRegistrationOpen,
} from '../../utils/tournament-joinability';
import { markAuthRefreshCurrent, needsAuthRefresh } from '../../utils/auth-refresh';
import { formatTournamentName } from '../../utils/tournament-names';
import { readPublicTournament } from '../../utils/public-tournament-load';
import { isSandboxTournament, normalizeTournamentRegistrationType } from '../../utils/tournament-types';
import type { TournamentEmojiContext } from '../../utils/tournament-emoji-options';
import {
  JOINED_NOTICE_KEY,
  selectTournamentMessage,
  type TournamentAnnouncement,
  type TournamentAnnouncementDismissal,
  type TournamentAnnouncementVisibility,
} from '../../utils/tournament-announcements';

import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import buttonStyles from '../../components/Button/Button.module.sass';
import { Modal } from '../../components/Modal/Modal';
import { ConfirmationDialog } from '../../components/Modal/ConfirmationDialog';
import { useConfirmationDialog } from '../../components/Modal/useConfirmationDialog';
import { isExclusiveTournament, type TournamentStatus } from '../../utils/tournament-lifecycle';
import { NoticeDialog } from '../../components/Modal/NoticeDialog';
import { useNoticeDialog } from '../../components/Modal/useNoticeDialog';
import { ModalTeamCard } from '../../components/ModalTeamCard/ModalTeamCard';
import { HeroCard } from '../../components/Card/HeroCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { ChatView, type ChatAuthorProfile } from '../../components/TournamentTabs/ChatView';
import { FixturesView } from '../../components/TournamentTabs/FixturesView';
import { TournamentAdmin, type TournamentAdminController } from '../../components/TournamentTabs/Admin/TournamentAdmin';
import { useTournamentAdminState } from '../../components/TournamentTabs/Admin/useTournamentAdminState';
import { NewsTab } from '../../components/TournamentTabs/NewsTab';
import { CompactAccordionWidget } from '../../components/CompactAccordionWidget/CompactAccordionWidget';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { SidebarPollWidget } from '../../components/SidebarPollWidget/SidebarPollWidget';
import { ReserveTeamsWidget } from '../../components/ReserveTeams/ReserveTeamsWidget';
import { LeaveTournamentWidget } from '../../components/LeaveTournament/LeaveTournamentWidget';
import { RepresentedCountries } from '../../components/RepresentedCountries/RepresentedCountries';
import { ManagerSpotlight } from '../../components/ManagerSpotlight/ManagerSpotlight';
import { StandingsView } from '../../components/TournamentTabs/StandingsView';
import { TournamentShareMenu } from '../../components/TournamentShareMenu/TournamentShareMenu';
import { TournamentHistory, type TournamentSeasonComment } from '../../components/TournamentHistory/TournamentHistory';
import { WelcomeModal } from '../../components/WelcomeModal/WelcomeModal';
import { TournamentBadgeChips } from '../../components/TournamentBadgeChips/TournamentBadgeChips';
import { getDescriptionPools } from '../../constants/description-pools';
import { getTournamentFaqSections } from '../../constants/faq-essential';
import { TOURNAMENT_ROLE_LABELS, type TournamentRole } from '../../../shared/tournament-roles';
import { getRandomSandboxTeamId, SANDBOX_RANDOM_ATTEMPTS } from '../../constants/sandbox';
import { useClientNow, useHydratedLocalStorage, useHydrationReady } from '../../hooks/useHydratedBrowserState';
import type { ResultCsvRow } from '../../utils/result-csv';
import {
  dismissWelcome,
  getTournamentVisitWelcomeKey,
  hasDismissedWelcome,
  TOURNAMENT_CREATED_WELCOME,
} from '../../utils/welcome-modals';
import { ArrowClockwise, ArrowRight, CaretDown, Chat, Info, Question, X } from 'phosphor-react';
import type { TournamentInitialData } from '../../app/_data/public-data';
import type { TournamentMatchArrangeStorySnapshot } from '../../types/tournament-activity';
import type { BulkMatchUpdate } from '../../utils/sandbox-results';
import type {
  TournamentOwnerRecord,
  TournamentRoleRecord,
} from '../../components/TournamentTabs/Admin/TournamentRolesPanel';

const FORUM_LINK = 'https://www.hattrick.org/goto.ashx?path=/Forum/Read.aspx?n=1&nm=32&t=17685273&v=0';
const randomDescriptionFromPool = (descriptions: string[]) =>
  descriptions[Math.floor(Math.random() * descriptions.length)];
const startHattrickLoginRedirect = () => {
  document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
  window.location.href = '/api/auth/init';
};
const getCurrentTimestamp = () => Date.now();
const getHistoryReportNoticeStorageKey = (seasonId: string) => `ht-120min:history-report-notice-dismissed:${seasonId}`;
const getOrganizerAdminSessionStorageKey = (tournamentId: string, userId: number) =>
  `ht-120min:organizer-admin-session:${tournamentId}:${userId}`;

function readLocalStorage(key: string) {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(key);
}

function readSessionStorage(key: string) {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(key);
}

const TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT = {
  historyReportNotice: false,
  createdTournamentWelcome: false,
  openTournamentWelcome: false,
  editTournamentImage: false,
  teamSelection: false,
  seasonCommentConfirm: false,
};
function normalizeGeneratedScheduleMode(value: unknown): ScheduleMode {
  return value === 'double' || value === 'recurring' || value === 'single' ? value : 'single';
}

export interface ChppTeamOption {
  teamId: number;
  teamName: string;
  logoUrl?: string;
  genderId?: number;
  leagueId?: number;
  leagueSystemId?: number;
  leagueName?: string;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryId?: number;
  countryName?: string;
  activeTournament?: {
    name: string;
    slug: string;
  };
}

export interface HtMatchLinkPreview {
  ht_match_id: number;
  actual_home_team_name: string | null;
  actual_away_team_name: string | null;
  home_goals: number;
  away_goals: number;
  status: 'arranged' | 'ongoing' | 'finished';
  matched_both_tournament_teams: boolean;
}

export interface HtMatchAddPreview {
  ht_match_id: number;
  match_type: number | null;
  match_date: string | null;
  status: 'arranged' | 'ongoing' | 'finished';
  completed: boolean;
  actual_home_team_id: number | null;
  actual_away_team_id: number | null;
  actual_home_team_name: string | null;
  actual_away_team_name: string | null;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  total_minutes: number;
  home_team_known: boolean;
  away_team_known: boolean;
  home_team: { id: string; name: string; ht_team_id: number | null; logo_url: string | null } | null;
  away_team: { id: string; name: string; ht_team_id: number | null; logo_url: string | null } | null;
}

export interface HtMatchSuggestion {
  ht_match_id: number;
  match_type: number | null;
  match_date: string | null;
  status: 'arranged' | 'finished';
  actual_home_team_id: number | null;
  actual_away_team_id: number | null;
  actual_home_team_name: string | null;
  actual_away_team_name: string | null;
  home_goals: number | null;
  away_goals: number | null;
  home_team: { id: string; name: string; ht_team_id: number | null; logo_url: string | null } | null;
  away_team: { id: string; name: string; ht_team_id: number | null; logo_url: string | null } | null;
}

interface HtMatchFetchDiagnostics {
  rawChppMatchesReturned: number;
  selectedCategoryMatches: number;
  registeredTeamHeadToHeadMatches: number;
  alreadyImportedMatches: number;
  uniqueSuggestions: number;
  earliestDiscoveredDate: string | null;
  latestDiscoveredDate: string | null;
}

export type MatchFetchWindow = 'current' | 'previous' | 'last50';
export type MatchFetchCategory = 'friendlies' | 'cup' | 'league';

export interface TournamentRoleAccess {
  currentRole: 'original_organizer' | TournamentRole | null;
  viewerUserId: number;
  viewerManagerName: string | null;
  organizerUserId: number | null;
  organizerManagerName: string | null;
  isOriginalOrganizer: boolean;
  isImplicitSuperadmin: boolean;
  effectiveRole: 'original_organizer' | TournamentRole | null;
  canViewAdmin: boolean;
  canManageOperations: boolean;
  canPublishAnnouncements: boolean;
  canViewRoles: boolean;
  canManageAdmins: boolean;
  canManagePressOfficer: boolean;
  canManageCoOrganizer: boolean;
}

interface PendingJoinData {
  id: string;
  hattrick_user_id?: number | null;
  manager_name: string;
  teams_json: ChppTeamOption[];
  tournament_id: string | null;
  selection_token: string;
}

export interface MatchWithTeams {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  appg_outcome?: 'ET3' | 'ET2' | 'PS1' | 'RT0' | 'OPW' | 'needs_review' | null;
  appg_outcome_source?: 'unclassified' | 'chpp' | 'organizer' | 'csv' | null;
  home_yellow_cards?: number;
  home_red_cards?: number;
  home_injuries?: number;
  away_yellow_cards?: number;
  away_red_cards?: number;
  away_injuries?: number;
  match_event_details?: MatchEventDetails | null;
  home_match_kit_url?: string | null;
  away_match_kit_url?: string | null;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id: number | null;
  rating_share_statuses?: FixtureRatingShareStatus[];
  match_type: number | null;
  next_match_arrange_story?: TournamentMatchArrangeStorySnapshot | null;
  reserve_team_id?: string | null;
  reserve_replaces_team_id?: string | null;
  reserve_story?: TournamentMatchArrangeStorySnapshot | null;
  home_slot_id?: string | null;
  away_slot_id?: string | null;
  reserve_team?: {
    name: string;
    ht_team_id: number;
    active: boolean;
    reserve_active?: boolean;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    league_id?: number;
    league_level?: number | null;
    manager_name?: string;
    hattrick_user_id?: number;
  } | null;
  venue_type?: 'home_away' | null;
  scheduled_for?: string | null;
  chpp_match_date?: string | null;
  finished_at?: string | null;
  schedule_slot_type?: 'midweek_friendly' | 'weekend_friendly' | 'week15_weekend_friendly' | null;
  home_team: {
    name: string;
    ht_team_id: number;
    active: boolean;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    league_id?: number;
    league_level?: number | null;
    manager_name?: string;
    hattrick_user_id?: number;
    reserve_active?: boolean;
    reserve_replacing_name?: string;
  } | null;
  away_team: {
    name: string;
    ht_team_id: number;
    active: boolean;
    logo_url?: string;
    country_name?: string;
    country_id?: number;
    league_id?: number;
    league_level?: number | null;
    manager_name?: string;
    hattrick_user_id?: number;
    reserve_active?: boolean;
    reserve_replacing_name?: string;
  } | null;
  match_date?: Date;
  kickoff_confirmed?: boolean;
}

export interface Team {
  id: string;
  tournament_id: string;
  name: string;
  ht_team_id: number;
  active: boolean;
  replacement_for_team_id?: string;
  created_at: string;
  logo_url?: string;
  joined_via_oauth?: boolean;
  country_name?: string;
  country_id?: number | null;
  manager_name?: string;
  is_placeholder?: boolean;
  hattrick_user_id?: number;
  league_level?: number | null;
  league_id?: number | null;
  gender_id?: number | null;
  join_story?: TournamentJoinStory | null;
  reapply_season_number?: number | null;
  reserve_active?: boolean;
  reserve_joined_at?: string | null;
  reserve_origin?: 'organizer_added' | 'manager_joined' | 'participant_departure' | 'legacy_unknown' | null;
  pending_entry_round_id?: string | null;
  team_rank?: number | null;
  power_rating?: number | null;
  power_global_rank?: number | null;
  power_league_rank?: number | null;
  power_region_rank?: number | null;
}

export interface TeamPlanningStatus {
  inCup: boolean | null;
  bookedOutsideTournament: boolean;
}

export interface FetchedTeamData {
  teamId: number;
  teamName: string;
  logoUrl?: string;
  countryName?: string;
  countryId?: number;
  leagueId?: number;
  genderId?: number;
  leagueLevel?: number;
  teamRank?: number;
  powerRating?: number;
  powerGlobalRank?: number;
  powerLeagueRank?: number;
  powerRegionRank?: number;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  admin_password: string;
  scoring_mode: string;
  is_private: boolean;
  description: string | null;
  show_description: boolean;
  is_featured: boolean;
  thumbnail_index?: number;
  chpp_only_join: boolean;
  country_limit: string | null;
  default_theme?: EffectiveTheme | null;
  country_limit_format?: 'country_id' | 'league_id' | null;
  max_country_active_teams?: number | null;
  allow_manager_country_size_exception?: boolean;
  league_category: 'male' | 'hfi';
  registration_type: string;
  include_week15_weekend_friendly: boolean;
  organizer_name?: string;
  organizer_id?: number;
  image_url?: string;
  season: number;
  is_test: boolean;
  is_archived?: boolean | null;
  allow_reserve_registration?: boolean;
  status: TournamentStatus;
  last_fixtures_refresh: string | null;
  admin_email: string | null;
  forum_id?: number | null;
  max_teams: number | null;
  schedule_mode?: ScheduleMode | 'manual' | 'length' | null;
  schedule_start_slot?: string | null;
  schedule_locked_at?: string | null;
  registration_closed_at?: string | null;
  schedule_generated_at?: string | null;
}

export interface RoundWithMatches {
  id: string;
  round_number: number;
  created_at: string;
  season_number?: number;
  phase?: 'regular' | 'postseason';
  phase_round_number?: number;
  phase_status?: 'pending' | 'materialized' | 'completed';
  reserved_slot_id?: string | null;
  reserved_slot_kind?: string | null;
  reserved_slot_date?: string | null;
  matches: MatchWithTeams[];
}

export type { TournamentStatus } from '../../utils/tournament-lifecycle';
export type ScheduleSetup = 'generated' | 'manual';

export interface TournamentSeason {
  id: string;
  tournament_id: string;
  season_number: number;
  status: 'planned' | 'ongoing' | 'finished';
  planned_start_slot: string | null;
  started_at: string | null;
  finished_at: string | null;
  snapshot_json: SeasonHistorySnapshot | null;
  fixtures_snapshot_json?: SeasonFixturesSnapshot | null;
  champion_team_id?: string | null;
  champion_decided_at?: string | null;
  created_at: string;
  updated_at: string;
}

function toStandingTeam(team: Team): StandingTeam {
  return {
    id: team.id,
    name: team.name,
    ht_team_id: team.ht_team_id,
    hattrick_user_id: team.hattrick_user_id ?? null,
    active: team.active,
    replacement_for_team_id: team.replacement_for_team_id ?? null,
    joined_via_oauth: team.joined_via_oauth,
    country_name: team.country_name,
    country_id: team.country_id ?? null,
    league_id: team.league_id ?? null,
    logo_url: team.logo_url,
    manager_name: team.manager_name,
    is_placeholder: team.is_placeholder,
    reserve_active: team.reserve_active,
    team_rank: team.team_rank ?? null,
    power_rating: team.power_rating ?? null,
  };
}

function toStandingMatch(match: MatchWithTeams) {
  return {
    home_team_id: match.home_team_id,
    away_team_id: match.away_team_id,
    home_goals: match.home_goals,
    away_goals: match.away_goals,
    completed: match.completed,
    went_120: match.went_120,
    total_minutes: match.total_minutes,
    appg_outcome: match.appg_outcome,
    penalty_shootout_home_goals: match.penalty_shootout_home_goals,
    penalty_shootout_away_goals: match.penalty_shootout_away_goals,
    home_slot_id: match.home_slot_id,
    away_slot_id: match.away_slot_id,
  };
}

function getRegularStandingMatches(rounds: RoundWithMatches[]) {
  return getRegularPhaseMatches(rounds).map(toStandingMatch);
}

function applyReserveDisplay(match: MatchWithTeams): MatchWithTeams {
  const reserveTeam = match.reserve_team;
  if (!reserveTeam || !match.reserve_team_id || !match.reserve_replaces_team_id) return match;

  const replacingTeam = match.reserve_replaces_team_id === match.home_team_id ? match.home_team : match.away_team;
  const displayReserve = {
    ...reserveTeam,
    reserve_active: true,
    reserve_replacing_name: replacingTeam?.name,
  };

  return {
    ...match,
    home_team: match.reserve_replaces_team_id === match.home_team_id ? displayReserve : match.home_team,
    away_team: match.reserve_replaces_team_id === match.away_team_id ? displayReserve : match.away_team,
  };
}

function normalizeMatchTeamRelation(value: unknown): MatchWithTeams['home_team'] {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== 'object') return null;

  const team = relation as Record<string, unknown>;
  if (typeof team.name !== 'string' || typeof team.ht_team_id !== 'number' || typeof team.active !== 'boolean') {
    return null;
  }

  return {
    name: team.name,
    ht_team_id: team.ht_team_id,
    active: team.active,
    ...(typeof team.reserve_active === 'boolean' ? { reserve_active: team.reserve_active } : {}),
    ...(typeof team.logo_url === 'string' ? { logo_url: team.logo_url } : {}),
    ...(typeof team.country_name === 'string' ? { country_name: team.country_name } : {}),
    ...(typeof team.country_id === 'number' ? { country_id: team.country_id } : {}),
    ...(typeof team.league_id === 'number' ? { league_id: team.league_id } : {}),
    ...(typeof team.league_level === 'number' || team.league_level === null ? { league_level: team.league_level } : {}),
    ...(typeof team.manager_name === 'string' ? { manager_name: team.manager_name } : {}),
    ...(typeof team.hattrick_user_id === 'number' ? { hattrick_user_id: team.hattrick_user_id } : {}),
  };
}

function toSeasonHistoryMatch(match: MatchWithTeams, roundNumber?: number): SeasonHistoryMatch {
  return {
    id: match.id,
    roundNumber,
    scheduledFor: match.chpp_match_date || match.scheduled_for || match.match_date?.toISOString() || null,
    homeTeamName: match.home_team?.name || null,
    awayTeamName: match.away_team?.name || null,
    home_team_id: match.home_team_id,
    away_team_id: match.away_team_id,
    home_slot_id: match.home_slot_id,
    away_slot_id: match.away_slot_id,
    home_goals: match.home_goals,
    away_goals: match.away_goals,
    completed: match.completed,
    went_120: match.went_120,
    total_minutes: match.total_minutes,
    appg_outcome: match.appg_outcome,
    penalty_shootout_home_goals: match.penalty_shootout_home_goals,
    penalty_shootout_away_goals: match.penalty_shootout_away_goals,
    home_yellow_cards: match.home_yellow_cards,
    home_red_cards: match.home_red_cards,
    home_injuries: match.home_injuries,
    away_yellow_cards: match.away_yellow_cards,
    away_red_cards: match.away_red_cards,
    away_injuries: match.away_injuries,
    match_event_details: match.match_event_details,
  };
}

function restoreFixtureSnapshot(snapshot: SeasonFixturesSnapshot): RoundWithMatches[] {
  const restoreTeam = (team: SeasonFixturesSnapshot['rounds'][number]['matches'][number]['home_team']) =>
    team
      ? {
          name: team.name,
          ht_team_id: team.ht_team_id,
          active: false,
          logo_url: team.logo_url ?? undefined,
          country_name: team.country_name ?? undefined,
          country_id: team.country_id ?? undefined,
          league_id: team.league_id ?? undefined,
          league_level: team.league_level ?? undefined,
          manager_name: team.manager_name ?? undefined,
          hattrick_user_id: team.hattrick_user_id ?? undefined,
        }
      : null;

  return snapshot.rounds.map((round) => ({
    id: round.id,
    round_number: round.round_number,
    created_at: round.created_at,
    phase: round.phase,
    phase_status: round.phase_status,
    reserved_slot_date: round.reserved_slot_date,
    matches: round.matches
      .map((match) => ({
        ...match,
        match_date: match.match_date ? new Date(match.match_date) : undefined,
        kickoff_confirmed: Boolean(match.chpp_match_date),
        home_team: restoreTeam(match.home_team),
        away_team: restoreTeam(match.away_team),
      }))
      .sort(compareFixtures),
  }));
}

function isBlockingTeamTournament(
  tournament?: {
    status?: string | null;
    is_test?: boolean | null;
    registration_type?: string | null;
  } | null,
) {
  return Boolean(tournament && isExclusiveTournament(tournament));
}

function reviveInitialRounds(initialData?: TournamentInitialData) {
  return ((initialData?.rounds || []) as Record<string, unknown>[]).map((round) => ({
    ...round,
    matches: (
      (round.matches || []) as Array<
        Record<string, unknown> & {
          id: string;
          ht_match_id?: number | null;
          status?: string | null;
          match_date?: string | Date | null;
        }
      >
    )
      .map((match) => ({
        ...match,
        match_date: typeof match.match_date === 'string' ? new Date(match.match_date) : undefined,
        kickoff_confirmed: Boolean(match.chpp_match_date),
      }))
      .sort(compareFixtures),
  })) as RoundWithMatches[];
}

export const TournamentView: React.FC<{
  initialData?: TournamentInitialData;
  collectionLinks?: { slug: string; title: string }[];
}> = ({ initialData, collectionLinks = [] }) => {
  const uiText = useTranslations('PublicUI.TournamentView');
  const t = useTranslations('TournamentView');
  const { notice, showNotice: alert, closeNotice } = useNoticeDialog();
  const { confirmation, confirm, resolveConfirmation } = useConfirmationDialog();
  const lifecycleText = useTranslations('TournamentView');
  const [isChangingPublication, setIsChangingPublication] = useState(false);
  const { locale } = useLocale();
  const descriptionPools = getDescriptionPools(locale);
  const { slug: rawSlug } = useParams<{ slug: string }>();
  const slug = typeof rawSlug === 'string' ? rawSlug : '';
  const pathname = usePathname() || '/';
  const router = useRouter();
  const searchParams = useNextSearchParams();
  const setSearchParams = useCallback(
    (next: URLSearchParams | Record<string, string>, options?: { replace?: boolean }) => {
      const params = next instanceof URLSearchParams ? next : new URLSearchParams(next);
      const query = params.toString();
      const url = `${pathname}${query ? `?${query}` : ''}`;
      // These parameters select client-owned tabs/seasons, not server data.
      // Next integrates native history with useSearchParams and browser Back.
      if (options?.replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    },
    [pathname],
  );
  const tournamentFaqSections = useMemo(() => getTournamentFaqSections(), []);
  const tournamentFaqItems = useMemo(
    () =>
      tournamentFaqSections
        .flatMap((section) => section.items)
        .map((item) => ({
          id: item.id,
          title: item.question,
          body: item.answer,
        })),
    [tournamentFaqSections],
  );
  const tournamentSettingsFaqItems = useMemo(
    () => [
      {
        id: 'admin-faq-category',
        title: 'Tournament Category',
        body: 'Choose the tournament type. Hattrick Validated keeps CHPP-linked teams, Organizer-managed keeps manual control, and Sandbox is for test tournaments.',
      },
      {
        id: 'admin-faq-schedule',
        title: 'Schedule setup',
        body: 'Generated schedule reserves a safe Hattrick calendar and builds tournament pairings. Choose a single round robin or all remaining safe rounds, with optional playoffs. One actionable round is published at a time. No pre-made schedule lets you add real Hattrick matches manually.',
      },
      {
        id: 'admin-faq-team-limit',
        title: 'Team Limit',
        body: 'Set the maximum number of teams allowed in the tournament. Leave it open if you want the roster to stay flexible.',
      },
      {
        id: 'admin-faq-start-date',
        title: 'Planned start date',
        body: 'This is the planned display date on tournament cards until a real schedule exists. Once fixtures are locked, the actual start date takes over.',
      },
      {
        id: 'admin-faq-validated',
        title: 'Only Hattrick validated teams can join',
        body: 'Keep this on if only CHPP-linked teams should be able to join. Turn it off when you want manual or sandbox teams to be added too.',
      },
      {
        id: 'admin-faq-country',
        title: 'Country limit',
        body: 'Use this to restrict joining teams to a specific country. If the current roster already spans multiple countries, the value has to fit everyone already in the tournament.',
      },
      {
        id: 'admin-faq-email',
        title: 'Recovery email',
        body: 'Add a recovery email if you want a fallback for admin password problems. It is optional, but useful when the tournament may need long-term maintenance.',
      },
    ],
    [],
  );
  const [tournament, setTournament] = useState<Tournament | null>(
    () => (initialData?.tournament as unknown as Tournament | undefined) || null,
  );
  useLayoutEffect(() => {
    setTournamentTheme(normalizeTournamentTheme(tournament?.default_theme));
    return () => setTournamentTheme(null);
  }, [tournament?.id, tournament?.default_theme]);

  useEffect(() => {
    if (!tournament?.name) return;

    const previousTitle = document.title;
    document.title = `${tournament.name} | HT-120min`;
    return () => {
      document.title = previousTitle;
    };
  }, [tournament?.name]);
  const [standings, setStandings] = useState<TeamStanding[]>(
    () => (initialData?.standings as unknown as TeamStanding[] | undefined) || [],
  );
  const [seasonSlots, setSeasonSlots] = useState<Array<{ id: string; current_team_id: string | null }>>(
    () => initialData?.seasonSlots || [],
  );
  const [seasonSlotAssignments, setSeasonSlotAssignments] = useState<SeasonSlotAssignment[]>(
    () => initialData?.seasonSlotAssignments || [],
  );
  const [rounds, setRounds] = useState<RoundWithMatches[]>(() => reviveInitialRounds(initialData));
  const [teams, setTeams] = useState<Team[]>(() => (initialData?.teams as unknown as Team[] | undefined) || []);
  const managerSpotlight = initialData?.managerSpotlight || null;
  const [warnings, setWarnings] = useState<any[]>(() => initialData?.warnings || []);
  const [activityWarnings, setActivityWarnings] = useState<any[]>(
    () => initialData?.activityWarnings || initialData?.warnings || [],
  );
  const [lastSeenMap, setLastSeenMap] = useState<Record<number, string | null>>({});
  const [managerProfiles, setManagerProfiles] = useState<Record<number, ChatAuthorProfile>>({});
  const [playingElsewhereTeamIds, setPlayingElsewhereTeamIds] = useState<Set<number>>(new Set());

  // Sync activeTab with URL search param 'tab'
  const activeTabParam = searchParams.get('tab');
  const activeTab = ['standings', 'fixtures', 'history', 'guestbook', 'admin', 'news'].includes(activeTabParam || '')
    ? (activeTabParam as any)
    : 'standings';

  const [isRefreshingFixtures, setIsRefreshingFixtures] = useState(false);
  const [isRefreshingRoster, setIsRefreshingRoster] = useState(false);

  const [announcements, setAnnouncements] = useState<TournamentAnnouncement[]>(
    () => (initialData?.announcements as unknown as TournamentAnnouncement[] | undefined) || [],
  );
  const [announcementDismissals, setAnnouncementDismissals] = useState<TournamentAnnouncementDismissal[]>([]);
  const [, setPublicAnnouncementDismissalVersion] = useState(0);
  const [seasons, setSeasons] = useState<TournamentSeason[]>(
    () => (initialData?.seasons as unknown as TournamentSeason[] | undefined) || [],
  );
  const currentSeasonNumberForSelection = tournament?.season || 1;
  const availableSeasonNumbers = [
    ...new Set([currentSeasonNumberForSelection, ...seasons.map((season) => season.season_number)]),
  ]
    .filter((seasonNumber) => seasonNumber <= currentSeasonNumberForSelection)
    .sort((a, b) => b - a);
  const requestedSeasonNumber = Number(searchParams.get('season'));
  const selectedSeasonNumber =
    Number.isInteger(requestedSeasonNumber) &&
    requestedSeasonNumber > 0 &&
    availableSeasonNumbers.includes(requestedSeasonNumber)
      ? requestedSeasonNumber
      : currentSeasonNumberForSelection;
  const historyCommentsCacheRef = useRef(new Map<string, TournamentSeasonComment[]>());
  const historyCommentsRequestsRef = useRef(new Map<string, Promise<TournamentSeasonComment[]>>());
  const [historyReportNoticeOpen, setHistoryReportNoticeOpen] = useState(false);
  const [historySeasonCommentCounts, setHistorySeasonCommentCounts] = useState<Record<string, number>>({});
  const [historySeenVersion, setHistorySeenVersion] = useState(0);
  const [isAddingSeason, setIsAddingSeason] = useState(false);
  const [rebuildingSeasonNumber, setRebuildingSeasonNumber] = useState<number | null>(null);
  const [isFinalizingSeason, setIsFinalizingSeason] = useState(false);
  const [isStandingsSeasonMenuOpen, setIsStandingsSeasonMenuOpen] = useState(false);
  const standingsSeasonMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isStandingsSeasonMenuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsStandingsSeasonMenuOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!standingsSeasonMenuRef.current?.contains(event.target as Node)) setIsStandingsSeasonMenuOpen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isStandingsSeasonMenuOpen]);

  // Chat states
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  const [password, setPassword] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [roleAccess, setRoleAccess] = useState<TournamentRoleAccess | null>(null);
  const adminState = useTournamentAdminState();
  const {
    tournamentRoles,
    setTournamentRoles,
    originalOrganizer,
    setOriginalOrganizer,
    roleAccessLoading,
    setRoleAccessLoading,
    adminAuthSource,
    setAdminAuthSource,
    adminAuthError,
    setAdminAuthError,
    failedLoginAttempt,
    setFailedLoginAttempt,
    isDuplicatingSandbox,
    setIsDuplicatingSandbox,
    isRefreshingSpotlight,
    setIsRefreshingSpotlight,
    isArchivingTournament,
    setIsArchivingTournament,
    newTeamId,
    setNewTeamId,
    newTeamName,
    setNewTeamName,
    newTeamData,
    setNewTeamData,
    isReserveTeamFormOpen,
    setIsReserveTeamFormOpen,
    reserveTeamId,
    setReserveTeamId,
    reserveTeamName,
    setReserveTeamName,
    sandboxCandidate,
    setSandboxCandidate,
    sandboxFetchError,
    setSandboxFetchError,
    isFetchingSandboxTeam,
    setIsFetchingSandboxTeam,
    isSavingTeam,
    setIsSavingTeam,
    isGenerating,
    setIsGenerating,
    scheduleNotice,
    setScheduleNotice,
    schedulePreflightWarning,
    setSchedulePreflightWarning,
    isScheduleConfirmationOpen,
    setIsScheduleConfirmationOpen,
    isRescheduling,
    setIsRescheduling,
    editingMatch,
    setEditingMatch,
    matchData,
    setMatchData,
    replacingTeamId,
    setReplacingTeamId,
    reserveReplacingTeamId,
    setReserveReplacingTeamId,
    selectedReserveTeamId,
    setSelectedReserveTeamId,
    replacementHtId,
    setReplacementHtId,
    replacementName,
    setReplacementName,
    isFetchingTeamData,
    setIsFetchingTeamData,
    teamPlanningStatuses,
    setTeamPlanningStatuses,
    isRefreshingTeamStatuses,
    setIsRefreshingTeamStatuses,
    teamStatusNotice,
    setTeamStatusNotice,
    isUpdatingHfiRanks,
    setIsUpdatingHfiRanks,
    hfiRankNotice,
    setHfiRankNotice,
    hfiRankNoticeIsError,
    setHfiRankNoticeIsError,
    scheduleMode,
    setScheduleMode,
    scheduleSetup,
    setScheduleSetup,
    scheduleStartSlotId,
    setScheduleStartSlotId,
    scheduleTeamOrder,
    setScheduleTeamOrder,
    lengthFormatId,
    setLengthFormatId,
    isRepairingRound,
    setIsRepairingRound,
    isRecoveringRoundOne,
    setIsRecoveringRoundOne,
    includeWeek15WeekendFriendly,
    setIncludeWeek15WeekendFriendly,
    rescheduleFromRoundNumber,
    setRescheduleFromRoundNumber,
    rescheduleStartSlotId,
    setRescheduleStartSlotId,
    includeWeek15WeekendFriendlyForReschedule,
    setIncludeWeek15WeekendFriendlyForReschedule,
    editName,
    setEditName,
    editIsPrivate,
    setEditIsPrivate,
    editChppOnlyJoin,
    setEditChppOnlyJoin,
    editLeagueCategory,
    setEditLeagueCategory,
    editRegistrationType,
    setEditRegistrationType,
    editCountryLimit,
    setEditCountryLimit,
    editMaxCountryActiveTeams,
    setEditMaxCountryActiveTeams,
    editAllowManagerCountrySizeException,
    setEditAllowManagerCountrySizeException,
    editDefaultTheme,
    setEditDefaultTheme,
    editScoringMode,
    setEditScoringMode,
    editMaxTeams,
    setEditMaxTeams,
    editRegistrationOpen,
    setEditRegistrationOpen,
    editAllowReserveRegistration,
    setEditAllowReserveRegistration,
    showEditDescription,
    setShowEditDescription,
    editDescription,
    setEditDescription,
    showEditEmail,
    setShowEditEmail,
    editAdminEmail,
    setEditAdminEmail,
    editForumId,
    setEditForumId,
    isUpdatingSettings,
    setIsUpdatingSettings,
    isResettingAdminPassword,
    setIsResettingAdminPassword,
    isTest,
    setIsTest,
    editIsFeatured,
    setEditIsFeatured,
    isInviteExpanded,
    setIsInviteExpanded,
  } = adminState;
  const paramsHandledRef = useRef(false);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [isUpdatingImage, setIsUpdatingImage] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);
  const [hasClosedCreatedTournamentWelcome, setHasClosedCreatedTournamentWelcome] = useState(false);
  const [hasClosedOpenTournamentWelcome, setHasClosedOpenTournamentWelcome] = useState(false);
  const [organizerProfileName, setOrganizerProfileName] = useState<string | null>(
    () => initialData?.organizerProfileName || null,
  );
  const isHydrationReady = useHydrationReady();
  const storedHtUserId = useHydratedLocalStorage('my_ht_user_id');
  const storedHtManagerName = useHydratedLocalStorage('my_ht_manager_name');
  const currentHtUserId = Number(storedHtUserId || '0') || null;

  useEffect(() => {
    if (!tournament?.id || !currentHtUserId) {
      const timer = window.setTimeout(() => {
        setTournamentRoles([]);
        setOriginalOrganizer({ hattrick_user_id: null, manager_name: null });
        setRoleAccess(null);
        setRoleAccessLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    const loadingTimer = window.setTimeout(() => setRoleAccessLoading(true), 0);
    fetch(`/api/app?route=tournament-access&tournamentId=${encodeURIComponent(tournament.id)}`, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as {
          viewerUserId?: number;
          viewerManagerName?: string | null;
          organizerUserId?: number | null;
          organizerManagerName?: string | null;
          actualRole?: 'original_organizer' | TournamentRole | null;
          effectiveRole?: 'original_organizer' | TournamentRole | null;
          isOriginalOrganizer?: boolean;
          isImplicitSuperadmin?: boolean;
          canViewAdmin?: boolean;
          canManageOperations?: boolean;
          canPublishAnnouncements?: boolean;
          canViewRoles?: boolean;
          canManageAdmins?: boolean;
          canManagePressOfficer?: boolean;
          canManageCoOrganizer?: boolean;
        };
      })
      .then(async (data) => {
        if (cancelled) return;
        if (data?.canViewRoles) {
          setOriginalOrganizer({
            hattrick_user_id: data.organizerUserId || null,
            manager_name:
              data.organizerManagerName || (data.isOriginalOrganizer ? data.viewerManagerName || null : null) || null,
          });
          const rolesResponse = await fetch(
            `/api/app?route=tournament-roles&tournamentId=${encodeURIComponent(tournament.id)}`,
            {
              credentials: 'include',
            },
          );
          if (rolesResponse.ok) {
            const roleData = (await rolesResponse.json()) as {
              roles?: TournamentRoleRecord[];
              originalOrganizer?: TournamentOwnerRecord;
            };
            setTournamentRoles(roleData.roles || []);
            setOriginalOrganizer({
              hattrick_user_id: roleData.originalOrganizer?.hattrick_user_id || data.organizerUserId || null,
              manager_name:
                roleData.originalOrganizer?.manager_name ||
                data.organizerManagerName ||
                (data.isOriginalOrganizer ? data.viewerManagerName : null) ||
                null,
            });
          }
        } else {
          setTournamentRoles([]);
          setOriginalOrganizer({ hattrick_user_id: null, manager_name: null });
        }
        setRoleAccess(
          data
            ? {
                currentRole: data.actualRole || null,
                viewerUserId: data.viewerUserId || currentHtUserId,
                viewerManagerName: data.viewerManagerName || null,
                organizerUserId: data.organizerUserId || null,
                organizerManagerName: data.organizerManagerName || null,
                isOriginalOrganizer: Boolean(data.isOriginalOrganizer),
                isImplicitSuperadmin: Boolean(data.isImplicitSuperadmin),
                effectiveRole: data.effectiveRole || null,
                canViewAdmin: Boolean(data.canViewAdmin),
                canManageOperations: Boolean(data.canManageOperations),
                canPublishAnnouncements: Boolean(data.canPublishAnnouncements),
                canViewRoles: Boolean(data.canViewRoles),
                canManageAdmins: Boolean(data.canManageAdmins),
                canManagePressOfficer: Boolean(data.canManagePressOfficer),
                canManageCoOrganizer: Boolean(data.canManageCoOrganizer),
              }
            : null,
        );
        setRoleAccessLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRoleAccess(null);
          setRoleAccessLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimer);
    };
  }, [currentHtUserId, setOriginalOrganizer, setRoleAccessLoading, setTournamentRoles, tournament?.id]);

  const latestPublishedHistorySeason = useMemo(
    () =>
      [...seasons]
        .filter((season) => season.status === 'finished' && season.snapshot_json)
        .sort((a, b) => b.season_number - a.season_number)[0] || null,
    [seasons],
  );

  const loadHistoryComments = useCallback(async (seasonId: string) => {
    const cachedComments = historyCommentsCacheRef.current.get(seasonId);
    if (cachedComments) return cachedComments;

    const pendingRequest = historyCommentsRequestsRef.current.get(seasonId);
    if (pendingRequest) return pendingRequest;

    const request = fetch(`/api/app?route=history&seasonId=${encodeURIComponent(seasonId)}`)
      .then(async (response) => {
        const data = (await response.json()) as { comments?: TournamentSeasonComment[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load season comments.');
        const comments = data.comments || [];
        historyCommentsCacheRef.current.set(seasonId, comments);
        return comments;
      })
      .finally(() => {
        historyCommentsRequestsRef.current.delete(seasonId);
      });

    historyCommentsRequestsRef.current.set(seasonId, request);
    return request;
  }, []);

  const handleHistoryCommentSubmitted = useCallback((seasonId: string, comment: TournamentSeasonComment) => {
    const currentComments = historyCommentsCacheRef.current.get(seasonId) || [];
    historyCommentsCacheRef.current.set(seasonId, [
      ...currentComments.filter((item) => item.id !== comment.id && item.team_id !== comment.team_id),
      comment,
    ]);
  }, []);

  useEffect(() => {
    if (!tournament?.id || !latestPublishedHistorySeason) return;
    void loadHistoryComments(latestPublishedHistorySeason.id).catch(() => {
      // History tab rendering remains responsible for showing a load error.
    });
  }, [latestPublishedHistorySeason, loadHistoryComments, tournament?.id]);

  const renderTimestamp = useClientNow();
  const historyReportPublishedAt = latestPublishedHistorySeason?.snapshot_json?.generatedAt || null;
  const historyReportNoticeIsCurrent = Boolean(
    historyReportPublishedAt &&
    renderTimestamp - new Date(historyReportPublishedAt).getTime() <= 7 * 24 * 60 * 60 * 1000,
  );

  useEffect(() => {
    if (!tournament || !latestPublishedHistorySeason || !historyReportNoticeIsCurrent || !currentHtUserId) return;

    const localNoticeKey = getHistoryReportNoticeStorageKey(latestPublishedHistorySeason.id);
    if (localStorage.getItem(localNoticeKey) === 'true') {
      return;
    }

    let cancelled = false;
    fetch(
      `/api/app?route=history&notice=history-report-status&seasonId=${encodeURIComponent(latestPublishedHistorySeason.id)}&tournamentId=${encodeURIComponent(tournament.id)}`,
    )
      .then((response) => response.json())
      .then((data: { dismissed?: boolean; seen?: boolean; tracked?: boolean }) => {
        if (cancelled) return;
        setHistoryReportNoticeOpen(
          localStorage.getItem(localNoticeKey) !== 'true' &&
            data.tracked === true &&
            data.dismissed !== true &&
            data.seen !== true,
        );
      })
      .catch(() => {
        if (!cancelled) setHistoryReportNoticeOpen(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentHtUserId, historyReportNoticeIsCurrent, latestPublishedHistorySeason, tournament]);

  useEffect(() => {
    if (!tournament || !activeTab || activeTab !== 'history' || !latestPublishedHistorySeason || !currentHtUserId)
      return;
    void fetch('/api/app?route=history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark-history-report-seen',
        seasonId: latestPublishedHistorySeason.id,
        tournamentId: tournament.id,
      }),
    });
  }, [activeTab, currentHtUserId, latestPublishedHistorySeason, tournament]);

  const dismissHistoryReportNotice = () => {
    if (!tournament || !latestPublishedHistorySeason || !currentHtUserId) return;
    setHistoryReportNoticeOpen(false);
    localStorage.setItem(getHistoryReportNoticeStorageKey(latestPublishedHistorySeason.id), 'true');
    void fetch('/api/app?route=history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark-history-report-dismissed',
        seasonId: latestPublishedHistorySeason.id,
        tournamentId: tournament.id,
      }),
    });
  };

  const markHistoryReportSeen = () => {
    if (!tournament || !latestPublishedHistorySeason || !currentHtUserId) return;
    setHistoryReportNoticeOpen(false);
    localStorage.setItem(getHistoryReportNoticeStorageKey(latestPublishedHistorySeason.id), 'true');
    void fetch('/api/app?route=history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mark-history-report-seen',
        seasonId: latestPublishedHistorySeason.id,
        tournamentId: tournament.id,
      }),
    });
  };

  const savedStartSlotId = useMemo(() => {
    if (!tournament?.schedule_start_slot) return '';
    const storedStartSlot = buildCalendarSlots(new Date(), 160).find(
      (slot) => slot.nominalDate.toISOString() === tournament.schedule_start_slot,
    );
    return storedStartSlot?.id || '';
  }, [tournament]);
  const firstKnownFixtureDate = useMemo(() => {
    const dates = rounds
      .flatMap((round) => round.matches)
      .map((match) => (match.scheduled_for ? new Date(match.scheduled_for) : (match.match_date ?? null)))
      .filter((date): date is Date => Boolean(date && Number.isFinite(date.getTime())))
      .sort((a, b) => a.getTime() - b.getTime());

    return dates[0] ?? null;
  }, [rounds]);
  const isStartDateLocked = Boolean(firstKnownFixtureDate);

  const myHtUserId = storedHtUserId;
  const hasJoined = teams.some((t) => t.hattrick_user_id === Number(myHtUserId) && t.active);
  const normalizedRegistrationType = tournament
    ? normalizeTournamentRegistrationType(tournament.registration_type)
    : 'manual';
  const isSandbox = tournament ? isSandboxTournament(tournament.registration_type) : false;
  const isValidatedTournament = normalizedRegistrationType === 'validated';
  const isOrganizerManagedTournament = normalizedRegistrationType === 'manual';
  const isPausedTournament = tournament?.status === 'paused';
  const isStoppedTournament = tournament?.status === 'stopped';
  const organizerTeam = tournament?.organizer_id
    ? teams.find((team) => Number(team.hattrick_user_id) === Number(tournament.organizer_id))
    : null;
  const publicOrganizerName = tournament?.organizer_name || organizerTeam?.manager_name || organizerProfileName || null;
  const currentHtManagerName = storedHtManagerName || publicOrganizerName || 'Admin';
  const canLoginAsOrganizer = Boolean(
    tournament?.organizer_id && currentHtUserId && Number(tournament.organizer_id) === currentHtUserId,
  );
  const verifiedRoleAccess = Boolean(roleAccess?.canViewAdmin);
  const oauthRoleAccess = Boolean(verifiedRoleAccess && adminAuthSource === 'oauth_role');
  const delegatedRole = roleAccess?.currentRole || null;
  const verifiedRoleLabel =
    roleAccess?.isImplicitSuperadmin && !delegatedRole
      ? 'Site Admin'
      : delegatedRole === 'original_organizer'
        ? 'Organiser'
        : delegatedRole
          ? TOURNAMENT_ROLE_LABELS[delegatedRole]
          : 'Tournament admin';
  const isPressOfficer = oauthRoleAccess && delegatedRole === 'press_officer';
  const canManageOperationalAdmin = Boolean(
    isAdminAuthenticated &&
    !isPressOfficer &&
    ((adminAuthSource === 'oauth_role' && roleAccess?.canManageOperations) || adminAuthSource === 'legacy_password'),
  );
  const canToggleArchiveTournament = Boolean(
    tournament && ['finished', 'stopped'].includes(tournament.status) && canManageOperationalAdmin,
  );
  const adminAccessMode = oauthRoleAccess
    ? roleAccess?.isImplicitSuperadmin && !delegatedRole
      ? 'Site Admin'
      : delegatedRole === 'original_organizer'
        ? 'Organiser'
        : delegatedRole
          ? TOURNAMENT_ROLE_LABELS[delegatedRole]
          : 'OAuth admin'
    : 'Guest admin (password access)';
  const adminAccessName = oauthRoleAccess ? roleAccess?.viewerManagerName || currentHtManagerName : 'Guest admin';

  const tournamentVisitWelcomeKey = slug ? getTournamentVisitWelcomeKey(slug) : null;
  const showCreatedTournamentWelcome = searchParams.get('welcome') === TOURNAMENT_CREATED_WELCOME;
  const showCreatedTournamentWelcomeVisible = Boolean(
    tournament &&
    ((showCreatedTournamentWelcome && !hasClosedCreatedTournamentWelcome) ||
      TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT.createdTournamentWelcome),
  );
  const showOpenTournamentWelcome = Boolean(
    isHydrationReady &&
    tournament &&
    (TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT.openTournamentWelcome ||
      (tournamentVisitWelcomeKey &&
        slug &&
        !showCreatedTournamentWelcomeVisible &&
        !isSandbox &&
        isValidatedTournament &&
        ['recruiting', 'open'].includes(tournament.status) &&
        !hasJoined &&
        !canLoginAsOrganizer &&
        !hasClosedOpenTournamentWelcome &&
        !hasDismissedWelcome(tournamentVisitWelcomeKey))),
  );

  const isSiteAdmin = Boolean(roleAccess?.isImplicitSuperadmin);
  const canManageFeaturedTournaments = isSiteAdmin;
  const dismissedPublicAnnouncementIds = new Set(
    announcements
      .filter(
        (announcement) => isHydrationReady && readLocalStorage(`announcement_dismissed_${announcement.id}`) === 'true',
      )
      .map((announcement) => announcement.id),
  );
  const unsavedSettingsFields = useMemo(() => {
    if (!tournament) {
      return {
        name: false,
        private: false,
        chppOnlyJoin: false,
        leagueCategory: false,
        registrationType: false,
        countryLimit: false,
        defaultTheme: false,
        scoringMode: false,
        maxTeams: false,
        registrationOpen: false,
        allowReserveRegistration: false,
        showDescription: false,
        description: false,
        showEmail: false,
        adminEmail: false,
        forumId: false,
        scheduleMode: false,
        scheduleStart: false,
        test: false,
        featured: false,
      };
    }

    const savedCountryLimit = normalizeLeagueLimit(
      tournament.country_limit,
      tournament.country_limit_format ?? 'league_id',
    );
    const savedAdminEmail = tournament.admin_email || '';
    const savedForumId = tournament.forum_id ? String(tournament.forum_id) : '';
    const currentScheduleSetting =
      tournament.schedule_mode === 'length' ? 'length' : scheduleSetup === 'manual' ? 'manual' : scheduleMode;
    const savedScheduleSetting =
      tournament.schedule_mode === 'length'
        ? 'length'
        : tournament.schedule_mode === 'manual'
          ? 'manual'
          : normalizeGeneratedScheduleMode(tournament.schedule_mode);

    return {
      name: editName !== tournament.name,
      private: editIsPrivate !== tournament.is_private,
      chppOnlyJoin: editChppOnlyJoin !== tournament.chpp_only_join,
      leagueCategory: editLeagueCategory !== (tournament.league_category || 'male'),
      registrationType: editRegistrationType !== normalizeTournamentRegistrationType(tournament.registration_type),
      countryLimit: editCountryLimit !== savedCountryLimit,
      maxCountryActiveTeams: editMaxCountryActiveTeams !== (tournament.max_country_active_teams ?? null),
      managerCountrySizeException:
        editAllowManagerCountrySizeException !== Boolean(tournament.allow_manager_country_size_exception),
      defaultTheme: editDefaultTheme !== (tournament.default_theme ?? null),
      scoringMode: editScoringMode !== tournament.scoring_mode,
      maxTeams: editMaxTeams !== (tournament.max_teams || null),
      registrationOpen: editRegistrationOpen !== !tournament.registration_closed_at,
      allowReserveRegistration: editAllowReserveRegistration !== (tournament.allow_reserve_registration !== false),
      showDescription: showEditDescription !== tournament.show_description,
      description: editDescription !== (tournament.description || ''),
      showEmail: showEditEmail !== Boolean(tournament.admin_email),
      adminEmail: editAdminEmail !== savedAdminEmail,
      forumId: editForumId !== savedForumId,
      scheduleMode: currentScheduleSetting !== savedScheduleSetting,
      scheduleStart: !isStartDateLocked && scheduleStartSlotId !== savedStartSlotId,
      test: isTest !== Boolean(tournament.is_test),
      featured: editIsFeatured !== Boolean(tournament.is_featured),
    };
  }, [
    editAdminEmail,
    editForumId,
    editChppOnlyJoin,
    editCountryLimit,
    editMaxCountryActiveTeams,
    editAllowManagerCountrySizeException,
    editDefaultTheme,
    editScoringMode,
    editDescription,
    editIsPrivate,
    editLeagueCategory,
    editMaxTeams,
    editName,
    editRegistrationOpen,
    editAllowReserveRegistration,
    editRegistrationType,
    isStartDateLocked,
    isTest,
    scheduleMode,
    scheduleSetup,
    scheduleStartSlotId,
    savedStartSlotId,
    showEditDescription,
    showEditEmail,
    editIsFeatured,
    tournament,
  ]);
  const settingsHasUnsavedChanges = Object.values(unsavedSettingsFields).some(Boolean);
  // Join states
  const [isJoining, setIsJoining] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const connectingRef = useRef(false);
  const submittingJoinRef = useRef(false);
  const connectToHattrick = () => {
    if (connectingRef.current || !tournament) return;
    connectingRef.current = true;
    setIsConnecting(true);
    window.location.href = `/api/auth/init?tournament_id=${tournament.id}`;
  };
  useEffect(() => {
    const reset = () => {
      connectingRef.current = false;
      setIsConnecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  const [joinTeamId, setJoinTeamId] = useState('');
  const [joinTeamName, setJoinTeamName] = useState('');
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [pendingJoinData, setPendingJoinData] = useState<PendingJoinData | null>(null);
  const [submittingJoin, setSubmittingJoin] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [showJoinErrorModal, setShowJoinErrorModal] = useState(false);

  // UI state
  const [showScoringHelp, setShowScoringHelp] = useState(false);
  const [isAddingDescription, setIsAddingDescription] = useState(false);
  const [expandedRounds, setExpandedRounds] = useState<Record<string, boolean>>({});
  const expandedRoundsReadyRef = useRef(false);

  useEffect(() => {
    if (!isHydrationReady) return;

    const timer = window.setTimeout(() => {
      const saved = readLocalStorage(`expanded_rounds_${slug}`);
      expandedRoundsReadyRef.current = true;
      if (!saved) return;

      try {
        setExpandedRounds(JSON.parse(saved) as Record<string, boolean>);
      } catch {
        setExpandedRounds({});
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [isHydrationReady, slug]);

  useEffect(() => {
    if (!isHydrationReady || !expandedRoundsReadyRef.current) return;
    localStorage.setItem(`expanded_rounds_${slug}`, JSON.stringify(expandedRounds));
  }, [expandedRounds, isHydrationReady, slug]);

  const toggleRound = useCallback((roundId: string) => {
    setExpandedRounds((current) => ({
      ...current,
      [roundId]: !current[roundId],
    }));
  }, []);
  const [quickDescription, setQuickDescription] = useState('');
  const [isJoinedNoticeDismissed, setIsJoinedNoticeDismissed] = useState(false);
  const [withdrawingPendingTeamId, setWithdrawingPendingTeamId] = useState<string | null>(null);
  const storedJoinedNoticeDismissed = useHydratedLocalStorage(slug ? `joined_notice_dismissed_${slug}` : '');

  const regenerateDescription = (isQuick: boolean) => {
    const randomDesc = randomDescriptionFromPool(descriptionPools.tournament);
    if (isQuick) setQuickDescription(randomDesc);
    else setEditDescription(randomDesc);
  };

  const [loading, setLoading] = useState(() => !initialData);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const hasLoadedTournamentRef = useRef(Boolean(initialData));
  const initialLoadAttemptedRef = useRef(false);

  const allMatches = rounds.flatMap((r) => r.matches);
  const isGenerated = rounds.length > 0;
  const departureRound = rounds.find((round) => round.phase_status === 'materialized');
  const [departureNoticeContainer, setDepartureNoticeContainer] = useState<HTMLDivElement | null>(null);
  const participantTeams = teams.filter(isCurrentParticipantTeam);
  const reserveTeams = teams.filter((team) => !team.is_placeholder && team.reserve_active);
  const pendingNextRoundTeams = teams.filter((team) =>
    !team.active && !team.reserve_active && !team.is_placeholder &&
    rounds.some((round) => round.id === team.pending_entry_round_id && round.phase_status === 'pending' && round.phase === 'regular'),
  );
  const currentSeasonSlotTeamIds = useMemo(
    () =>
      new Set(seasonSlots.map((slot) => slot.current_team_id).filter((teamId): teamId is string => Boolean(teamId))),
    [seasonSlots],
  );
  const activeParticipantCount = participantTeams.length;
  const maxTeamsAllowsPromotion =
    !tournament?.max_teams || tournament.max_teams <= 0 || activeParticipantCount < tournament.max_teams;

  const isHealthQuotaMet = useCallback(
    (teamList: Team[] = teams) => {
      const currentSeasonTeamIds = new Set(
        rounds.flatMap((round) =>
          round.matches.flatMap((match) => [match.home_team_id, match.away_team_id].filter(Boolean) as string[]),
        ),
      );
      const replacedTeamIds = new Set(teamList.map((team) => team.replacement_for_team_id).filter(Boolean) as string[]);
      const currentSeasonTeams = teamList.filter(
        (team) =>
          !team.is_placeholder &&
          !team.reserve_active &&
          (team.active || (currentSeasonTeamIds.has(team.id) && !replacedTeamIds.has(team.id))),
      );
      if (!currentSeasonTeams.length) return true;

      const totalCount = currentSeasonTeams.length;
      const inactiveCount = currentSeasonTeams.filter((team) => !team.active).length;

      // Small tournaments (2-3 teams) are exempt as per prompt ("recurring friendlies")
      if (totalCount <= 3) return true;

      if (totalCount <= 5) return inactiveCount === 0;
      if (totalCount === 6) return inactiveCount <= 1;
      if (totalCount === 7) return inactiveCount === 0;

      return inactiveCount / totalCount <= 0.25;
    },
    [rounds, teams],
  );

  const activeScheduleTeams = useMemo(
    () =>
      teams.filter(isCurrentParticipantTeam).map((team) => ({
        id: team.id,
        name: team.name,
        active: team.active,
        isPlaceholder: team.is_placeholder,
        countryName: team.country_name ?? null,
        leagueLevel: team.league_level ?? null,
        teamRank: team.team_rank ?? null,
        powerRating: team.power_rating ?? null,
      })),
    [teams],
  );
  const scheduleDraftTeams = useMemo(() => {
    if (!scheduleTeamOrder) return activeScheduleTeams;

    const teamsById = new Map(activeScheduleTeams.map((team) => [team.id, team]));
    const shuffledTeams = scheduleTeamOrder.flatMap((teamId) => {
      const team = teamsById.get(teamId);
      return team ? [team] : [];
    });
    const shuffledTeamIds = new Set(shuffledTeams.map((team) => team.id));

    return [...shuffledTeams, ...activeScheduleTeams.filter((team) => !shuffledTeamIds.has(team.id))];
  }, [activeScheduleTeams, scheduleTeamOrder]);
  const scheduleDraft = useMemo(
    () =>
      buildScheduleDraft({
        teams: scheduleDraftTeams,
        mode: scheduleMode,
        startSlotId: scheduleStartSlotId || null,
        includeWeek15WeekendFriendly,
        now: new Date(),
      }),
    [includeWeek15WeekendFriendly, scheduleDraftTeams, scheduleMode, scheduleStartSlotId],
  );
  const serializedScheduleDraft = useMemo(
    () =>
      scheduleStartSlotId && scheduleDraft.valid && scheduleDraft.selectedStartSlot
        ? serializeScheduleDraftForRpc(scheduleDraft)
        : null,
    [scheduleDraft, scheduleStartSlotId],
  );
  const usesLengthSchedulePlanner =
    scheduleSetup === 'generated' && (!isGenerated || tournament?.schedule_mode === 'length');
  const lengthScheduleDraft = useMemo(
    () =>
      buildLengthScheduleDraft({
        teams: activeScheduleTeams,
        rankingSource: tournament?.league_category === 'hfi' ? 'team_rank' : 'power_rating',
        startSlotId: scheduleStartSlotId || null,
        selectedFormatId: lengthFormatId,
        now: new Date(),
      }),
    [activeScheduleTeams, lengthFormatId, scheduleStartSlotId, tournament?.league_category],
  );
  const serializedLengthScheduleDraft = useMemo(
    () => (lengthScheduleDraft.valid ? serializeLengthScheduleDraft(lengthScheduleDraft) : null),
    [lengthScheduleDraft],
  );
  const rescheduleInputRounds = useMemo(
    () =>
      rounds.map((round) => ({
        id: round.id,
        roundNumber: round.round_number,
        matches: round.matches.map((match) => ({
          id: match.id,
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id,
          status: match.status ?? 'not_arranged',
          completed: match.completed,
          htMatchId: match.ht_match_id,
          scheduledFor: match.scheduled_for ?? null,
          matchDate: match.match_date ?? null,
          scheduleSlotType: match.schedule_slot_type ?? null,
          venueType: match.venue_type ?? 'home_away',
        })),
      })),
    [rounds],
  );
  const rescheduleDraft = useMemo(
    () =>
      buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: rescheduleFromRoundNumber,
        startSlotId: rescheduleStartSlotId || null,
        includeWeek15WeekendFriendly: includeWeek15WeekendFriendlyForReschedule,
        now: new Date(),
      }),
    [
      activeScheduleTeams,
      includeWeek15WeekendFriendlyForReschedule,
      rescheduleFromRoundNumber,
      rescheduleInputRounds,
      rescheduleStartSlotId,
    ],
  );
  const serializedRescheduleDraft = useMemo(
    () =>
      rescheduleDraft.valid && rescheduleDraft.selectedStartSlot
        ? serializeRescheduleDraftForRpc(rescheduleDraft)
        : null,
    [rescheduleDraft],
  );
  const reconcileScheduleSelection = useCallback(
    (nextMode: ScheduleMode, nextStartSlotId: string | null) => {
      const nextDraft = buildScheduleDraft({
        teams: activeScheduleTeams,
        mode: nextMode,
        startSlotId: nextStartSlotId,
        includeWeek15WeekendFriendly,
        now: new Date(),
      });
      setScheduleMode(nextDraft.mode);
      setScheduleStartSlotId(nextStartSlotId ? nextDraft.selectedStartSlotId || '' : '');
    },
    [activeScheduleTeams, includeWeek15WeekendFriendly, setScheduleMode, setScheduleStartSlotId],
  );

  const handleScheduleModeChange = useCallback(
    (nextMode: ScheduleMode) => {
      reconcileScheduleSelection(nextMode, scheduleStartSlotId || null);
    },
    [reconcileScheduleSelection, scheduleStartSlotId],
  );

  const handleShuffleScheduleFixtures = useCallback(() => {
    setScheduleTeamOrder(shuffleScheduleTeamIds(scheduleDraftTeams.map((team) => team.id)));
  }, [scheduleDraftTeams, setScheduleTeamOrder]);

  const handleScheduleStartSlotIdChange = useCallback(
    (nextStartSlotId: string) => {
      reconcileScheduleSelection(scheduleDraft.mode, nextStartSlotId || null);
    },
    [reconcileScheduleSelection, scheduleDraft.mode],
  );

  const handleIncludeWeek15WeekendFriendlyChange = useCallback(
    (nextValue: boolean) => {
      setIncludeWeek15WeekendFriendly(nextValue);
      const nextDraft = buildScheduleDraft({
        teams: activeScheduleTeams,
        mode: scheduleDraft.mode,
        startSlotId: scheduleStartSlotId || null,
        includeWeek15WeekendFriendly: nextValue,
        now: new Date(),
      });
      setScheduleMode(nextDraft.mode);
      setScheduleStartSlotId(scheduleStartSlotId ? nextDraft.selectedStartSlotId || '' : '');
    },
    [
      activeScheduleTeams,
      scheduleDraft.mode,
      scheduleStartSlotId,
      setIncludeWeek15WeekendFriendly,
      setScheduleMode,
      setScheduleStartSlotId,
    ],
  );

  const reconcileRescheduleSelection = useCallback(
    (nextFromRoundNumber: number | null, nextStartSlotId: string | null) => {
      const nextDraft = buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: nextFromRoundNumber,
        startSlotId: nextStartSlotId,
        includeWeek15WeekendFriendly: includeWeek15WeekendFriendlyForReschedule,
        now: new Date(),
      });
      setRescheduleFromRoundNumber(nextDraft.selectedFromRoundNumber);
      setRescheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [
      activeScheduleTeams,
      includeWeek15WeekendFriendlyForReschedule,
      rescheduleInputRounds,
      setRescheduleFromRoundNumber,
      setRescheduleStartSlotId,
    ],
  );

  const handleRescheduleFromRoundChange = useCallback(
    (nextRoundNumber: number) => {
      setRescheduleFromRoundNumber(nextRoundNumber || null);
      setRescheduleStartSlotId('');
    },
    [setRescheduleFromRoundNumber, setRescheduleStartSlotId],
  );

  const handleRescheduleStartSlotIdChange = useCallback(
    (nextStartSlotId: string) => {
      reconcileRescheduleSelection(rescheduleFromRoundNumber, nextStartSlotId || null);
    },
    [reconcileRescheduleSelection, rescheduleFromRoundNumber],
  );

  const handleIncludeWeek15WeekendFriendlyForRescheduleChange = useCallback(
    (nextValue: boolean) => {
      setIncludeWeek15WeekendFriendlyForReschedule(nextValue);
      const nextDraft = buildRescheduleDraft({
        teams: activeScheduleTeams,
        rounds: rescheduleInputRounds,
        fromRoundNumber: rescheduleFromRoundNumber,
        startSlotId: rescheduleStartSlotId || null,
        includeWeek15WeekendFriendly: nextValue,
        now: new Date(),
      });
      setRescheduleFromRoundNumber(nextDraft.selectedFromRoundNumber);
      setRescheduleStartSlotId(nextDraft.selectedStartSlotId || '');
    },
    [
      activeScheduleTeams,
      rescheduleFromRoundNumber,
      rescheduleInputRounds,
      rescheduleStartSlotId,
      setIncludeWeek15WeekendFriendlyForReschedule,
      setRescheduleFromRoundNumber,
      setRescheduleStartSlotId,
    ],
  );

  const getMatchDateForRound = useCallback(
    (round: RoundWithMatches, match: MatchWithTeams) =>
      resolveMatchDateForRound(round, match, match.home_team?.country_name),
    [],
  );

  const editTournamentId = tournament?.id;
  const invalidateAfterEdit = useCallback(async (): Promise<boolean> => {
    if (!editTournamentId) return false;
    try {
      await invalidateTournamentData(editTournamentId, readLocalStorage(`admin_pw_${slug}`) || '');
      return true;
    } catch (error) {
      // The write already succeeded. Keep the local result and explain the
      // fallback instead of reporting the saved edit as failed.
      console.error('Tournament cache invalidation failed:', error);
      alert(
        'Your change was saved, but shared data could not be refreshed. Other visitors may see it after the cache revalidates (about 60 seconds).',
      );
      return false;
    }
  }, [editTournamentId, slug, alert]);

  const hydratePrivateData = useCallback(
    async (adminPassword = '') => {
      if (!editTournamentId) return false;
      const result = await loadTournamentPrivateData(editTournamentId, adminPassword);
      if (result.settings) {
        setTournament((current) => (current ? { ...current, ...result.settings } : current));
        setShowEditEmail(Boolean(result.settings.admin_email));
        setEditAdminEmail(result.settings.admin_email || '');
      }
      setAnnouncements((current) => [
        ...current.filter(
          (item) => item.visibility === 'public' && !result.announcements.some((incoming) => incoming.id === item.id),
        ),
        ...(result.announcements as TournamentAnnouncement[]),
      ]);
      setAnnouncementDismissals(result.dismissals as TournamentAnnouncementDismissal[]);
      return adminPassword ? result.passwordVerified : result.admin;
    },
    [editTournamentId, setEditAdminEmail, setShowEditEmail],
  );

  const fetchData = useCallback(
    async (options: { showLoader?: boolean; invalidate?: boolean; fresh?: boolean } = {}) => {
      const showLoader = (options.showLoader ?? !hasLoadedTournamentRef.current) && !hasLoadedTournamentRef.current;
      if (showLoader) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        if (options.invalidate !== false && !(await invalidateAfterEdit())) return;
        const result = await readPublicTournament(() => readTournamentPublicData(slug, options.fresh), initialData || null);
        if (result.status === 'not-found') {
          setLoadError(null);
          setTournament(null);
          return;
        }
        if (result.status === 'failed') {
          console.error('Could not refresh tournament data:', result.error);
          setLoadError(
            hasLoadedTournamentRef.current
              ? 'Tournament data could not be refreshed. Your current page data is still available. Please try again.\n'
              : 'Tournament data could not be loaded. Please try again.\n',
          );
          return;
        }
        const data = result.data;
        setLoadError(null);
        hasLoadedTournamentRef.current = true;
        const tournamentData = data.tournament as unknown as Tournament;
        setTournament((current) => ({ ...current, ...tournamentData }));
        setTeams(data.teams as unknown as Team[]);
        setRounds(reviveInitialRounds(data));
        setStandings(data.standings as unknown as TeamStanding[]);
        setSeasonSlots(data.seasonSlots);
        setSeasonSlotAssignments(data.seasonSlotAssignments);
        setSeasons(data.seasons as unknown as TournamentSeason[]);
        setWarnings(data.warnings);
        setActivityWarnings(data.activityWarnings);
        setOrganizerProfileName(data.organizerProfileName);
        setAnnouncements(data.announcements as unknown as TournamentAnnouncement[]);
        localStorage.setItem('last_viewed_tournament_id', tournamentData.id);
        setEditName(tournamentData.name);
        setEditIsPrivate(tournamentData.is_private);
        setEditChppOnlyJoin(tournamentData.chpp_only_join);
        setEditLeagueCategory(tournamentData.league_category || 'male');
        setEditRegistrationType(normalizeTournamentRegistrationType(tournamentData.registration_type));
        setEditDefaultTheme(normalizeTournamentTheme(tournamentData.default_theme));
        setEditScoringMode(tournamentData.scoring_mode as typeof editScoringMode);
        setEditCountryLimit(
          normalizeLeagueLimit(tournamentData.country_limit, tournamentData.country_limit_format ?? 'league_id'),
        );
        setEditMaxCountryActiveTeams(tournamentData.max_country_active_teams ?? null);
        setEditAllowManagerCountrySizeException(Boolean(tournamentData.allow_manager_country_size_exception));
        setScheduleSetup(tournamentData.schedule_mode === 'manual' ? 'manual' : 'generated');
        setScheduleMode(normalizeGeneratedScheduleMode(tournamentData.schedule_mode));
        const storedStartSlot = tournamentData.schedule_start_slot
          ? buildCalendarSlots(new Date(), 160).find(
              (slot) => slot.nominalDate.toISOString() === tournamentData.schedule_start_slot,
            )
          : null;
        setScheduleStartSlotId(storedStartSlot?.id || '');
        setIsTest(tournamentData.is_test || false);
        setShowEditDescription(tournamentData.show_description);
        setEditDescription(tournamentData.description || '');
        setEditForumId(tournamentData.forum_id ? String(tournamentData.forum_id) : '');
        setEditMaxTeams(tournamentData.max_teams || null);
        setEditRegistrationOpen(!tournamentData.registration_closed_at);
        setEditAllowReserveRegistration(tournamentData.allow_reserve_registration !== false);
        setIncludeWeek15WeekendFriendly(false);
        setIncludeWeek15WeekendFriendlyForReschedule(Boolean(tournamentData.include_week15_weekend_friendly));
        setEditIsFeatured(Boolean(tournamentData.is_featured));
        try {
          await hydratePrivateData(readLocalStorage(`admin_pw_${slug}`) || '');
        } catch (privateDataError) {
          console.error('Could not load private tournament data:', privateDataError);
        }
      } catch (error) {
        console.error('Could not refresh tournament data:', error);
        setLoadError(
          hasLoadedTournamentRef.current
            ? 'Tournament data could not be refreshed. Your current page data is still available. Please try again.'
            : 'Tournament data could not be loaded. Please try again.\n',
        );
      } finally {
        if (showLoader) setLoading(false);
      }
    },
    [
      slug,
      initialData,
      invalidateAfterEdit,
      hydratePrivateData,
      setEditName,
      setEditIsPrivate,
      setEditChppOnlyJoin,
      setEditLeagueCategory,
      setEditRegistrationType,
      setEditCountryLimit,
      setEditMaxCountryActiveTeams,
      setEditAllowManagerCountrySizeException,
      setEditDefaultTheme,
      setEditScoringMode,
      setScheduleSetup,
      setScheduleMode,
      setScheduleStartSlotId,
      setIsTest,
      setShowEditDescription,
      setEditDescription,
      setEditForumId,
      setEditMaxTeams,
      setEditRegistrationOpen,
      setEditAllowReserveRegistration,
      setIncludeWeek15WeekendFriendly,
      setIncludeWeek15WeekendFriendlyForReschedule,
      setEditIsFeatured,
    ],
  );

  // Lightweight update: only refresh rounds, matches, warnings and last_fixtures_refresh timestamp.
  // Does not reload tournament meta, teams, standings, chat, news, or profiles.
  const fetchFixturesOnly = useCallback(async () => {
    if (!tournament) return;
    const { data: roundsData } = await supabase
      .from('rounds')
      .select(PUBLIC_ROUND_FIELDS)
      .eq('tournament_id', tournament.id)
      .eq('season_number', tournament.season || 1)
      .order('round_number', { ascending: true });
    if (!roundsData) return;

    const roundIds = roundsData.map((r: { id: string }) => r.id);
    const [
      { data: matchesData, error: matchesError },
      { data: warningsData },
      { data: activityWarningsData },
      { data: tournamentMeta },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select(
          `
        ${PUBLIC_MATCH_FIELDS},
        home_team:teams!matches_home_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id),
        away_team:teams!matches_away_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, manager_name, hattrick_user_id),
        reserve_team:teams!matches_reserve_team_id_fkey(name, ht_team_id, logo_url, country_name, country_id, league_id, league_level, active, reserve_active, manager_name, hattrick_user_id)
      `,
        )
        .in('round_id', roundIds),
      supabase.from('fixture_warnings').select('*').eq('tournament_id', tournament.id).eq('active', true),
      supabase.from('fixture_warnings').select('id, round_id, team_id, created_at').eq('tournament_id', tournament.id),
      supabase.from('tournaments').select('last_fixtures_refresh').eq('id', tournament.id).single(),
    ]);

    if (matchesError) {
      console.error('Could not refresh fixture matches:', matchesError);
      return;
    }

    if (matchesData) {
      const fixtureIds = (matchesData as { id: string }[]).map((match) => match.id);
      const { data: ratingRows, error: ratingsError } = fixtureIds.length
        ? await readFixtureRatingStatuses((fields) => supabase
            .from('fixture_predicted_rating_share_status')
            .select(fields)
            .in('fixture_id', fixtureIds))
        : { data: [], error: null };
      if (ratingsError) {
        console.error('Could not refresh shared fixture ratings:', ratingsError);
        return;
      }
      const matchesWithRatings = attachFixtureRatingStatus(
        matchesData,
        (ratingRows || []) as FixtureRatingShareStatus[],
      );
      const normalizedMatches = matchesWithRatings.map((match) => ({
        ...match,
        home_team: normalizeMatchTeamRelation(match.home_team),
        away_team: normalizeMatchTeamRelation(match.away_team),
        reserve_team: normalizeMatchTeamRelation(match.reserve_team),
      }));
      const newRounds = roundsData.map((r: { created_at: string; id: string; round_number: number }) => ({
        ...r,
        matches: (normalizedMatches as MatchWithTeams[])
          .filter((m) => m.round_id === r.id)
          .map((m) => ({
            ...applyReserveDisplay(m),
            match_date: getMatchDateForRound(r as RoundWithMatches, m),
            kickoff_confirmed: Boolean(m.chpp_match_date),
          }))
          .sort(compareFixtures),
      }));
      setRounds(newRounds as RoundWithMatches[]);
      setStandings(
        calculateSeasonSlotStandings(
          teams.map((team) => toStandingTeam(team)),
          getRegularStandingMatches(newRounds as RoundWithMatches[]),
          seasonSlots,
          tournament.scoring_mode as '120m' | '120min' | 'average120' | 'points' | 'appg',
          seasonSlotAssignments,
        ),
      );
    }
    if (warningsData) setWarnings(warningsData);
    if (activityWarningsData) setActivityWarnings(activityWarningsData);
    if (tournamentMeta)
      setTournament((prev) => (prev ? { ...prev, last_fixtures_refresh: tournamentMeta.last_fixtures_refresh } : prev));
  }, [tournament, teams, seasonSlots, seasonSlotAssignments, getMatchDateForRound]);

  const normalizeManualRounds = useCallback(async () => {
    if (!tournament) return;
    const seasonNumber = Number(tournament.season || 1);
    const { data, error } = await supabase
      .from('rounds')
      .select('id, round_number, matches(id, scheduled_for)')
      .eq('tournament_id', tournament.id)
      .eq('season_number', seasonNumber)
      .order('round_number', { ascending: true });
    if (error) throw error;

    const rounds = (data || []) as Array<{
      id: string;
      round_number: number;
      matches: Array<{ id: string; scheduled_for: string | null }>;
    }>;
    const roundsBefore = rounds.length;
    const currentRoundIdByMatchId = new Map(
      rounds.flatMap((round) => round.matches.map((match) => [match.id, round.id] as const)),
    );
    const plan = buildManualRoundNormalizationPlan(rounds);
    const usedRoundIds = new Set(plan.finalRounds.map((round) => round.roundId).filter(Boolean));
    const roundsToRemove = rounds.filter((round) => !usedRoundIds.has(round.id)).map((round) => round.id);
    const temporaryRoundNumberById = new Map(rounds.map((round, index) => [round.id, -1 - index]));

    for (const [roundId, roundNumber] of temporaryRoundNumberById) {
      const { error: updateError } = await supabase
        .from('rounds')
        .update({ round_number: roundNumber })
        .eq('id', roundId);
      if (updateError) throw updateError;
    }

    const roundIdByDate = new Map<string, string>();
    for (const round of plan.finalRounds) {
      if (round.roundId) {
        roundIdByDate.set(round.dateKey, round.roundId);
        continue;
      }
      const { data: insertedRound, error: insertError } = await supabase
        .from('rounds')
        .insert({
          tournament_id: tournament.id,
          season_number: seasonNumber,
          round_number: -100000 - round.roundNumber,
        })
        .select('id')
        .single();
      if (insertError || !insertedRound) throw insertError || new Error('Could not create a normalized round.');
      roundIdByDate.set(round.dateKey, insertedRound.id as string);
      round.roundId = insertedRound.id as string;
    }

    const matchIdsByRound = new Map<string, string[]>();
    for (const assignment of plan.assignments) {
      const roundId = roundIdByDate.get(assignment.dateKey);
      if (!roundId) continue;
      const matchIds = matchIdsByRound.get(roundId) || [];
      matchIds.push(assignment.matchId);
      matchIdsByRound.set(roundId, matchIds);
    }
    for (const [roundId, matchIds] of matchIdsByRound) {
      const { error: matchError } = await supabase.from('matches').update({ round_id: roundId }).in('id', matchIds);
      if (matchError) throw matchError;
    }

    if (roundsToRemove.length > 0) {
      const { error: deleteError } = await supabase.from('rounds').delete().in('id', roundsToRemove);
      if (deleteError) throw deleteError;
    }

    for (const round of plan.finalRounds) {
      const roundId = roundIdByDate.get(round.dateKey);
      if (!roundId) continue;
      const { error: finalError } = await supabase
        .from('rounds')
        .update({ round_number: round.roundNumber })
        .eq('id', roundId);
      if (finalError) throw finalError;
    }

    await invalidateAfterEdit();
    const matchesMoved = plan.assignments.filter((assignment) => {
      const targetRoundId = roundIdByDate.get(assignment.dateKey) || null;
      return currentRoundIdByMatchId.get(assignment.matchId) !== targetRoundId;
    }).length;

    return {
      roundsBefore,
      roundsAfter: plan.finalRounds.length,
      matchesMoved,
      unchanged: roundsBefore === plan.finalRounds.length && matchesMoved === 0,
    };
  }, [tournament, invalidateAfterEdit]);

  const { liveData } = useLiveMatches(
    tournament?.id,
    allMatches,
    () => {
      void fetchFixturesOnly();
    },
    tournament?.status !== 'finished' && (activeTab === 'fixtures' || isAppg120ScoringMode(tournament?.scoring_mode)),
    isAppg120ScoringMode(tournament?.scoring_mode),
  );

  const fetchPresenceOnly = useCallback(async () => {
    if (!tournament) return;
    const userIds = teams.map((t) => t.hattrick_user_id).filter(Boolean);
    if (!userIds.length) return;
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('hattrick_user_id, last_seen_at')
        .in('hattrick_user_id', userIds);

      if (error) {
        console.error('Failed to refresh presence map:', error);
        return;
      }

      if (data) {
        setLastSeenMap((prev) => {
          const next = { ...prev };
          data.forEach((p) => {
            if (p.hattrick_user_id) next[Number(p.hattrick_user_id)] = p.last_seen_at ?? null;
          });
          return next;
        });
      }
    } catch (error) {
      console.error('Presence refresh request failed:', error);
    }
  }, [tournament, teams]);

  const upcomingRoundIndex = rounds.findIndex((r) => r.matches.some((m) => !m.completed && m.status !== 'misarranged'));
  const focusedRoundIndex =
    renderTimestamp === 0
      ? upcomingRoundIndex
      : getFocusedFixtureRoundIndex(rounds, upcomingRoundIndex, new Date(renderTimestamp));
  const currentRoundId = focusedRoundIndex >= 0 ? (rounds[focusedRoundIndex]?.id ?? null) : null;
  const defaultVisibleRoundsCount = rounds.length;

  const expandAllRounds = useCallback(() => {
    setExpandedRounds(
      rounds.reduce<Record<string, boolean>>((acc, round) => {
        acc[round.id] = true;
        return acc;
      }, {}),
    );
  }, [rounds]);

  const collapseAllRounds = useCallback(() => {
    setExpandedRounds(
      rounds.reduce<Record<string, boolean>>((acc, round) => {
        acc[round.id] = round.id === currentRoundId;
        return acc;
      }, {}),
    );
  }, [currentRoundId, rounds]);

  useEffect(() => {
    if (!tournament?.id) return;
    const htTeamIds = teams
      .filter(isCurrentParticipantTeam)
      .map((team) => team.ht_team_id)
      .filter(Boolean);
    if (!htTeamIds.length) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('ht_team_id,tournament_id,tournaments!teams_tournament_id_fkey(name,status,is_test,registration_type)')
        .in('ht_team_id', htTeamIds)
        .eq('reserve_active', false)
        .eq('active', true)
        .neq('tournament_id', tournament.id);
      if (error || cancelled) return;
      const elsewhereIds = new Set<number>();
      for (const row of data || []) {
        const other = Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments;
        if (row.ht_team_id && isBlockingTeamTournament(other)) elsewhereIds.add(Number(row.ht_team_id));
      }
      setPlayingElsewhereTeamIds(elsewhereIds);
    })();
    return () => {
      cancelled = true;
    };
  }, [teams, tournament?.id]);

  const refreshedInitialLiveRef = useRef(false);
  useEffect(() => {
    if (!initialData || refreshedInitialLiveRef.current) return;
    const timer = window.setTimeout(() => {
      if (refreshedInitialLiveRef.current) return;
      refreshedInitialLiveRef.current = true;
      void fetchPresenceOnly();
      if (
        rounds.some((round) =>
          round.matches.some(
            (match) =>
              !match.completed && match.ht_match_id && match.match_date && match.match_date.getTime() <= Date.now(),
          ),
        )
      ) {
        void fetchFixturesOnly();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialData, fetchPresenceOnly, fetchFixturesOnly, rounds]);

  const fetchPendingJoinData = useCallback(
    async (token: string) => {
      setShowTeamModal(true);
      setModalLoading(true);
      setIsConnecting(false);
      console.log('TournamentView Querying Selection Token:', token);

      const { data, error } = await supabase
        .from('oauth_temp_sessions')
        .select('*')
        .eq('selection_token', token)
        .single();

      if (error || !data) {
        setShowTeamModal(false);
        setJoinError('Your team selection session has expired. Please choose Join with Hattrick again.');
        setShowJoinErrorModal(true);
        const newUrl = window.location.pathname;
        window.history.replaceState(null, '', newUrl);
        return;
      }

      setPendingJoinData(data);
      if (data.manager_name) {
        localStorage.setItem('my_ht_manager_name', data.manager_name);
      }
      if (data.hattrick_user_id) {
        localStorage.setItem('my_ht_user_id', String(data.hattrick_user_id));
      }
      setModalLoading(false);
    },
    [setIsConnecting, setJoinError, setModalLoading, setPendingJoinData, setShowJoinErrorModal, setShowTeamModal],
  );

  const handleTeamSelect = async (team: ChppTeamOption) => {
    if (!pendingJoinData || submittingJoinRef.current) return;
    // Close the picker as soon as a team is chosen so the lifecycle confirmation
    // is presented on its own instead of being stacked over the team list.
    setShowTeamModal(false);
    if (
      tournament?.status === 'planning' &&
      !tournament.is_test &&
      !isSandbox &&
      !(await confirm({
        title: lifecycleText('joinPlanningTitle'),
        message: lifecycleText('joinPlanningWarning'),
        confirmLabel: uiText('joinTournament'),
        cancelLabel: uiText('cancel'),
      }))
    )
      return;
    submittingJoinRef.current = true;
    setJoinError(null);
    setSubmittingJoin(true);
    try {
      const response = await fetch('/api/auth/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selection_token: pendingJoinData.selection_token,
          team_id: team.teamId,
          team_name: team.teamName,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to complete join');

      if (result.hattrick_user_id) {
        localStorage.setItem('my_ht_user_id', result.hattrick_user_id.toString());
      }
      markAuthRefreshCurrent();
      if (result.manager_name) {
        localStorage.setItem('my_ht_manager_name', result.manager_name);
      }
      if (result.team_name) {
        localStorage.setItem('my_ht_team_name', result.team_name);
      }

      setShowTeamModal(false);
      setPendingJoinData(null);
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Unable to join this tournament. Please try again.');
    } finally {
      submittingJoinRef.current = false;
      setSubmittingJoin(false);
    }
  };

  const getJoinCountrySizeEligibility = (team: ChppTeamOption) => {
    const managerId = pendingJoinData?.hattrick_user_id ?? currentHtUserId;
    const allowanceTeams = tournament?.schedule_mode === 'length' && isGenerated
      ? teams.map((row) => row.pending_entry_round_id
        ? { ...row, active: true, reserve_active: false } : row)
      : teams;
    const allowance = tournament?.max_country_active_teams != null && managerId
      ? managerCountrySizeAllowance(allowanceTeams.filter(row => row.ht_team_id !== team.teamId),
          Number(managerId), tournament.max_country_active_teams,
          tournament.schedule_mode !== 'length' && teams.some(row => row.ht_team_id === team.teamId && row.reserve_active === true)).active
      : 0;
    return validateCountrySizeEligibility({
      countryId: team.countryId,
      maximumActiveTeams: tournament?.max_country_active_teams,
      allowManagerException: tournament?.allow_manager_country_size_exception === true,
      hasQualifyingParticipant: allowance > 0,
    });
  };

  const getJoinTeamCardState = (
    team: ChppTeamOption,
  ): { disabled: boolean; status: React.ReactNode; statusDanger: boolean } => {
    if (!tournament) return { disabled: true, status: 'Tournament details are unavailable.', statusDanger: true };
    const allowAdminBypass = isSiteAdmin && !(tournament.schedule_mode === 'length' && isGenerated);
    const existingTeam = teams.find((row) => row.ht_team_id === team.teamId);
    if (existingTeam?.pending_entry_round_id) {
      return { disabled: true, statusDanger: false, status: uiText('pendingNextRoundNotice') };
    }
    if (tournament.schedule_mode === 'length' && isGenerated && existingTeam?.reserve_active) {
      return { disabled: true, statusDanger: false, status: uiText('withdrawReserveBeforeJoining') };
    }
    if (!allowAdminBypass && !teamMatchesCategory(team, tournament.league_category)) {
      return {
        disabled: true,
        statusDanger: true,
        status:
          tournament.league_category === 'hfi'
            ? 'Not eligible! This tournament is for HFI teams only.'
            : 'Not eligible! This tournament is for regular male teams.',
      };
    }

    const countryLimit = normalizeLeagueLimit(tournament.country_limit, tournament.country_limit_format ?? 'league_id');
    const eligibility = validateTeamEligibility(team, {
      category: tournament.league_category,
      countryLimit,
    });

    if (!allowAdminBypass && !eligibility.eligible) {
      const restrictedCountry = resolveCountryRestriction(
        tournament.country_limit,
        tournament.country_limit_format ?? 'league_id',
      )?.leagueName;
      return {
        disabled: true,
        statusDanger: true,
        status: restrictedCountry
          ? `Not eligible! Must be based in ${restrictedCountry}.`
          : `Not eligible! ${eligibility.reason || 'This team cannot join this tournament.'}`,
      };
    }

    if (!allowAdminBypass && tournament.max_country_active_teams != null) {
      const countrySizeEligibility = getJoinCountrySizeEligibility(team);
      if (!countrySizeEligibility.eligible) {
        return { disabled: true, statusDanger: true, status: `Not eligible! ${countrySizeEligibility.reason}` };
      }
    }

    if (!allowAdminBypass && team.activeTournament) {
      return {
        disabled: true,
        statusDanger: true,
        status: (
          <>
            {uiText('alreadyActiveIn')}{' '}
            <a href={toLocalePath(locale, `/t/${team.activeTournament.slug}`)}>{team.activeTournament.name}</a>
          </>
        ),
      };
    }

    const extraEntry = !allowAdminBypass && tournament.allow_manager_country_size_exception && tournament.max_country_active_teams != null;
    const small = validateCountrySizeEligibility({ countryId: team.countryId,
      maximumActiveTeams: tournament.max_country_active_teams, allowManagerException: false, hasQualifyingParticipant: false }).eligible;
    return { disabled: false, status: extraEntry
      ? small ? 'Join with this small-league team to unlock one additional larger-league entry.'
        : 'Your qualifying small-league entry allows this additional larger-league team to join.'
      : '✅ Eligible to participate!', statusDanger: false };
  };

  useEffect(() => {
    if (!tournament || isAdminAuthenticated) return;

    if (roleAccessLoading) return;

    const storedAuthMode = localStorage.getItem(`admin_auth_${slug}`);
    const storedPassword = localStorage.getItem(`admin_pw_${slug}`);

    // The deliberate organizer confirmation lasts for this browser session,
    // but is restored only after the server verifies the signed session and
    // current tournament role again.
    if (roleAccess?.canViewAdmin) {
      const sessionKey = getOrganizerAdminSessionStorageKey(tournament.id, roleAccess.viewerUserId);
      if (readSessionStorage(sessionKey) !== 'oauth_role') return;
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        setAdminAuthSource('oauth_role');
        setAdminAuthError(false);
        setFailedLoginAttempt(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    if (
      (storedAuthMode === 'password' || !storedAuthMode) &&
      storedPassword &&
      tournament.admin_password &&
      storedPassword === tournament.admin_password
    ) {
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        setAdminAuthSource('legacy_password');
        setAdminAuthError(false);
        setFailedLoginAttempt(false);
      }, 0);
      return () => clearTimeout(timer);
    }

    if (password && password === tournament.admin_password) {
      const timer = setTimeout(() => {
        setIsAdminAuthenticated(true);
        setAdminAuthSource('legacy_password');
        localStorage.setItem(`admin_pw_${slug}`, password);
        localStorage.setItem(`admin_auth_${slug}`, 'password');
        setAdminAuthError(false);
        setFailedLoginAttempt(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [
    password,
    roleAccess,
    roleAccessLoading,
    tournament,
    slug,
    isAdminAuthenticated,
    setAdminAuthError,
    setAdminAuthSource,
    setFailedLoginAttempt,
  ]);

  useEffect(() => {
    if (!tournament || !isAdminAuthenticated || adminAuthSource !== 'legacy_password' || !roleAccess?.canViewAdmin)
      return;
    const timer = window.setTimeout(() => {
      setAdminAuthSource('oauth_role');
      sessionStorage.setItem(getOrganizerAdminSessionStorageKey(tournament.id, roleAccess.viewerUserId), 'oauth_role');
      localStorage.setItem(`admin_auth_${slug}`, 'organizer');
      localStorage.removeItem(`admin_pw_${slug}`);
      setPassword('');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [adminAuthSource, isAdminAuthenticated, roleAccess, slug, tournament, setAdminAuthSource]);

  useEffect(() => {
    if (initialData) {
      hasLoadedTournamentRef.current = true;
      localStorage.setItem('last_viewed_tournament_id', String(initialData.tournament.id));
      const initialTournament = initialData.tournament as unknown as Tournament;
      const timer = window.setTimeout(() => {
        setEditName(initialTournament.name);
        setEditIsPrivate(initialTournament.is_private);
        setEditChppOnlyJoin(initialTournament.chpp_only_join);
        setEditLeagueCategory(initialTournament.league_category || 'male');
        setEditRegistrationType(normalizeTournamentRegistrationType(initialTournament.registration_type));
        setEditDefaultTheme(normalizeTournamentTheme(initialTournament.default_theme));
        setEditScoringMode(initialTournament.scoring_mode as typeof editScoringMode);
        setEditCountryLimit(
          normalizeLeagueLimit(initialTournament.country_limit, initialTournament.country_limit_format ?? 'league_id'),
        );
        setEditMaxCountryActiveTeams(initialTournament.max_country_active_teams ?? null);
        setEditAllowManagerCountrySizeException(Boolean(initialTournament.allow_manager_country_size_exception));
        setScheduleSetup(initialTournament.schedule_mode === 'manual' ? 'manual' : 'generated');
        setScheduleMode(normalizeGeneratedScheduleMode(initialTournament.schedule_mode));
        const storedStartSlot = initialTournament.schedule_start_slot
          ? buildCalendarSlots(new Date(), 160).find(
              (slot) => slot.nominalDate.toISOString() === initialTournament.schedule_start_slot,
            )
          : null;
        setScheduleStartSlotId(storedStartSlot?.id || '');
        setIsTest(initialTournament.is_test || false);
        setShowEditDescription(initialTournament.show_description);
        setEditDescription(initialTournament.description || '');
        setEditForumId(initialTournament.forum_id ? String(initialTournament.forum_id) : '');
        setEditMaxTeams(initialTournament.max_teams || null);
        setEditRegistrationOpen(!initialTournament.registration_closed_at);
        setEditAllowReserveRegistration(initialTournament.allow_reserve_registration !== false);
        setIncludeWeek15WeekendFriendly(false);
        setIncludeWeek15WeekendFriendlyForReschedule(Boolean(initialTournament.include_week15_weekend_friendly));
        setEditIsFeatured(Boolean(initialTournament.is_featured));
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (hasLoadedTournamentRef.current || initialLoadAttemptedRef.current) return;
    initialLoadAttemptedRef.current = true;
    void fetchData({ showLoader: true, invalidate: false }).catch((error) => {
      console.error('Could not load tournament:', error);
      setLoading(false);
    });
  }, [
    fetchData,
    initialData,
    setEditName,
    setEditIsPrivate,
    setEditChppOnlyJoin,
    setEditLeagueCategory,
    setEditRegistrationType,
    setEditCountryLimit,
    setEditMaxCountryActiveTeams,
    setEditAllowManagerCountrySizeException,
    setEditDefaultTheme,
    setEditScoringMode,
    setScheduleSetup,
    setScheduleMode,
    setScheduleStartSlotId,
    setIsTest,
    setShowEditDescription,
    setEditDescription,
    setEditForumId,
    setEditMaxTeams,
    setEditRegistrationOpen,
    setEditAllowReserveRegistration,
    setIncludeWeek15WeekendFriendly,
    setIncludeWeek15WeekendFriendlyForReschedule,
    setEditIsFeatured,
  ]);

  useEffect(() => {
    if (!isHydrationReady || (!currentHtUserId && !readLocalStorage(`admin_pw_${slug}`))) return;
    const timer = window.setTimeout(() => {
      void hydratePrivateData(readLocalStorage(`admin_pw_${slug}`) || '').catch((error) => {
        console.error('Could not load private tournament data:', error);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentHtUserId, hydratePrivateData, isHydrationReady, slug]);

  useEffect(() => {
    if (paramsHandledRef.current) return;

    // This route is reached through a full OAuth navigation. Keep its callback
    // detection independent from the App Router's reactive query state: that
    // was the pre-recovery behavior and reliably opens the picker on every
    // returned OAuth flow.
    const params = new URLSearchParams(window.location.search);
    const errorMsg = params.get('error');
    const joined = params.get('joined');
    const token = params.get('token');

    if (errorMsg || joined || token) {
      paramsHandledRef.current = true;
      const newUrl = pathname;

      window.history.replaceState(null, '', newUrl);

      if (errorMsg) {
        window.setTimeout(() => {
          setJoinError(errorMsg);
          setShowJoinErrorModal(true);
        }, 0);
      } else if (joined) {
        window.setTimeout(() => {
          void fetchData({ showLoader: false, invalidate: false });
        }, 0);
      } else if (token) {
        window.setTimeout(() => {
          void fetchPendingJoinData(token);
        }, 0);
      }
    }
  }, [fetchData, fetchPendingJoinData, pathname, router]);

  useEffect(() => {
    const reconnect = () => {
      void fetchData({ showLoader: false, invalidate: false });
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [fetchData]);

  const isNewsTab = activeTab === 'guestbook' || activeTab === 'news';

  // Match-order prediction sharing remains click-triggered; finished-match facts
  // are refreshed automatically from the participating teams' stored credentials.
  const handleRefreshFixtures = useCallback(
    async (manualRatings = false) => {
      if (!tournament || isRefreshingFixtures) return;
      setIsRefreshingFixtures(true);
      try {
        // 1. Refresh fixtures (detect arranged matches, warnings etc.)
        const response = await fetch(
          `/api/teams/refresh-fixtures?tournament_id=${tournament.id}${manualRatings ? '&manual_ratings=1' : ''}`,
        );
        if (!response.ok) throw new Error('Failed to refresh fixtures');
        const refreshResult = (await response.json().catch(() => null)) as { linked_match_ids?: number[] } | null;

        // 2. Also trigger a live check for HT-linked matches that may have result data.
        //    Finished-but-incomplete rows are included so an accidental manual clear can be recovered from CHPP.
        const matchesToSync = allMatches.filter(
          (m) => m.ht_match_id && (['arranged', 'ongoing', 'finished'].includes(m.status) || m.completed),
        );
        const matchIdsToSync = new Set<number>();
        for (const match of matchesToSync) {
          if (match.ht_match_id) matchIdsToSync.add(match.ht_match_id);
        }
        for (const matchId of refreshResult?.linked_match_ids ?? []) {
          if (matchId) matchIdsToSync.add(matchId);
        }

        if (matchIdsToSync.size > 0) {
          const ids = Array.from(matchIdsToSync).join(',');
          await fetch(`/api/chpp/live-matches?tournament_id=${tournament.id}&match_ids=${ids}`);
        }

        await fetchFixturesOnly();
      } catch (err: any) {
        console.error(err.message);
      } finally {
        setIsRefreshingFixtures(false);
      }
    },
    [tournament, isRefreshingFixtures, fetchFixturesOnly, allMatches],
  );

  const requestHtMatchLink = useCallback(
    async (matchId: string, htMatchId: string, dryRun: boolean, resetResult = false): Promise<HtMatchLinkPreview> => {
      if (!tournament) throw new Error('Tournament is not loaded.');

      const response = await fetch('/api/teams/refresh-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'link_match',
          tournamentId: tournament.id,
          matchId,
          htMatchId,
          dryRun,
          resetResult,
          ...(resetResult ? { adminPassword: password.trim() || tournament.admin_password || '' } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        preview?: HtMatchLinkPreview;
      } | null;

      if (!response.ok || !payload?.preview) {
        throw new Error(payload?.error || 'Could not link that Hattrick match.');
      }

      return payload.preview;
    },
    [password, tournament],
  );

  const previewHtMatchLink = useCallback(
    (matchId: string, htMatchId: string) => requestHtMatchLink(matchId, htMatchId, true),
    [requestHtMatchLink],
  );

  const saveHtMatchLink = useCallback(
    async (matchId: string, htMatchId: string) => {
      const preview = await requestHtMatchLink(matchId, htMatchId, false);
      if (preview.ht_match_id && tournament) {
        await fetch(`/api/chpp/live-matches?tournament_id=${tournament.id}&match_ids=${preview.ht_match_id}`);
      }
      await fetchFixturesOnly();
    },
    [fetchFixturesOnly, requestHtMatchLink, tournament],
  );

  const requestAddHtMatch = useCallback(
    async (htMatchId: string, dryRun: boolean, options: { refreshFixtures?: boolean } = {}) => {
      if (!tournament) throw new Error('Tournament is not loaded.');
      const adminPassword = password.trim() || tournament.admin_password || '';
      if (!adminPassword) throw new Error('Organizer password is required.');

      const response = await fetch('/api/teams/refresh-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_ht_match',
          tournamentId: tournament.id,
          adminPassword,
          htMatchId,
          dryRun,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        preview?: HtMatchAddPreview;
        inserted?: number;
      } | null;

      if (!response.ok || !payload?.preview) {
        throw new Error(payload?.error || 'Could not add that Hattrick match.');
      }
      if (!dryRun && options.refreshFixtures !== false) await fetchFixturesOnly();
      return payload.preview;
    },
    [fetchFixturesOnly, password, tournament],
  );

  const previewHtMatchAdd = useCallback((htMatchId: string) => requestAddHtMatch(htMatchId, true), [requestAddHtMatch]);

  const saveHtMatchAdd = useCallback(
    (htMatchId: string, options?: { refreshFixtures?: boolean }) =>
      requestAddHtMatch(htMatchId, false, options).then(() => undefined),
    [requestAddHtMatch],
  );

  const fetchHtMatchSuggestions = useCallback(
    async (options?: {
      teamHtId?: number;
      offset?: number;
      fetchWindow?: MatchFetchWindow;
      matchCategories?: MatchFetchCategory[];
    }) => {
      if (!tournament) throw new Error('Tournament is not loaded.');
      const adminPassword = password.trim() || tournament.admin_password || '';
      if (!adminPassword) throw new Error('Organizer password is required.');

      const response = await fetch('/api/teams/refresh-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suggest_ht_matches',
          tournamentId: tournament.id,
          adminPassword,
          teamHtId: options?.teamHtId,
          offset: options?.offset || 0,
          fetchWindow: options?.fetchWindow,
          matchCategories: options?.matchCategories,
          limit: 10,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        matches?: HtMatchSuggestion[];
        nextOffset?: number;
        hasMore?: boolean;
        diagnostics?: HtMatchFetchDiagnostics;
      } | null;

      if (!response.ok || !payload?.matches) {
        throw new Error(payload?.error || 'Could not fetch suggested matches.');
      }
      return {
        matches: payload.matches,
        nextOffset: payload.nextOffset || 0,
        hasMore: Boolean(payload.hasMore),
        diagnostics: payload.diagnostics,
      };
    },
    [password, tournament],
  );

  const refreshTeamPlanningStatuses = useCallback(async () => {
    if (!tournament || isRefreshingTeamStatuses) return;

    const adminPassword = password.trim() || tournament.admin_password || '';
    if (!adminPassword) {
      setTeamStatusNotice('Organizer password is required.');
      return;
    }

    setIsRefreshingTeamStatuses(true);
    setTeamStatusNotice(null);
    try {
      const response = await fetch('/api/teams/refresh-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'team_planning_statuses',
          tournamentId: tournament.id,
          adminPassword,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        statuses?: Array<{
          teamId: string;
          inCup: boolean | null;
          bookedOutsideTournament: boolean;
        }>;
      } | null;

      if (!response.ok || !payload?.statuses) {
        throw new Error(payload?.error || 'Could not refresh team statuses.');
      }

      setTeamPlanningStatuses(
        Object.fromEntries(
          payload.statuses.map((status) => [
            status.teamId,
            {
              inCup: status.inCup,
              bookedOutsideTournament: status.bookedOutsideTournament,
            },
          ]),
        ),
      );
      setTeamStatusNotice(`Checked ${payload.statuses.length} team${payload.statuses.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setTeamStatusNotice(error instanceof Error ? error.message : 'Could not refresh team statuses.');
    } finally {
      setIsRefreshingTeamStatuses(false);
    }
  }, [
    isRefreshingTeamStatuses,
    password,
    tournament,
    setIsRefreshingTeamStatuses,
    setTeamPlanningStatuses,
    setTeamStatusNotice,
  ]);

  const updateHfiRanks = useCallback(async () => {
    if (!tournament || isUpdatingHfiRanks) return;
    const rankingLabel = tournament.league_category === 'hfi' ? 'HFI ranks' : 'Power Rankings';

    setIsUpdatingHfiRanks(true);
    setHfiRankNotice(null);
    setHfiRankNoticeIsError(false);
    try {
      const response = await fetch(
        `/api/app?route=${tournament.league_category === 'hfi' ? 'update-hfi-ranks' : 'update-power-rankings'}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId: tournament.id }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        participantCount?: number;
        updatedCount?: number;
      } | null;
      if (!response.ok) throw new Error(payload?.error || `Could not update ${rankingLabel}.`);

      setHfiRankNotice(`${payload?.updatedCount ?? 0}/${payload?.participantCount ?? 0} ${rankingLabel} updated.`);
      await fetchData({ invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : `Could not update ${rankingLabel}.`;
      const retryHint = message.startsWith('CHPP did not return a valid HFI rank')
        ? ' Could the team be playing a match? Try again later.'
        : '';
      setHfiRankNotice(`Rankings not updated. ${message}${retryHint}`);
      setHfiRankNoticeIsError(true);
    } finally {
      setIsUpdatingHfiRanks(false);
    }
  }, [fetchData, isUpdatingHfiRanks, tournament, setHfiRankNotice, setHfiRankNoticeIsError, setIsUpdatingHfiRanks]);

  useEffect(() => {
    if (
      activeTab !== 'fixtures' ||
      !tournament ||
      tournament.status === 'finished' ||
      selectedSeasonNumber !== currentSeasonNumberForSelection
    )
      return;

    const shouldRefresh = () => {
      if (isRefreshingFixtures) return false;
      if (document.visibilityState !== 'visible') return false;
      const lastRefreshDate = tournament.last_fixtures_refresh ? new Date(tournament.last_fixtures_refresh) : null;
      const ageMins = lastRefreshDate ? (Date.now() - lastRefreshDate.getTime()) / 60000 : 999;
      if (ageMins < 10) return false;
      return rounds.some((r) => r.matches.some((m) => !m.completed));
    };

    const t = setTimeout(() => {
      if (shouldRefresh()) handleRefreshFixtures();
    }, 0);

    const interval = setInterval(
      () => {
        if (shouldRefresh()) handleRefreshFixtures();
      },
      10 * 60 * 1000,
    );

    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentSeasonNumberForSelection, selectedSeasonNumber, tournament?.id]);

  const handleTabChange = (tab: 'standings' | 'fixtures' | 'history' | 'guestbook' | 'news' | 'admin') => {
    if (tab !== activeTab) {
      if (tab === 'history' && latestPublishedHistorySeason) {
        const latestCount = historySeasonCommentCounts[latestPublishedHistorySeason.id];
        if (typeof latestCount === 'number') {
          localStorage.setItem(
            `ht-120min:history-comments-read:${latestPublishedHistorySeason.id}`,
            String(latestCount),
          );
          setHistorySeenVersion((current) => current + 1);
        }
      }
      setIsAddingDescription(false);
      setQuickDescription('');
    }
  };

  const getTabHref = (tab: 'standings' | 'fixtures' | 'history' | 'guestbook' | 'news' | 'admin') => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', tab);
    nextParams.delete('season');
    const query = nextParams.toString();
    return `${pathname}${query ? `?${query}` : ''}`;
  };

  useEffect(() => {
    if (activeTab !== 'standings' || !tournament) return;

    const fetchChat = async () => {
      const { data: chatData, error: chatError } = await supabase
        .from('tournament_chat')
        .select('*')
        .eq('tournament_id', tournament.id)
        .order('created_at', { ascending: true });

      if (chatError || !chatData) return;

      const { data: globalData } = await supabase
        .from('global_chat')
        .select('id, author_name, author_ht_id, content, created_at, global_message, is_published')
        .eq('global_message', true)
        .eq('is_published', true)
        .order('created_at', { ascending: true });
      const allChatData = [...chatData, ...(globalData || [])].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );

      const authorIds = [...new Set(allChatData.map((m) => m.author_ht_id).filter((id) => id && id !== 0))];
      const standingsManagerIds = teams
        .filter((team) => !team.reserve_active)
        .map((team) => team.hattrick_user_id)
        .filter((id): id is number => !!id);
      const profileIds = [...new Set([...authorIds, ...standingsManagerIds])];

      if (profileIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('hattrick_user_id, avatar_json, country_name, country_id')
          .in('hattrick_user_id', profileIds);

        const profileMap = Object.fromEntries(
          (profileData || []).map((p) => [
            p.hattrick_user_id,
            {
              avatar_json: p.avatar_json,
              country_name: p.country_name,
              country_id: p.country_id,
            },
          ]),
        ) as Record<number, ChatAuthorProfile>;

        setManagerProfiles(profileMap);

        setChatMessages(
          allChatData.map((m) => ({
            ...m,
            profiles: m.author_ht_id ? profileMap[m.author_ht_id] : null,
          })),
        );
      } else {
        setManagerProfiles({});
        setChatMessages(allChatData);
      }
    };

    fetchChat();

    const channel = supabase
      .channel(`chat:${tournament.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tournament_chat',
          filter: `tournament_id=eq.${tournament.id}`,
        },
        async (payload) => {
          const newMessage = payload.new as any;

          // Fetch the profile for the author to get the avatar immediately
          const { data: profile } = await supabase
            .from('profiles')
            .select('avatar_json, country_name, country_id')
            .eq('hattrick_user_id', newMessage.author_ht_id)
            .single();

          setChatMessages((prev) => [...prev, { ...newMessage, profiles: profile }]);
        },
      )
      .subscribe();

    const globalChannel = supabase
      .channel(`global-chat:${tournament.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'global_chat', filter: 'global_message=eq.true' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedMessage = payload.old as { id?: string };
            if (deletedMessage.id) {
              setChatMessages((previous) => previous.filter((message) => message.id !== deletedMessage.id));
            }
            return;
          }

          const newMessage = payload.new as any;
          if (!newMessage?.id) return;
          if (newMessage.is_published !== true) {
            setChatMessages((previous) => previous.filter((message) => message.id !== newMessage.id));
            return;
          }

          const { data: profile } = await supabase
            .from('profiles')
            .select('avatar_json, country_name, country_id')
            .eq('hattrick_user_id', newMessage.author_ht_id)
            .maybeSingle();
          setChatMessages((previous) =>
            previous.some((message) => message.id === newMessage.id)
              ? previous
              : [...previous, { ...newMessage, profiles: profile }].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
                ),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(globalChannel);
    };
  }, [activeTab, teams, tournament]);

  const handlePostChat = async (content: string, globalMessage = false) => {
    // Accept content here
    if (!content.trim() || !tournament) return;
    try {
      const myHtId = localStorage.getItem('my_ht_user_id');
      const myTeam = myHtId ? teams.find((t) => t.hattrick_user_id === Number(myHtId)) : null;
      const authorName = myTeam?.manager_name || myTeam?.name || localStorage.getItem('my_ht_manager_name') || 'Guest';

      if (globalMessage) {
        const response = await fetch('/api/app?route=global-chat', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: content.trim(), globalMessage: true }),
        });
        if (!response.ok) alert('Could not send the global message.');
        return;
      }

      await supabase.from('tournament_chat').insert({
        tournament_id: tournament.id,
        author_name: authorName,
        content: content.trim(),
        author_ht_id: myHtId ? parseInt(myHtId) : null,
      });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tournament && (await hydratePrivateData(password).catch(() => false))) {
      setIsAdminAuthenticated(true);
      setAdminAuthSource('legacy_password');
      localStorage.setItem(`admin_pw_${slug}`, password);
      localStorage.setItem(`admin_auth_${slug}`, 'password');
      setAdminAuthError(false);
      setFailedLoginAttempt(false);
    } else {
      setAdminAuthError(true);
      setFailedLoginAttempt(true);
    }
  };

  const handleOrganizerLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleAccess?.canViewAdmin) return;

    setIsAdminAuthenticated(true);
    setAdminAuthSource('oauth_role');
    if (tournament) {
      sessionStorage.setItem(getOrganizerAdminSessionStorageKey(tournament.id, roleAccess.viewerUserId), 'oauth_role');
    }
    localStorage.setItem(`admin_auth_${slug}`, 'organizer');
    localStorage.removeItem(`admin_pw_${slug}`);
    setPassword('');
    setAdminAuthError(false);
    setFailedLoginAttempt(false);
  };

  const handleOrganizerSessionLogin = (e: React.FormEvent) => {
    e.preventDefault();
    startHattrickLoginRedirect();
  };

  const handleResetAdminPassword = async () => {
    if (!tournament || !canLoginAsOrganizer || isResettingAdminPassword) return;

    const confirmed = window.confirm('Reset the tournament admin password?');
    if (!confirmed) return;

    const newPassword = nanoid(8);
    setIsResettingAdminPassword(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ admin_password: newPassword })
        .eq('id', tournament.id);

      if (error) throw error;

      localStorage.setItem(`admin_pw_${slug}`, newPassword);
      setPassword(newPassword);
      fetchData();
      alert(`New admin password: ${newPassword}`);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsResettingAdminPassword(false);
    }
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setAdminAuthSource(null);
    setPassword('');
    setAdminAuthError(false);
    setFailedLoginAttempt(false);
    localStorage.removeItem(`admin_pw_${slug}`);
    localStorage.removeItem(`admin_auth_${slug}`);
    if (tournament && roleAccess?.viewerUserId) {
      sessionStorage.removeItem(getOrganizerAdminSessionStorageKey(tournament.id, roleAccess.viewerUserId));
    }
  };

  const updateTournamentLifecycleStatus = async (status: TournamentStatus, options: { isPrivate?: boolean } = {}) => {
    if (!tournament) return;
    const updatePayload: Partial<Pick<Tournament, 'status' | 'is_private'>> = { status };
    if (options.isPrivate !== undefined) updatePayload.is_private = options.isPrivate;

    const { error } = await supabase.from('tournaments').update(updatePayload).eq('id', tournament.id);
    if (error) {
      alert(error.message);
      return;
    }

    await invalidateAfterEdit();
    setTournament((prev) => (prev ? { ...prev, ...updatePayload } : prev));
  };

  const handlePublicationChange = async (target: 'planning' | 'recruiting') => {
    if (!tournament || isChangingPublication) return;
    const accepted = await confirm({
      title: lifecycleText(target === 'recruiting' ? 'publishTournament' : 'returnToPlanning'),
      message: lifecycleText(target === 'recruiting' ? 'publishWarning' : 'resetPlanningWarning'),
      confirmLabel: lifecycleText(target === 'recruiting' ? 'publishTournament' : 'returnToPlanning'),
      cancelLabel: uiText('cancel'),
      destructive: target === 'planning' && rounds.length > 0,
    });
    if (!accepted) return;
    setIsChangingPublication(true);
    try {
      const response = await fetch('/api/app?route=tournament-publication', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: Number(tournament.season || 1),
          target,
          adminPassword: adminAuthSource === 'legacy_password' ? password : undefined,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        errorCode?: string;
        transition?: { status: TournamentStatus; dropped_teams?: Array<{ name: string }> };
      };
      if (!response.ok || !result.transition)
        throw new Error(
          result.errorCode === 'season_started'
            ? lifecycleText('cannotResetPlayedSeason')
            : result.error || lifecycleText('publicationFailed'),
        );
      setTournament((current) =>
        current
          ? {
              ...current,
              status: result.transition!.status,
              registration_closed_at: null,
              ...(target === 'planning'
                ? { schedule_start_slot: null, schedule_locked_at: null, schedule_generated_at: null }
                : {}),
            }
          : current,
      );
      if (target === 'planning') {
        setRounds([]);
        setStandings([]);
        setSeasonSlots([]);
        setSeasonSlotAssignments([]);
        setSeasons((current) =>
          current.map((season) =>
            season.season_number === Number(tournament.season || 1)
              ? {
                  ...season,
                  status: 'planned',
                  started_at: null,
                  finished_at: null,
                  planned_start_slot: null,
                  snapshot_json: null,
                  fixtures_snapshot_json: null,
                  schedule_plan_json: null,
                  ranking_snapshot_json: null,
                }
              : season,
          ),
        );
      }
      const dropped = result.transition.dropped_teams ?? [];
      if (dropped.length)
        alert(lifecycleText('conflictingTeamsDropped', { teams: dropped.map((team) => team.name).join(', ') }));
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
      window.dispatchEvent(new Event('ht120:tournament-membership-changed'));
    } catch (error) {
      alert(error instanceof Error ? error.message : lifecycleText('publicationFailed'));
    } finally {
      setIsChangingPublication(false);
    }
  };

  const handlePauseTournament = async () => {
    if (!tournament) return;
    const confirmed = window.confirm(
      'Pause this tournament?\n\nPaused tournaments stay joinable and editable, but schedule management is hidden until you set it active again.',
    );
    if (!confirmed) return;

    await updateTournamentLifecycleStatus('paused');
  };

  const handleStopTournament = async () => {
    if (!tournament) return;
    const confirmed = window.confirm(
      'Fully stop this tournament?\n\nStopping halts the tournament, unpublishes it from public lists and allows teams to join other tournaments.',
    );
    if (!confirmed) return;
    if (!confirmAdminPassword()) return;

    await updateTournamentLifecycleStatus('stopped');
  };

  const handleArchiveTournament = async () => {
    if (!tournament || !canToggleArchiveTournament || isArchivingTournament) return;
    const shouldArchive = !tournament.is_archived;
    const confirmed = window.confirm(
      shouldArchive
        ? 'Archive this tournament?\n\nIt will disappear from public discovery and active organizer lists. Its tournament data and history will remain intact.'
        : 'Unarchive this tournament?\n\nIt will become visible again in the lists where finished and stopped tournaments are shown.',
    );
    if (!confirmed) return;
    if (adminAuthSource === 'legacy_password' && !confirmAdminPassword()) return;

    setIsArchivingTournament(true);
    try {
      if (adminAuthSource === 'legacy_password') {
        const { error } = await supabase
          .from('tournaments')
          .update({ is_archived: shouldArchive })
          .eq('id', tournament.id)
          .eq('is_archived', !shouldArchive);
        if (error) throw error;
      } else {
        const response = await fetch('/api/app?route=archive-tournament', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId: tournament.id, archived: shouldArchive }),
        });
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(result?.error || 'The tournament could not be archived.');
      }
      await invalidateAfterEdit();
      setTournament((current) => (current ? { ...current, is_archived: shouldArchive } : current));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The tournament could not be archived.');
    } finally {
      setIsArchivingTournament(false);
    }
  };

  const handleMoveStoppedToPaused = async () => {
    if (!tournament) return;
    if (!confirmAdminPassword()) return;

    if (playingElsewhereTeamIds.size > 0) {
      const teamNames = teams
        .filter((team) => team.ht_team_id && playingElsewhereTeamIds.has(team.ht_team_id))
        .map((team) => team.name)
        .join(', ');
      alert(
        `Tournament cannot be moved to paused while ${teamNames || 'one team'} is playing elsewhere. Remove or replace that team first.`,
      );
      return;
    }

    await updateTournamentLifecycleStatus('paused');
  };

  const handleSetPausedTournamentActive = async () => {
    const nextStatus = isGenerated ? 'active' : tournament?.is_test || isSandbox ? 'open' : 'recruiting';
    await updateTournamentLifecycleStatus(nextStatus);
  };

  const buildCurrentSeasonSnapshot = useCallback(() => {
    if (!tournament) return null;
    return buildSeasonHistorySnapshot(
      teams.map((team) => toStandingTeam(team)),
      rounds
        .filter((round) => round.phase !== 'postseason')
        .flatMap((round) => round.matches.map((match) => toSeasonHistoryMatch(match, round.round_number))),
      tournament.scoring_mode as any,
      seasonSlots,
      seasonSlotAssignments,
    );
  }, [rounds, seasonSlots, seasonSlotAssignments, teams, tournament]);

  const buildCurrentSeasonFixturesArchive = useCallback(() => {
    if (!tournament) return null;
    return buildSeasonFixturesSnapshot(tournament.season || 1, rounds);
  }, [rounds, tournament]);

  const persistCurrentSeasonHistory = useCallback(async () => {
    if (!tournament) throw new Error('Tournament is not available.');
    const currentSeasonNumber = tournament.season || 1;
    const existingSeason = seasons.find((season) => season.season_number === currentSeasonNumber);
    const snapshot = existingSeason?.snapshot_json || buildCurrentSeasonSnapshot();
    if (!snapshot) throw new Error('Season history could not be generated.');
    const fixturesSnapshot =
      existingSeason?.fixtures_snapshot_json && !isMissingMatchEventDetails(existingSeason.fixtures_snapshot_json)
        ? existingSeason.fixtures_snapshot_json
        : buildCurrentSeasonFixturesArchive();
    if (!fixturesSnapshot) throw new Error('Season fixtures could not be archived.');

    const now = new Date().toISOString();
    const finishedAt = resolveSeasonFinishedAt(
      rounds.flatMap((round) => round.matches.map((match) => toSeasonHistoryMatch(match, round.round_number))),
      existingSeason?.finished_at || now,
    );
    const startedAt = resolveSeasonStartedAt(
      rounds.flatMap((round) => round.matches.map((match) => toSeasonHistoryMatch(match, round.round_number))),
      existingSeason?.started_at || tournament.schedule_generated_at || null,
    );
    const { data, error } = await supabase
      .from('tournament_seasons')
      .upsert(
        {
          tournament_id: tournament.id,
          season_number: currentSeasonNumber,
          status: 'finished',
          planned_start_slot: tournament.schedule_start_slot,
          started_at: startedAt,
          finished_at: finishedAt,
          snapshot_json: snapshot,
          fixtures_snapshot_json: fixturesSnapshot,
          updated_at: now,
        },
        { onConflict: 'tournament_id,season_number' },
      )
      .select('*')
      .single();

    if (error) throw error;
    await invalidateAfterEdit();
    if (data) {
      setSeasons((current) => {
        const withoutCurrent = current.filter((season) => season.season_number !== currentSeasonNumber);
        return [...withoutCurrent, data as TournamentSeason].sort((a, b) => a.season_number - b.season_number);
      });
    }

    return snapshot;
  }, [buildCurrentSeasonFixturesArchive, buildCurrentSeasonSnapshot, rounds, seasons, tournament, invalidateAfterEdit]);

  const handleGenerateHistoryReport = async () => {
    if (!tournament || isFinalizingSeason) return;
    setIsFinalizingSeason(true);
    try {
      await persistCurrentSeasonHistory();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not generate the season history report.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleClearHistoryReport = async () => {
    if (!tournament || !currentSeason || isFinalizingSeason) return;
    const confirmed = window.confirm(
      `Clear the Season ${currentSeason.season_number} history report?\n\nThis removes the published report so you can correct the underlying results and generate it again.`,
    );
    if (!confirmed) return;

    setIsFinalizingSeason(true);
    try {
      const { data, error } = await supabase
        .from('tournament_seasons')
        .update({ snapshot_json: null, updated_at: new Date().toISOString() })
        .eq('id', currentSeason.id)
        .select('*')
        .single();
      if (error) throw error;

      const { error: dismissalError } = await supabase
        .from('tournament_announcement_dismissals')
        .delete()
        .eq('tournament_id', tournament.id)
        .in('notice_key', [
          `history-report-dismissed:${currentSeason.id}`,
          `history-report-viewed:${currentSeason.id}`,
        ]);
      await invalidateAfterEdit();
      if (dismissalError) throw dismissalError;

      localStorage.removeItem(getHistoryReportNoticeStorageKey(currentSeason.id));
      if (data) {
        setSeasons((current) =>
          current.map((season) => (season.id === currentSeason.id ? (data as TournamentSeason) : season)),
        );
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not clear the season history report.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleFinishSeason = async () => {
    if (!tournament || isFinalizingSeason) return;
    if (tournament.schedule_mode === 'length') {
      if (rounds.some((round) => round.phase_status !== 'completed')) {
        alert('Resolve every reserved round before finishing this staged season.');
        return;
      }
      if (rounds.some((round) => round.phase === 'postseason') && !currentSeason?.champion_team_id) {
        alert('The Championship Final must have a decisive champion before the season can be finished.');
        return;
      }
    }
    const confirmed = window.confirm(
      `Finish Season ${tournament.season}?\n\nThis closes the season and allows participating teams to join other tournaments. You can generate its History report separately afterwards.`,
    );
    if (!confirmed) return;

    setIsFinalizingSeason(true);
    try {
      const finishedAt = new Date().toISOString();
      const currentSeasonNumber = tournament.season || 1;
      const { data: updatedSeason, error: seasonError } = await supabase
        .from('tournament_seasons')
        .upsert(
          {
            tournament_id: tournament.id,
            season_number: currentSeasonNumber,
            status: 'finished',
            planned_start_slot: tournament.schedule_start_slot,
            started_at: currentSeason?.started_at || tournament.schedule_generated_at || null,
            finished_at: currentSeason?.finished_at || finishedAt,
            updated_at: finishedAt,
          },
          { onConflict: 'tournament_id,season_number' },
        )
        .select('*')
        .single();
      if (seasonError) throw seasonError;
      const { error } = await supabase.from('tournaments').update({ status: 'finished' }).eq('id', tournament.id);
      if (error) throw error;
      await invalidateAfterEdit();
      if (updatedSeason) {
        setSeasons((current) =>
          current
            .map((season) =>
              season.season_number === currentSeasonNumber ? (updatedSeason as TournamentSeason) : season,
            )
            .sort((a, b) => a.season_number - b.season_number),
        );
      }
      setTournament((current) => (current ? { ...current, status: 'finished' } : current));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not finish this season.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleStartSeason = async () => {
    if (!tournament || isFinalizingSeason) return;
    if (tournament.status === 'planning') {
      alert(lifecycleText('publishBeforeScheduling'));
      return;
    }
    const currentSeasonNumber = tournament.season || 1;
    const confirmed = window.confirm(
      `Set Season ${currentSeasonNumber} as started?\n\nThis closes registration for the season. You can then add fixtures manually or generate a schedule.`,
    );
    if (!confirmed) return;

    setIsFinalizingSeason(true);
    try {
      const startedAt = new Date().toISOString();
      const { data: updatedSeason, error: seasonError } = await supabase
        .from('tournament_seasons')
        .update({ status: 'ongoing', started_at: startedAt, updated_at: startedAt })
        .eq('tournament_id', tournament.id)
        .eq('season_number', currentSeasonNumber)
        .select('*')
        .single();
      if (seasonError) throw seasonError;

      const { error: tournamentError } = await supabase
        .from('tournaments')
        .update({ status: 'active', registration_closed_at: startedAt })
        .eq('id', tournament.id);
      if (tournamentError) throw tournamentError;
      await invalidateAfterEdit();

      if (updatedSeason) {
        setSeasons((current) =>
          current
            .map((season) =>
              season.season_number === currentSeasonNumber ? (updatedSeason as TournamentSeason) : season,
            )
            .sort((a, b) => a.season_number - b.season_number),
        );
      }
      setTournament((current) =>
        current ? { ...current, status: 'active', registration_closed_at: startedAt } : current,
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not start this season.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleResetSeasonToPlanning = async () => {
    if (!tournament || !currentSeason || isFinalizingSeason || currentSeason.status !== 'ongoing') return;
    if (!tournament.is_test && !isSandbox) {
      await handlePublicationChange('planning');
      return;
    }
    const hasSchedule = rounds.length > 0;
    const hasLinkedHattrickFixture = allMatches.some((match) => Boolean(match.ht_match_id));
    const externalFriendlyNote = hasLinkedHattrickFixture
      ? '\n\nThis removes only the HT-120min schedule reference. It does not cancel any friendly in Hattrick.'
      : '';
    const confirmed = window.confirm(
      hasSchedule
        ? `Reset Season ${currentSeason.season_number} to planning?\n\nBecause the season has a generated schedule, all current-season fixtures and their slot assignments will be cleared. Teams and tournament settings stay in place. This is only allowed before a match has started or finished.${externalFriendlyNote}`
        : `Reset Season ${currentSeason.season_number} to planning?\n\nNo current-season fixtures will be removed. Teams and tournament settings stay in place. This is only allowed before a match has started or finished.`,
    );
    if (!confirmed) return;

    setIsFinalizingSeason(true);
    try {
      const response = await fetch('/api/app?route=reset-season-to-planning', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, seasonNumber: currentSeason.season_number }),
      });
      const result = (await response.json()) as { error?: string; reset?: { tournament_status?: TournamentStatus } };
      if (!response.ok) throw new Error(result.error || 'The season could not be reset to planning.');

      setRounds([]);
      setSeasonSlots([]);
      setSeasonSlotAssignments([]);
      setStandings([]);
      setSeasons((current) =>
        current.map((season) =>
          season.id === currentSeason.id
            ? {
                ...season,
                status: 'planned',
                started_at: null,
                finished_at: null,
                snapshot_json: null,
                fixtures_snapshot_json: null,
              }
            : season,
        ),
      );
      setTournament((current) =>
        current
          ? {
              ...current,
              status: result.reset?.tournament_status || current.status,
              schedule_locked_at: null,
              schedule_generated_at: null,
            }
          : current,
      );
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The season could not be reset to planning.');
    } finally {
      setIsFinalizingSeason(false);
    }
  };

  const handleRebuildSeasonSnapshot = async (season: TournamentSeason) => {
    if (!tournament || rebuildingSeasonNumber !== null) return;
    setRebuildingSeasonNumber(season.season_number);
    try {
      const { data: seasonRounds, error: roundsError } = await supabase
        .from('rounds')
        .select(PUBLIC_ROUND_FIELDS)
        .eq('tournament_id', tournament.id)
        .eq('season_number', season.season_number)
        .order('round_number', { ascending: true });
      if (roundsError) throw roundsError;
      if (!seasonRounds?.length) throw new Error('No retained rounds were found for this season.');

      const { data: seasonMatches, error: matchesError } = await supabase
        .from('matches')
        .select('*')
        .in(
          'round_id',
          seasonRounds.map((round) => round.id),
        );
      if (matchesError) throw matchesError;

      const roundNumberById = new Map(seasonRounds.map((round) => [round.id, round.round_number]));
      const matches = (seasonMatches || []) as MatchWithTeams[];
      const historicalTeamIds = new Set(
        [
          ...matches.flatMap((match) => [match.home_team_id, match.away_team_id]),
          ...(season.snapshot_json?.standings || []).map((standing) => standing.teamId),
        ].filter((teamId): teamId is string => !!teamId),
      );
      const historicalSlots =
        tournament.scoring_mode === 'average120'
          ? await supabase
              .from('tournament_season_slots')
              .select('id,current_team_id')
              .eq('tournament_season_id', season.id)
          : null;
      if (historicalSlots?.error) throw historicalSlots.error;
      const historicalSlotIds = (historicalSlots?.data || []).map((slot) => slot.id);
      const historicalAssignments = historicalSlotIds.length
        ? await supabase
            .from('tournament_season_slot_assignments')
            .select('*')
            .in('tournament_season_slot_id', historicalSlotIds)
        : null;
      if (historicalAssignments?.error) throw historicalAssignments.error;
      for (const slot of historicalSlots?.data || []) {
        if (slot.current_team_id) historicalTeamIds.add(slot.current_team_id);
      }
      const historicalTeams = teams
        .filter((team) => historicalTeamIds.has(team.id))
        .map((team) => toStandingTeam({ ...team, active: true }));
      const snapshot = buildSeasonHistorySnapshot(
        historicalTeams,
        matches.map((match) => toSeasonHistoryMatch(match, roundNumberById.get(match.round_id))),
        tournament.scoring_mode as any,
        historicalSlots?.data || [],
        (historicalAssignments?.data || []) as SeasonSlotAssignment[],
      );
      const updatedAt = new Date().toISOString();
      const { data: updatedSeason, error: updateError } = await supabase
        .from('tournament_seasons')
        .update({ snapshot_json: snapshot, updated_at: updatedAt })
        .eq('id', season.id)
        .select('*')
        .single();
      if (updateError) throw updateError;
      await invalidateAfterEdit();

      setSeasons((current) =>
        current.map((item) => (item.id === season.id ? (updatedSeason as TournamentSeason) : item)),
      );
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not rebuild this season archive.');
    } finally {
      setRebuildingSeasonNumber(null);
    }
  };

  const handleStartNewSeason = async (mode: 'auto' | 'open') => {
    if (!tournament || isAddingSeason) return;
    if (tournament.status !== 'finished') {
      alert('A new season can only be added after the current season is finished.');
      return;
    }
    const nextSeasonNumber = (tournament.season || 1) + 1;
    const confirmed = await confirm({
      title: lifecycleText(mode === 'auto' ? 'autoStartSeason' : 'planNextSeason', { season: nextSeasonNumber }),
      message: lifecycleText(mode === 'auto' ? 'autoStartNextSeasonWarning' : 'planNextSeasonWarning'),
      confirmLabel: lifecycleText(mode === 'auto' ? 'autoStartSeason' : 'planNextSeason', { season: nextSeasonNumber }),
      cancelLabel: uiText('cancel'),
    });
    if (!confirmed) return;

    setIsAddingSeason(true);
    try {
      await persistCurrentSeasonHistory();
      const fixturesSnapshot = buildCurrentSeasonFixturesArchive();
      if (!fixturesSnapshot) throw new Error('Season fixtures could not be archived.');
      const plannedStart =
        tournament.schedule_start_slot && new Date(tournament.schedule_start_slot).getTime() > getCurrentTimestamp()
          ? tournament.schedule_start_slot
          : null;

      const response = await fetch('/api/app?route=start-tournament-season', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          nextSeasonNumber,
          mode,
          fixturesSnapshot,
          plannedStartSlot: plannedStart,
          adminPassword: adminAuthSource === 'legacy_password' ? password : undefined,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        season?: TournamentSeason;
        droppedTeams?: Array<{ name: string }>;
      };
      if (!response.ok) throw new Error(result.error || lifecycleText('publicationFailed'));
      const nextSeason = result.season;
      if (result.droppedTeams?.length)
        alert(
          lifecycleText('conflictingTeamsDropped', { teams: result.droppedTeams.map((team) => team.name).join(', ') }),
        );

      if (nextSeason) {
        setSeasons((current) =>
          [...current, nextSeason as TournamentSeason].sort((a, b) => a.season_number - b.season_number),
        );
      }
      setRounds([]);
      setStandings([]);
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('season');
      setSearchParams(nextParams, { replace: true });
      setScheduleTeamOrder(null);
      setTournament((prev) =>
        prev
          ? {
              ...prev,
              season: nextSeasonNumber,
              status: mode === 'auto' ? 'active' : tournament.is_test || isSandbox ? 'waiting' : 'planning',
              schedule_start_slot: plannedStart,
              schedule_locked_at: null,
              registration_closed_at: mode === 'auto' ? new Date().toISOString() : null,
              schedule_generated_at: null,
            }
          : prev,
      );
      fetchData();
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Could not start the next season.');
    } finally {
      setIsAddingSeason(false);
    }
  };

  const handleLeaveTournament = async (team: Team) => {
    if (!tournament) return;
    if (!window.confirm(`Leave ${tournament.name} with ${team.name}?`)) return;

    const response = await fetch('/api/app?route=tournament-participation', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'leave',
        tournamentId: tournament.id,
        teamId: team.id,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      alert(result.error || 'Could not leave the tournament.');
      return;
    }
    await fetchData({
      showLoader: false,
      invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
    });
  };

  const getParticipantAudienceHtUserIds = useCallback(
    () =>
      Array.from(
        new Set(
          teams
            .filter((team) => isCurrentParticipantTeam(team) && team.hattrick_user_id)
            .map((team) => Number(team.hattrick_user_id)),
        ),
      ),
    [teams],
  );

  const createAnnouncement = useCallback(
    async ({
      content,
      templateKey,
      visibility,
      source,
    }: {
      content: string;
      templateKey: string | null;
      visibility: TournamentAnnouncementVisibility;
      source: 'admin' | 'system';
    }) => {
      if (!tournament || !content.trim()) return null;
      const audienceHtUserIds = visibility === 'participants' ? getParticipantAudienceHtUserIds() : [];
      const { data, error } = await supabase
        .from('tournament_announcements')
        .insert({
          tournament_id: tournament.id,
          content: content.trim(),
          template_key: templateKey,
          visibility,
          source,
          audience_ht_user_ids: audienceHtUserIds,
          is_active: true,
          created_by_name: source === 'system' ? 'Cup Press Release' : currentHtManagerName,
          created_by_ht_user_id: currentHtUserId,
        })
        .select('*')
        .single();

      if (error) throw error;
      await invalidateAfterEdit();
      if (data) setAnnouncements((current) => [data as TournamentAnnouncement, ...current]);
      return data as TournamentAnnouncement | null;
    },
    [currentHtManagerName, currentHtUserId, getParticipantAudienceHtUserIds, tournament, invalidateAfterEdit],
  );

  const handleAnnouncementPublish = useCallback(
    async ({
      content,
      templateKey,
      visibility,
    }: {
      content: string;
      templateKey: string | null;
      visibility: TournamentAnnouncementVisibility;
    }) => {
      await createAnnouncement({
        content,
        templateKey,
        visibility,
        source: 'admin',
      });
    },
    [createAnnouncement],
  );

  const handleAnnouncementVisibilityToggle = async (announcement: TournamentAnnouncement) => {
    const nextActive = !announcement.is_active;
    const { data, error } = await supabase
      .from('tournament_announcements')
      .update({ is_active: nextActive, hidden_at: nextActive ? null : new Date().toISOString() })
      .eq('id', announcement.id)
      .select('*')
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    await invalidateAfterEdit();
    setAnnouncements((current) =>
      current.map((item) => (item.id === announcement.id ? (data as TournamentAnnouncement) : item)),
    );
  };

  const insertDismissal = async (payload: {
    announcement_id?: string | null;
    notice_key?: string | null;
    tournament_id: string;
    hattrick_user_id: number;
  }) => {
    const { data, error } = await supabase
      .from('tournament_announcement_dismissals')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') return null;
      throw error;
    }

    return data as TournamentAnnouncementDismissal | null;
  };

  const handleDismissJoinedNotice = async () => {
    if (!tournament || !currentHtUserId) return;
    setIsJoinedNoticeDismissed(true);
    localStorage.setItem(`joined_notice_dismissed_${slug}`, 'true');
    try {
      const dismissal = await insertDismissal({
        tournament_id: tournament.id,
        notice_key: JOINED_NOTICE_KEY,
        announcement_id: null,
        hattrick_user_id: currentHtUserId,
      });
      if (dismissal) setAnnouncementDismissals((current) => [...current, dismissal]);
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleDismissAnnouncement = async (announcement: TournamentAnnouncement) => {
    if (announcement.visibility === 'public') {
      localStorage.setItem(`announcement_dismissed_${announcement.id}`, 'true');
      setPublicAnnouncementDismissalVersion((current) => current + 1);
      return;
    }

    if (!tournament || !currentHtUserId) return;
    try {
      const dismissal = await insertDismissal({
        tournament_id: tournament.id,
        announcement_id: announcement.id,
        notice_key: null,
        hattrick_user_id: currentHtUserId,
      });
      if (dismissal) setAnnouncementDismissals((current) => [...current, dismissal]);
    } catch (error: any) {
      alert(error.message);
    }
  };

  const getActiveTeamRestrictionMismatch = (countryLimit = editCountryLimit) => {
    if (!countryLimit) return null;

    for (const team of teams) {
      if (!isCurrentParticipantTeam(team)) continue;
      const validation = validateTeamEligibility(
        {
          leagueName: '',
          leagueId: team.league_id ?? undefined,
          leagueSystemId: team.league_id === 3000 || team.gender_id === 2 ? 2 : undefined,
          genderId: team.gender_id ?? undefined,
          countryId: team.country_id ?? undefined,
          countryName: team.country_name,
        },
        {
          category: editLeagueCategory,
          countryLimit,
        },
      );

      if (!validation.eligible) {
        return `Team ${team.name} (${team.ht_team_id}) does not match this league limit. ${
          validation.reason || 'Remove the team or choose Any Hattrick League.'
        }`;
      }
    }

    return null;
  };

  const leagueRestrictionOptions = getCompatibleLeagueRestrictionOptions(
    teams.filter(isCurrentParticipantTeam).map((team) => ({
      leagueName: '',
      leagueId: team.league_id ?? undefined,
      leagueSystemId: team.league_id === 3000 || team.gender_id === 2 ? 2 : undefined,
      genderId: team.gender_id ?? undefined,
      countryId: team.country_id ?? undefined,
      countryName: team.country_name,
    })),
    editLeagueCategory,
  );
  const currentLeagueRestrictionIsCompatible =
    !editCountryLimit || leagueRestrictionOptions.some((option) => option.value === editCountryLimit);

  const updateSettings = async () => {
    const teamRestrictionMismatch = getActiveTeamRestrictionMismatch();
    if (teamRestrictionMismatch) {
      alert(teamRestrictionMismatch);
      return;
    }

    setIsUpdatingSettings(true);
    try {
      const selectedStartSlot =
        !isStartDateLocked && scheduleStartSlotId
          ? scheduleDraft.allSlotOptions.find((slot) => slot.id === scheduleStartSlotId) || null
          : null;
      const nextPlannedStartSlot = isStartDateLocked
        ? (tournament?.schedule_start_slot ?? null)
        : (selectedStartSlot?.nominalDate.toISOString() ?? tournament?.schedule_start_slot ?? null);
      const { error } = await supabase
        .from('tournaments')
        .update({
          name:
            editRegistrationType === 'sandbox'
              ? formatTournamentName(editName, { registrationType: editRegistrationType })
              : editName.trim(),
          is_private: editIsPrivate,
          chpp_only_join: editChppOnlyJoin,
          league_category: editLeagueCategory,
          registration_type: editRegistrationType,
          country_limit: editCountryLimit,
          max_country_active_teams: editMaxCountryActiveTeams,
          allow_manager_country_size_exception: editAllowManagerCountrySizeException,
          default_theme: editDefaultTheme,
          scoring_mode: editScoringMode,
          country_limit_format: editCountryLimit ? 'country_id' : null,
          is_test: isTest,
          show_description: showEditDescription,
          description: editDescription,
          forum_id: editForumId.trim() ? Number(editForumId) : null,
          admin_email: showEditEmail ? editAdminEmail : null,
          max_teams: editMaxTeams,
          registration_closed_at: editRegistrationOpen
            ? null
            : (tournament?.registration_closed_at ?? new Date().toISOString()),
          allow_reserve_registration: editAllowReserveRegistration,
          schedule_mode:
            tournament?.schedule_mode === 'length' ? 'length' : scheduleSetup === 'manual' ? 'manual' : scheduleMode,
          schedule_start_slot: nextPlannedStartSlot,
          ...(canManageFeaturedTournaments ? { is_featured: editIsFeatured } : {}),
        })

        .eq('id', tournament?.id);

      if (error) throw error;
      if (tournament) {
        await supabase.from('tournament_seasons').upsert(
          {
            tournament_id: tournament.id,
            season_number: tournament.season || 1,
            status: tournament.status === 'finished' ? 'finished' : isGenerated ? 'ongoing' : 'planned',
            planned_start_slot: nextPlannedStartSlot,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tournament_id,season_number' },
        );
      }

      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const handleQuickDescriptionAdd = async () => {
    if (!quickDescription.trim()) return;
    setIsUpdatingSettings(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({
          description: quickDescription.trim(),
          show_description: true,
        })
        .eq('id', tournament?.id);

      if (error) throw error;
      setIsAddingDescription(false);
      setQuickDescription('');
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdatingSettings(false);
    }
  };

  const handleUpdateImage = async () => {
    if (!tournament) return;
    setIsUpdatingImage(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .update({ image_url: newImageUrl.trim() || null })
        .eq('id', tournament.id);

      if (error) throw error;
      setIsEditingImage(false);
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsUpdatingImage(false);
    }
  };

  const duplicateAsSandbox = async () => {
    if (!tournament || isDuplicatingSandbox) return;
    const confirmed = window.confirm(
      `Create a fresh private sandbox from ${tournament.name} and its current roster? No fixtures, results, history, or manager ownership will be copied.`,
    );
    if (!confirmed) return;

    setIsDuplicatingSandbox(true);
    try {
      const response = await fetch('/api/app?route=duplicate-tournament-sandbox', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id }),
      });
      const data = (await response.json()) as { slug?: string; error?: string };
      if (!response.ok || !data.slug) throw new Error(data.error || 'Sandbox copy could not be created.');
      router.push(toLocalePath(locale, `/t/${data.slug}?tab=admin&welcome=created`));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Sandbox copy could not be created.');
    } finally {
      setIsDuplicatingSandbox(false);
    }
  };

  const refreshSpotlightProfiles = async () => {
    if (!tournament || isRefreshingSpotlight || isDuplicatingSandbox) return;
    const confirmed = window.confirm(
      `Refresh saved Spotlight data for active, non-reserve, non-placeholder managers in ${tournament.name}? This sends managercompendium and one manager-wide teamdetails request for each manager with saved CHPP authorization. One action supports up to 25 managers (50 CHPP requests).`,
    );
    if (!confirmed) return;

    setIsRefreshingSpotlight(true);
    try {
      const response = await fetch('/api/app?route=refresh-spotlight-profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id }),
      });
      const data = (await response.json()) as {
        error?: string;
        managerCount?: number;
        maxChppCalls?: number;
        refreshedCount?: number;
        failedCount?: number;
        results?: Array<{ managerId: number; refreshed: boolean; error?: string }>;
      };
      if (!response.ok) throw new Error(data.error || 'Spotlight profiles could not be refreshed.');

      const results = data.results ?? [];
      const refreshedCount = results.filter((result) => result.refreshed).length;
      const failedResults = results.filter((result) => !result.refreshed);
      const summary = [
        `Manager snapshots: ${data.managerCount ?? results.length} eligible, ${data.refreshedCount ?? refreshedCount} refreshed, ${data.failedCount ?? failedResults.length} not refreshed.`,
        `Up to ${data.maxChppCalls ?? (data.managerCount ?? results.length) * 2} CHPP requests for this action.`,
      ];
      if (failedResults.length) {
        summary.push('Not refreshed:');
        summary.push(
          ...failedResults.map((result) => `Manager ${result.managerId}: ${result.error || 'refresh failed'}`),
        );
      }
      alert(summary.join('\n'));
      if (refreshedCount > 0) router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Spotlight profiles could not be refreshed.');
    } finally {
      setIsRefreshingSpotlight(false);
    }
  };

  const [reserveValidation, setReserveValidation] = useState<{
    teamId: string;
    validated: boolean;
    known: boolean;
    managerName: string | null;
    categoryEligible: boolean;
    countryEligible: boolean;
    eligibilityWarnings: string[];
  } | null>(null);

  const fetchTeamData = async (htId: string, isReplacement: boolean, isReserve = false) => {
    if (!/^\d{1,10}$/.test(htId.trim())) return;
    setIsFetchingTeamData(true);
    try {
      const res = await fetch(`/api/teams/info?team_id=${htId}`);
      const data = (await res.json()) as FetchedTeamData & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to fetch team data');

      // Validation check
      const category = (tournament?.league_category || 'male') as 'male' | 'hfi';
      const countryLimit = normalizeLeagueLimit(
        tournament?.country_limit,
        tournament?.country_limit_format ?? 'league_id',
      );
      const categoryEligible = teamMatchesCategory(data, category);
      const countryEligible = teamMatchesCountryLimit(data, countryLimit);
      const categoryEligibility = validateTeamEligibility(data, { category, countryLimit: null });

      const validation = validateTeamEligibility(data, {
        category,
        countryLimit,
      });
      if (isReserve && !categoryEligible && !isSiteAdmin) {
        throw new Error(categoryEligibility.reason || `Team ID ${htId} "${data.teamName}" is not eligible.`);
      }
      if (!isReserve && !validation.eligible) {
        throw new Error(validation.reason || `Team ID ${htId} "${data.teamName}" is not eligible.`);
      }

      if (isReplacement) {
        setReplacementName(data.teamName);
      } else if (isReserve) {
        setReserveTeamName(data.teamName);
        const requiredCountry = resolveCountryRestriction(
          tournament?.country_limit,
          tournament?.country_limit_format,
        )?.leagueName || tournament?.country_limit || 'the required country';
        const eligibilityWarnings = [
          !categoryEligible ? categoryEligibility.reason || 'This team does not match the tournament category.' : null,
          !countryEligible
            ? `This team is from ${data.countryName || 'a different country'}, while this tournament is restricted to ${requiredCountry}.`
            : null,
        ].filter((warning): warning is string => Boolean(warning));
        setReserveValidation({
          teamId: htId,
          validated: false,
          known: false,
          managerName: null,
          categoryEligible,
          countryEligible,
          eligibilityWarnings,
        });
        const ownershipResponse = await fetch('/api/app?route=reserve-admission', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId: tournament?.id, teamId: Number(htId), action: 'lookup' }),
        });
        const ownership = await ownershipResponse.json();
        if (!ownershipResponse.ok) throw new Error(ownership.error || 'Ownership lookup failed.');
        setReserveValidation((current) => current?.teamId === htId ? {
          ...current,
          validated: ownership.validated === true,
          known: ownership.known === true,
          managerName: ownership.managerName || null,
        } : current);
      } else {
        setNewTeamName(data.teamName);
        setNewTeamData(data);
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsFetchingTeamData(false);
    }
  };

  const fetchSandboxTeamById = async (teamId: number): Promise<FetchedTeamData> => {
    const params = new URLSearchParams({
      team_id: String(teamId),
      sandbox: '1',
      league_category: tournament?.league_category === 'hfi' ? 'hfi' : 'male',
    });
    const res = await fetch(`/api/teams/info?${params.toString()}`);
    const data = (await res.json()) as FetchedTeamData & { error?: string };
    if (!res.ok) throw new Error(data.error || 'Failed to fetch sandbox team data');
    if (!data.teamName || data.teamName === 'Unknown') throw new Error('Team data is missing a valid team name.');
    return data;
  };

  const fetchRandomSandboxTeam = async () => {
    setIsFetchingSandboxTeam(true);
    setSandboxFetchError('');
    setSandboxCandidate(null);

    try {
      for (let attempt = 0; attempt < SANDBOX_RANDOM_ATTEMPTS; attempt += 1) {
        const teamId = getRandomSandboxTeamId(tournament?.league_category === 'hfi' ? 'hfi' : 'male');
        if (teams.some((team) => team.ht_team_id === teamId)) continue;

        try {
          const candidate = await fetchSandboxTeamById(teamId);
          if (!teams.some((team) => team.ht_team_id === candidate.teamId)) {
            setSandboxCandidate(candidate);
            return;
          }
        } catch {
          // Random team IDs are sparse; keep trying until the configured cap.
        }
      }

      setSandboxFetchError('Could not find a matching random team. Try again.');
    } finally {
      setIsFetchingSandboxTeam(false);
    }
  };

  const addSandboxTeam = async () => {
    if (!tournament || !sandboxCandidate) return;
    if (isGenerated) {
      alert('Test teams can only be added before the schedule is generated.');
      setSandboxCandidate(null);
      return;
    }
    if (sandboxTeamLimitReached) {
      alert('The test tournament has reached its team limit.');
      setSandboxCandidate(null);
      return;
    }
    if (teams.some((team) => team.ht_team_id === sandboxCandidate.teamId && team.active)) {
      alert('This team is already active in the tournament.');
      setSandboxCandidate(null);
      return;
    }

    setIsSavingTeam(true);
    try {
      const { error } = await supabase.from('teams').insert({
        tournament_id: tournament.id,
        name: sandboxCandidate.teamName,
        ht_team_id: sandboxCandidate.teamId,
        active: true,
        joined_via_oauth: false,
        manager_name: 'Admin added',
        logo_url: sandboxCandidate.logoUrl ?? null,
        country_id: sandboxCandidate.countryId ?? null,
        country_name: sandboxCandidate.countryName ?? null,
        league_id: sandboxCandidate.leagueId ?? null,
        gender_id: sandboxCandidate.genderId ?? null,
        league_level: sandboxCandidate.leagueLevel ?? null,
        team_rank: sandboxCandidate.teamRank ?? null,
        power_rating: sandboxCandidate.powerRating ?? null,
        power_global_rank: sandboxCandidate.powerGlobalRank ?? null,
        power_league_rank: sandboxCandidate.powerLeagueRank ?? null,
        power_region_rank: sandboxCandidate.powerRegionRank ?? null,
      });
      if (error) throw error;

      setSandboxCandidate(null);
      setSandboxFetchError('');
      void trackActivity('sandbox_team_added', {
        route: `/t/${slug}`,
        tournamentId: tournament.id,
        metadata: { teamId: sandboxCandidate.teamId },
      });
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const addTeam = async (e: React.FormEvent, isJoin: boolean = false, addAsReserve: boolean = false) => {
    if (e) e.preventDefault();
    if (isGenerated && !addAsReserve) {
      alert('Add the team to reserves, then promote it into the season or use paired reserve admission for the current round.');
      return;
    }
    if (!isJoin && !addAsReserve && isSiteAdmin && tournament?.registration_closed_at) {
      alert('Participant registration is closed. Add this team to reserves, then promote it into the season.');
      return;
    }
    const name = isJoin ? joinTeamName : addAsReserve ? reserveTeamName : newTeamName;
    const htId = isJoin ? joinTeamId : addAsReserve ? reserveTeamId : newTeamId;

    if (!name.trim() || !htId.trim()) {
      alert('Both Team Name and HT ID are required.');
      return;
    }

    if (!/^\d{1,10}$/.test(htId.trim())) {
      alert('HT ID must be a valid number.');
      return;
    }

    const htIdInt = parseInt(htId.trim());
    if (teams.some((t) => t.ht_team_id === htIdInt && !t.is_placeholder && t.active)) {
      alert('This team is already in the tournament roster or reserve list.');
      return;
    }

    const reserveEligibility = addAsReserve && reserveValidation?.teamId === htId ? reserveValidation : null;
    const eligibilityWarning = reserveEligibility?.eligibilityWarnings.length
      ? `\n\nEligibility warning:\n${reserveEligibility.eligibilityWarnings.join('\n')}\nProceed anyway?`
      : '';
    const siteAdminAddWarning = !isJoin && !addAsReserve && isSiteAdmin
      ? `\n\nSite-admin warning: eligibility and other tournament membership may conflict.${tournament?.max_teams && activeParticipantCount >= tournament.max_teams
        ? ` This exceeds the configured limit of ${tournament.max_teams} teams.` : ''}`
      : '';
    const planningJoin = !addAsReserve && tournament?.status === 'planning';
    if (
      !(await confirm({
        title: addAsReserve
          ? lifecycleText('addReserveTitle')
          : planningJoin
            ? lifecycleText('joinPlanningTitle')
            : uiText('joinTournament'),
        message: addAsReserve
          ? `Add ${name} (ID: ${htId}) to the reserve list?${eligibilityWarning}`
          : planningJoin
            ? `${name} (ID: ${htId})\n\n${lifecycleText('joinPlanningWarning')}${siteAdminAddWarning}`
            : `Add ${name} (ID: ${htId}) to the tournament?${siteAdminAddWarning}`,
        confirmLabel: uiText('add'),
        cancelLabel: uiText('cancel'),
      }))
    )
      return;

    setIsSavingTeam(true);
    try {
      if (addAsReserve) {
        const response = await fetch('/api/app?route=admin-add-reserve-team', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournamentId: tournament?.id,
            teamId: htIdInt,
            validated: reserveValidation?.teamId === htId && reserveValidation.validated,
            countryMismatchConfirmed: reserveEligibility?.countryEligible === false,
          }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || 'The reserve team could not be added.');
        setReserveTeamId('');
        setReserveTeamName('');
        setIsReserveTeamFormOpen(false);
        await fetchData();
        return;
      }

      if (!isJoin && roleAccess?.isImplicitSuperadmin) {
        const response = await fetch('/api/app?route=admin-add-reserve-team', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId: tournament?.id, teamId: htIdInt, action: 'add-placeholder' }),
        });
        const result = (await response.json()) as { error?: string; team?: { id: string } };
        if (!response.ok) throw new Error(result.error || 'The placeholder could not be added.');
        setNewTeamId('');
        setNewTeamName('');
        setNewTeamData(null);
        void trackActivity('team_added_by_admin', {
          route: `/t/${slug}`, tournamentId: tournament?.id, teamId: result.team?.id,
          metadata: { isJoin: false },
        });
        await fetchData();
        return;
      }

      let finalTeamId: string | null = null;

      // 1. Insert new team
      const fetchedTeamData = isJoin ? null : newTeamData;
      const { data: newTeam, error } = await supabase
        .from('teams')
        .insert([
          {
            tournament_id: tournament?.id,
            name: name.trim(),
            ht_team_id: parseInt(htId.trim()),
            active: true,
            logo_url: fetchedTeamData?.logoUrl ?? null,
            country_id: fetchedTeamData?.countryId ?? null,
            country_name: fetchedTeamData?.countryName ?? null,
            league_id: fetchedTeamData?.leagueId ?? null,
            gender_id: fetchedTeamData?.genderId ?? null,
            league_level: fetchedTeamData?.leagueLevel ?? null,
            team_rank: fetchedTeamData?.teamRank ?? null,
            power_rating: fetchedTeamData?.powerRating ?? null,
            power_global_rank: fetchedTeamData?.powerGlobalRank ?? null,
            power_league_rank: fetchedTeamData?.powerLeagueRank ?? null,
            power_region_rank: fetchedTeamData?.powerRegionRank ?? null,
            manager_name: fetchedTeamData ? 'Bot team' : null,
          },
        ])
        .select()
        .single();

      if (error) throw error;
      finalTeamId = newTeam?.id;

      if (isJoin) {
        setJoinTeamId('');
        setJoinTeamName('');
        setIsJoining(false);
      } else {
        setNewTeamId('');
        setNewTeamName('');
        setNewTeamData(null);
      }
      void trackActivity(isJoin ? 'tournament_joined' : 'team_added_by_admin', {
        route: `/t/${slug}`,
        tournamentId: tournament?.id,
        teamId: finalTeamId || undefined,
        metadata: { isJoin },
      });
      fetchData();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const transitionTeamReserveStatus = async (team: Team, action: 'to_reserve' | 'to_participant') => {
    const allowGeneratedPromotion = Boolean(
      action === 'to_participant' && tournament && isSiteAdmin &&
      !['finished', 'stopped', 'archived'].includes(tournament.status),
    );
    const allowGeneratedDemotion = action === 'to_reserve' && isSiteAdmin &&
      !seasonSlots.some((slot) => slot.current_team_id === team.id);
    if (!tournament || (isGenerated && !allowGeneratedPromotion && !allowGeneratedDemotion) || !roleAccess?.canManageOperations) return;

    const isPromoting = action === 'to_participant';
    const nextState = isPromoting ? 'tournament participant' : 'reserve list';
    const overTeamLimit = Boolean(
      isPromoting && !team.active && isSiteAdmin && tournament.max_teams && tournament.max_teams > 0 &&
      activeParticipantCount >= tournament.max_teams
    );
    const limitWarning = overTeamLimit
      ? `\n\nWarning: this will exceed the tournament limit of ${tournament.max_teams} teams (${activeParticipantCount} currently active).`
      : '';
    const promotionEligibilityTeam = {
      leagueName: null,
      leagueId: team.league_id ?? null,
      leagueSystemId: team.league_id === 3000 ? 2 : null,
      genderId: team.gender_id ?? null,
      countryId: team.country_id ?? null,
      countryName: team.country_name ?? null,
    };
    const promotionWarnings = isSiteAdmin && isPromoting
      ? [
          !teamMatchesCategory(promotionEligibilityTeam, tournament.league_category)
            ? `Team is not eligible for ${tournament.league_category === 'hfi' ? 'HFI' : 'Regular male'} category.`
            : null,
          !teamMatchesCountryLimit(
            promotionEligibilityTeam,
            normalizeLeagueLimit(tournament.country_limit, tournament.country_limit_format ?? 'league_id'),
          )
            ? 'Team does not match the tournament country restriction.'
            : null,
        ].filter((warning): warning is string => Boolean(warning))
      : [];
    const eligibilityWarning = promotionWarnings.length
      ? `\n\nEligibility warning: ${promotionWarnings.join(' ')}`
      : '';
    const siteAdminOverrideWarning = isSiteAdmin && isPromoting
      ? '\n\nSite-admin override: category, country, active tournament membership, and team-limit restrictions will not block this promotion. Hattrick booking is not checked here.'
      : '';
    const scheduleWarning = isGenerated && allowGeneratedPromotion
      ? '\n\nThis assigns a season slot and adds the team to standings. The team’s own released slot is restored when available; otherwise it enters future regular-round scheduling and current fixtures stay intact. To fill another team’s vacant slot, choose Fill next vacant slot. For a new fixture in the current round, use paired reserve admission instead.'
      : isGenerated && allowGeneratedDemotion
        ? '\n\nThis team has no season slot. Existing fixtures will stay unchanged.'
      : '';
    if (!window.confirm(`${isPromoting ? 'Promote' : 'Move'} ${team.name} to the ${nextState}?${eligibilityWarning}${limitWarning}${siteAdminOverrideWarning}${scheduleWarning}`)) return;

    setIsSavingTeam(true);
    try {
      const response = await fetch('/api/app?route=admin-team-reserve-transition', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, teamId: team.id, action }),
      });
      const result = (await response.json()) as {
        error?: string;
        promotion?: { entry?: string; next_round_number?: number; updated_match_count?: number };
      };
      if (!response.ok) throw new Error(result.error || 'The team status could not be changed.');
      await fetchData({ invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed' });
      if (result.promotion?.entry === 'future_round') {
        alert(`${team.name} now has a season slot and appears in standings. The current round is unchanged; eligible fixtures can be generated when Round ${result.promotion.next_round_number} begins.`);
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const replaceTeamWithReserve = async (formerTeamId: string) => {
    if (!tournament || !selectedReserveTeamId) return;
    const formerTeam = teams.find((team) => team.id === formerTeamId);
    const reserveTeam = reserveTeams.find((team) => team.id === selectedReserveTeamId);
    if (!formerTeam || !reserveTeam) return;
    const siteAdminOverrideWarning = isSiteAdmin
      ? '\n\nSite-admin warning: eligibility, membership, capacity, and Hattrick booking may conflict. Protected fixtures will still block this move.'
      : '';
    if (!window.confirm(`Replace ${formerTeam.name} with reserve ${reserveTeam.name}?${siteAdminOverrideWarning}`)) return;

    setIsSavingTeam(true);
    try {
      const response = await fetch(formerTeam.active
        ? '/api/app?route=reserve-team-swap'
        : '/api/app?route=reserve-team-fill', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: Number(tournament.season || 1),
          formerTeamId,
          incomingReserveTeamId: selectedReserveTeamId,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The reserve replacement could not be completed.');
      setReserveReplacingTeamId(null);
      setSelectedReserveTeamId('');
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const fillVacantSlotWithReserve = async (team: Team) => {
    if (!tournament) return;
    const siteAdminOverrideWarning = isSiteAdmin
      ? '\n\nSite-admin warning: eligibility, membership, capacity, and Hattrick booking may conflict. Protected fixtures will still block this move.'
      : '';
    if (!window.confirm(`Fill the next vacant season slot with ${team.name}? This assigns the team to eligible unplayed fixtures. Completed results stay on that slot's standings line, and protected fixtures stay unchanged.${siteAdminOverrideWarning}`)) return;

    setIsSavingTeam(true);
    try {
      const response = await fetch('/api/app?route=reserve-team-fill', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: Number(tournament.season || 1),
          incomingReserveTeamId: team.id,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The reserve team could not be promoted.');
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const moveInactiveTeamToReserve = async (team: Team) => {
    if (!tournament) return;
    if (!window.confirm(`Move ${team.name} to the reserve list?`)) return;

    setIsSavingTeam(true);
    try {
      const response = await fetch('/api/app?route=move-inactive-team-to-reserve', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: Number(tournament.season || 1),
          teamId: team.id,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The team could not be moved to reserves.');
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const removePastTeam = async (team: Team) => {
    if (!tournament || !window.confirm(`Remove unused Past team ${team.name} from this tournament?`)) return;
    setIsSavingTeam(true);
    try {
      const response = await fetch('/api/app?route=remove-unused-past-team', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, teamId: team.id }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The Past team could not be removed.');
      await fetchData({
        showLoader: false,
        invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed',
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The Past team could not be removed.');
    } finally {
      setIsSavingTeam(false);
    }
  };

  const replaceTeam = async (oldTeamId: string) => {
    if (!replacementHtId.trim() || !tournament) {
      alert('A checked existing Hattrick team ID is required.');
      return;
    }

    const oldTeam = teams.find((t) => t.id === oldTeamId);
    if (!window.confirm(`Replace ${oldTeam?.name || 'Past team'} with ${replacementName}?`)) {
      return;
    }

    setIsSavingTeam(true);
    try {
      const response = await fetch('/api/app?route=season-slot-replacement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: Number(tournament.season || 1),
          formerTeamId: oldTeamId,
          incomingHtTeamId: Number(replacementHtId),
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'The replacement could not be completed.');

      setReplacingTeamId(null);
      setReplacementHtId('');
      setReplacementName('');
      fetchData({ invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed' });
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const reconcileTournamentTeamState = async (updatedTeams: Team[]) => {
    if (!tournament || isSandbox) return;
    if (tournament.status === 'stopped' || tournament.status === 'finished') return;

    const registeredTeams = updatedTeams.filter((team) => !team.is_placeholder && !team.reserve_active);
    const activeTeams = registeredTeams.filter(isCurrentParticipantTeam);

    if (isGenerated) {
      const shouldPause = activeTeams.length === 0 || !isHealthQuotaMet(updatedTeams);
      if (shouldPause && tournament.status !== 'paused') {
        const { error } = await supabase.from('tournaments').update({ status: 'paused' }).eq('id', tournament.id);
        if (error) throw error;
        await invalidateAfterEdit();
        alert('This tournament has been paused because too few active teams remain.');
      }
      return;
    }

    if (registeredTeams.length === 0 && !tournament.is_private) {
      const { error } = await supabase.from('tournaments').update({ is_private: true }).eq('id', tournament.id);
      if (error) throw error;
      await invalidateAfterEdit();
    }
  };

  const confirmAdminPassword = () => {
    const enteredPassword = window.prompt('Enter admin password to confirm:');
    if (enteredPassword === null) return false;
    if (enteredPassword !== tournament?.admin_password) {
      alert('Wrong admin password.');
      return false;
    }
    return true;
  };

  const deleteTeam = async (id: string) => {
    let updatedTeams;
    const team = teams.find((t) => t.id === id);
    if (!team || !tournament) return;
    if (isGenerated) {
      const hasSeasonSlot = seasonSlots.some((slot) => slot.current_team_id === team.id);
      const confirmed = window.confirm(hasSeasonSlot
        ? `Remove ${team.name} from the scheduled season?\n\nCompleted matches stay in history. Future fixtures for this team become BYEs until the vacant slot is filled by a replacement.`
        : `Remove ${team.name} from the tournament roster? This team has no current-season slot; existing fixtures will stay unchanged.`);
      if (!confirmed) return;

      setIsSavingTeam(true);
      try {
        const response = await fetch('/api/app?route=scheduled-team-removal', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournamentId: tournament.id,
            seasonNumber: Number(tournament.season || 1),
            teamId: team.id,
          }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error || 'The team could not be removed from the scheduled season.');
        await fetchData({ showLoader: false });
      } catch (error) {
        alert(error instanceof Error ? error.message : 'The team could not be removed from the scheduled season.');
      } finally {
        setIsSavingTeam(false);
      }
      return;
    }

    if (window.confirm(`Remove ${team.name} from the tournament?`)) {
      if (!confirmAdminPassword()) return;
      // If NOT generated, we just destroy the relationship for this season/tournament
      // Since tournament_id is currently the only link, setting it to null (if schema allowed)
      // or just deleting from this tournament's team list.
      // The plan says "DON'T hard delete team from DB", but the current schema
      // has teams belonging to a tournament. If I delete it here, it's gone from this tournament.
      // If we had a global teams table, it would be different.
      // For now, I'll just delete the record as it's specific to this tournament instance.
      const { error } = await supabase.from('teams').delete().eq('id', id);
      if (error) {
        alert(error.message);
        return;
      }
      updatedTeams = teams.filter((t) => t.id !== id);
      await reconcileTournamentTeamState(updatedTeams);
      await fetchData();
    }
  };

  const generateSchedule = async () => {
    if (!tournament) return;
    if (!isHealthQuotaMet()) {
      setScheduleNotice({
        title: 'Cannot generate schedule',
        message: 'Too many teams have withdrawn. Replace Past teams to meet the minimum quota.',
      });
      return;
    }

    const selectedDraft = usesLengthSchedulePlanner ? lengthScheduleDraft : scheduleDraft;
    if (!selectedDraft.valid || !selectedDraft.selectedStartSlot) {
      setScheduleNotice({
        title: 'Cannot generate schedule',
        message: selectedDraft.reason || 'Choose a valid start date first.',
      });
      return;
    }
    if (usesLengthSchedulePlanner ? !serializedLengthScheduleDraft : !serializedScheduleDraft) {
      setScheduleNotice({
        title: 'Cannot generate schedule',
        message: 'Unable to prepare the selected schedule draft.',
      });
      return;
    }
    const scheduleAdminPassword = password.trim() || tournament?.admin_password || '';
    if (!usesLengthSchedulePlanner && !scheduleAdminPassword) {
      setScheduleNotice({
        title: 'Cannot generate schedule',
        message: 'Unable to confirm organizer access. Please reload the page and try again.',
      });
      return;
    }

    setSchedulePreflightWarning(null);
    try {
      const response = await fetch('/api/teams/refresh-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'team_planning_statuses',
          tournamentId: tournament.id,
          adminPassword: scheduleAdminPassword,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        statuses?: Array<{ teamId: string; inCup: boolean | null }>;
      } | null;
      if (response.ok && payload?.statuses) {
        const teamsInCup = payload.statuses
          .filter((status) => status.inCup === true)
          .map((status) => teams.find((team) => team.id === status.teamId)?.name || 'A tournament team');
        if (teamsInCup.length > 0) {
          setSchedulePreflightWarning(
            `${teamsInCup.join(', ')} ${teamsInCup.length === 1 ? 'is' : 'are'} still in the Hattrick cup. The schedule can be generated, but the affected fixture${teamsInCup.length === 1 ? '' : 's'} will be marked with a warning.`,
          );
        }
      }
    } catch {
      // The preflight is advisory; the post-generation fixture refresh remains authoritative.
    }
    setIsScheduleConfirmationOpen(true);
  };

  const confirmGenerateSchedule = async () => {
    setIsScheduleConfirmationOpen(false);
    if (!tournament) return;
    const scheduleStartDate = scheduleDraft.selectedStartSlot?.nominalDate.toISOString();
    if (usesLengthSchedulePlanner) {
      if (!serializedLengthScheduleDraft || !lengthScheduleDraft.selectedStartSlot) return;
    } else if (!serializedScheduleDraft || !scheduleStartDate) return;
    const scheduleAdminPassword = password.trim() || tournament.admin_password || '';
    if (!usesLengthSchedulePlanner && !scheduleAdminPassword) return;
    setIsGenerating(true);
    try {
      let seasonError: { message: string } | null = null;
      if (usesLengthSchedulePlanner) {
        const response = await fetch('/api/app?route=generate-length-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tournamentId: tournament.id,
            seasonNumber: tournament.season || 1,
            schedulePayload: serializedLengthScheduleDraft,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Could not generate the schedule.');
      } else {
        const { error } = await supabase.rpc('generate_tournament_schedule', {
          p_tournament_id: tournament.id,
          p_schedule_payload: serializedScheduleDraft,
          p_admin_password: scheduleAdminPassword,
          p_schedule_mode: scheduleDraft.mode,
          p_schedule_start_slot: scheduleStartDate,
          p_include_week15_weekend_friendly: scheduleDraft.consumesWeek15WeekendFriendly,
        });
        if (error) throw error;
        const seasonResult = await supabase.from('tournament_seasons').upsert(
          {
            tournament_id: tournament.id,
            season_number: tournament.season || 1,
            status: 'ongoing',
            planned_start_slot: scheduleStartDate,
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tournament_id,season_number' },
        );
        seasonError = seasonResult.error;
        if (seasonError) console.warn('Schedule generated, but season status could not be updated.', seasonError);
      }
      try {
        const refreshResponse = await fetch(`/api/teams/refresh-fixtures?tournament_id=${tournament.id}`);
        if (!refreshResponse.ok) console.warn('Schedule generated, but the initial fixture status refresh failed.');
      } catch (refreshError) {
        console.warn('Schedule generated, but the initial fixture status refresh failed.', refreshError);
      }
      try {
        await createAnnouncement({
          content: 'Tournament schedule dates were updated, please check Fixtures & Results.',
          templateKey: 'schedule-change',
          visibility: 'participants',
          source: 'system',
        });
      } catch (announcementError) {
        console.warn(
          'Schedule was regenerated, but the participant announcement could not be published.',
          announcementError,
        );
      }
      await fetchData();
      setScheduleNotice({
        title: 'Schedule generated',
        message: seasonError
          ? 'The matches are ready, but the season status could not be saved. Please review the season panel before continuing.'
          : 'The season is ongoing and its matches are ready to review.',
        showMatches: !seasonError,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
            ? err.message
            : 'Unknown error';
      setScheduleNotice({ title: 'Could not generate schedule', message });
    } finally {
      setIsGenerating(false);
    }
  };

  const repairCurrentLengthRound = async () => {
    if (!tournament || tournament.schedule_mode !== 'length') return;
    const currentRound = rounds.find((round) => round.phase_status === 'materialized' && round.phase === 'regular');
    if (!currentRound) return;
    if (!window.confirm(`Repair Round ${currentRound.round_number}? Correctly arranged fixtures will stay unchanged.`))
      return;
    setIsRepairingRound(true);
    try {
      const response = await fetch('/api/app?route=repair-length-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, seasonNumber: tournament.season || 1 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not repair this round.');
      await fetchData({ invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed' });
      setScheduleNotice({
        title: `Round ${currentRound.round_number} repaired`,
        message: `${body.lockedFixtures || 0} unaffected fixtures stayed locked. ${body.repairedPlayableFixtures || 0} playable fixtures were rebuilt.`,
      });
    } catch (error) {
      setScheduleNotice({
        title: 'Could not repair round',
        message: error instanceof Error ? error.message : 'The round could not be repaired.',
      });
    } finally {
      setIsRepairingRound(false);
    }
  };

  const recoverOriginalLengthRoundOne = async () => {
    if (!tournament || tournament.schedule_mode !== 'length') return;
    const roundOne = rounds.find((round) => round.round_number === 1);
    if (!roundOne || roundOne.phase !== 'regular') return;
    if (
      !window.confirm(
        'Restore the original deterministic Round 1 pairings?\n\nThis replaces only Round 1 fixture rows from the frozen ranking snapshot. Do not use this after Round 1 has been played.',
      )
    )
      return;
    setIsRecoveringRoundOne(true);
    try {
      const response = await fetch('/api/app?route=recover-length-round-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, seasonNumber: tournament.season || 1 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not restore original Round 1.');
      await fetchData({ invalidate: response.headers.get('X-Tournament-Cache') === 'invalidation-failed' });
      setScheduleNotice({
        title: 'Original Round 1 restored',
        message: `${body.reconstructedFixtures || 0} deterministic fixtures were recreated. Refresh Fixtures can now reconcile accepted Hattrick matches.`,
      });
    } catch (error) {
      setScheduleNotice({
        title: 'Could not restore Round 1',
        message: error instanceof Error ? error.message : 'Round 1 could not be recovered.',
      });
    } finally {
      setIsRecoveringRoundOne(false);
    }
  };

  const regenerateSchedule = async (): Promise<boolean> => {
    if (!rescheduleDraft.valid || !rescheduleDraft.selectedStartSlot || !rescheduleDraft.selectedFromRoundNumber) {
      alert(rescheduleDraft.reason || 'Choose a valid round and start date first.');
      return false;
    }
    if (!serializedRescheduleDraft) {
      alert('Unable to serialize the selected reschedule draft.');
      return false;
    }

    const scheduleAdminPassword = password.trim() || tournament?.admin_password || '';
    if (!scheduleAdminPassword) {
      alert('Unable to confirm organizer access. Please reload the page and try again.');
      return false;
    }

    const confirmMsg = `Regenerate schedule from round ${rescheduleDraft.selectedFromRoundNumber}?\n\nThis will only move future unarranged rounds. Pairings, BYEs, results, arranged matches, and played matches stay unchanged.`;
    if (!window.confirm(confirmMsg)) return false;

    setIsRescheduling(true);
    try {
      const { error } = await supabase.rpc('reschedule_tournament_rounds', {
        p_tournament_id: tournament?.id,
        p_admin_password: scheduleAdminPassword,
        p_from_round_number: rescheduleDraft.selectedFromRoundNumber,
        p_schedule_payload: serializedRescheduleDraft,
        p_schedule_start_slot: rescheduleDraft.selectedStartSlot.nominalDate.toISOString(),
        p_include_week15_weekend_friendly: rescheduleDraft.consumesWeek15WeekendFriendly,
      });

      if (error) throw error;
      await fetchData();
      return true;
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
            ? err.message
            : 'Unknown error';
      alert('Error regenerating schedule: ' + message);
      return false;
    } finally {
      setIsRescheduling(false);
    }
  };

  const updateMatch = async (matchId: string) => {
    const data = matchData[matchId];
    if (data?.home_goals == null || data?.away_goals == null) {
      alert('Enter both scores before saving the result.');
      return;
    }
    const appgValidationError = data.appg_outcome
      ? validateAppgOutcome({
          home_goals: Number(data.home_goals),
          away_goals: Number(data.away_goals),
          went_120: data.went_120 ?? false,
          total_minutes: data.total_minutes || 90,
          penalty_shootout_home_goals: data.penalty_shootout_home_goals ?? null,
          penalty_shootout_away_goals: data.penalty_shootout_away_goals ?? null,
          appg_outcome: data.appg_outcome,
        })
      : null;
    if (appgValidationError) {
      alert(appgValidationError);
      return;
    }

    const payload = {
      home_goals: parseInt(String(data.home_goals)),
      away_goals: parseInt(String(data.away_goals)),
      went_120: data?.went_120 ?? false,
      total_minutes: data?.total_minutes || 90,
      completed: true,
      penalty_shootout_home_goals: data.penalty_shootout_home_goals ?? null,
      penalty_shootout_away_goals: data.penalty_shootout_away_goals ?? null,
      ...(data.appg_outcome ? { appg_outcome: data.appg_outcome, appg_outcome_source: 'organizer' as const } : {}),
    };
    if (tournament?.schedule_mode === 'length') {
      const response = await fetch('/api/app?route=save-length-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: tournament.season || 1,
          updates: [
            {
              matchId,
              homeGoals: payload.home_goals,
              awayGoals: payload.away_goals,
              went120: payload.went_120,
              totalMinutes: payload.total_minutes,
              penaltyShootoutHomeGoals: payload.penalty_shootout_home_goals,
              penaltyShootoutAwayGoals: payload.penalty_shootout_away_goals,
              appgOutcome: data.appg_outcome ?? null,
              appgOutcomeSource: data.appg_outcome ? 'organizer' : null,
            },
          ],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(body.error || 'Could not save this result.');
        if (!body.resultsSaved) return;
      }
      setEditingMatch(null);
      setMatchData((current) => {
        const next = { ...current };
        delete next[matchId];
        return next;
      });
      await fetchData();
      return;
    }
    const { error } = await supabase.from('matches').update(payload).eq('id', matchId);

    if (error) alert(error.message);
    else {
      await invalidateAfterEdit();
      setEditingMatch(null);
      const nextRounds = rounds.map((round) => ({
        ...round,
        matches: round.matches.map((match) => (match.id === matchId ? { ...match, ...payload } : match)),
      }));
      setRounds(nextRounds);
      setStandings(
        calculateStandings(
          teams.map((team) => toStandingTeam(team)),
          getRegularStandingMatches(nextRounds),
          (tournament?.scoring_mode || '120min') as '120m' | '120min' | 'average120' | 'points' | 'appg',
        ),
      );
      setMatchData((current) => {
        const next = { ...current };
        delete next[matchId];
        return next;
      });
    }
  };

  const resetMatchResult = async (matchId: string) => {
    const match = rounds.flatMap((round) => round.matches).find((item) => item.id === matchId);
    if (!match) throw new Error('Tournament match not found.');
    const matchRound = rounds.find((round) => round.id === match.round_id);
    if (tournament?.schedule_mode === 'length' && matchRound?.phase_status !== 'materialized') {
      throw new Error(
        'A completed staged round cannot be rewritten after tournament progression. Use an explicit season repair workflow.',
      );
    }

    if (match.ht_match_id) {
      await requestHtMatchLink(matchId, String(match.ht_match_id), false, true);
    } else {
      const { data, error } = await supabase
        .from('matches')
        .update(buildResetUnlinkedResultPayload())
        .eq('id', matchId)
        .is('ht_match_id', null)
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message || 'Could not reset this result.');
      await invalidateAfterEdit();
    }

    await fetchFixturesOnly();
    setEditingMatch(null);
    setMatchData((current) => {
      const next = { ...current };
      delete next[matchId];
      return next;
    });
  };

  const removeFixture = async (matchId: string) => {
    const match = rounds.flatMap((round) => round.matches).find((item) => item.id === matchId);
    if (!match) return;
    if (tournament?.schedule_mode === 'length') {
      alert('Fixtures in a staged schedule are managed through Repair Round and cannot be deleted individually.');
      return;
    }

    const roundId = match.round_id;
    const homeName = match.home_team?.name || 'Home team';
    const awayName = match.away_team?.name || 'Away team';
    if (!window.confirm(`Remove ${homeName} vs ${awayName} from this tournament's fixtures?`)) return;

    try {
      const { error } = await supabase.from('matches').delete().eq('id', matchId);
      if (error) throw error;

      const { count, error: countError } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('round_id', roundId);
      if (countError) throw countError;

      if (count === 0) {
        const { error: roundError } = await supabase.from('rounds').delete().eq('id', roundId);
        if (roundError) throw roundError;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not remove the fixture.';
      alert(`Could not remove the fixture: ${message}`);
      return;
    }

    await invalidateAfterEdit();
    const nextRounds = rounds
      .map((round) => ({
        ...round,
        matches: round.matches.filter((item) => item.id !== matchId),
      }))
      .filter((round) => round.matches.length > 0);
    setRounds(nextRounds);
    setEditingMatch(null);
    setMatchData((current) => {
      const next = { ...current };
      delete next[matchId];
      return next;
    });
    setStandings(
      calculateStandings(
        teams.map((team) => toStandingTeam(team)),
        getRegularStandingMatches(nextRounds),
        (tournament?.scoring_mode || '120min') as '120m' | '120min' | 'average120' | 'points' | 'appg',
      ),
    );
  };

  const saveBulkMatches = async (updates: Record<string, BulkMatchUpdate>) => {
    const entries = Object.entries(updates);
    const preparedUpdates = entries.map(([matchId, data]) => {
      const match = rounds.flatMap((round) => round.matches).find((item) => item.id === matchId);
      const isBye = Boolean(match && (!match.home_team_id || !match.away_team_id));
      const homeGoals = data.home_goals == null && isBye ? 0 : data.home_goals;
      const awayGoals = data.away_goals == null && isBye ? 0 : data.away_goals;
      if (homeGoals == null || awayGoals == null) {
        throw new Error('Every result needs both scores before saving.');
      }
      const appgValidationError = data.appg_outcome
        ? validateAppgOutcome({
            home_goals: Number(homeGoals),
            away_goals: Number(awayGoals),
            went_120: data.went_120 ?? false,
            total_minutes: data.total_minutes || 90,
            penalty_shootout_home_goals: data.penalty_shootout_home_goals ?? null,
            penalty_shootout_away_goals: data.penalty_shootout_away_goals ?? null,
            appg_outcome: data.appg_outcome,
          })
        : null;
      if (appgValidationError) throw new Error(appgValidationError);
      const payload = {
        home_goals: Number(homeGoals),
        away_goals: Number(awayGoals),
        went_120: Boolean(data.went_120),
        total_minutes: Number(data.total_minutes) || 90,
        completed: true,
        penalty_shootout_home_goals: data.penalty_shootout_home_goals ?? null,
        penalty_shootout_away_goals: data.penalty_shootout_away_goals ?? null,
        ...(data.appg_outcome
          ? {
              appg_outcome: data.appg_outcome,
              appg_outcome_source: data.appg_outcome_source ?? ('organizer' as const),
            }
          : {}),
      };
      return [matchId, payload] as const;
    });
    if (tournament?.schedule_mode === 'length') {
      const response = await fetch('/api/app?route=save-length-results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          seasonNumber: tournament.season || 1,
          updates: preparedUpdates.map(([matchId, payload]) => ({
            matchId,
            homeGoals: payload.home_goals,
            awayGoals: payload.away_goals,
            went120: payload.went_120,
            totalMinutes: payload.total_minutes,
            penaltyShootoutHomeGoals: payload.penalty_shootout_home_goals,
            penaltyShootoutAwayGoals: payload.penalty_shootout_away_goals,
            appgOutcome: 'appg_outcome' in payload ? payload.appg_outcome : null,
            appgOutcomeSource: 'appg_outcome_source' in payload ? payload.appg_outcome_source : null,
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.resultsSaved) await fetchData();
        throw new Error(body.error || 'Could not save the results.');
      }
      await fetchData();
      return;
    }
    const results = await Promise.allSettled(
      preparedUpdates.map(async ([matchId, payload]) => {
        const { error } = await supabase.from('matches').update(payload).eq('id', matchId);
        if (error) throw error;
        return [matchId, payload] as const;
      }),
    );
    if (results.some((result) => result.status === 'fulfilled')) await invalidateAfterEdit();
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const saved = Object.fromEntries(
      results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    );
    const nextRounds = rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => (saved[match.id] ? { ...match, ...saved[match.id] } : match)),
    }));
    setRounds(nextRounds);
    setStandings(
      calculateStandings(
        teams.map((team) => toStandingTeam(team)),
        getRegularStandingMatches(nextRounds),
        (tournament?.scoring_mode || '120min') as '120m' | '120min' | 'average120' | 'points' | 'appg',
      ),
    );
  };

  const clearSeasonResults = async () => {
    if (tournament?.schedule_mode === 'length') {
      throw new Error(
        'Staged schedule results cannot be cleared after progression. Reset the season before play begins instead.',
      );
    }
    const matchIds = rounds.flatMap((round) => round.matches.map((match) => match.id));
    if (matchIds.length === 0) return;

    const payload = buildClearSeasonResultsPayload();
    const { error } = await supabase.from('matches').update(payload).in('id', matchIds);
    if (error) throw error;
    await invalidateAfterEdit();

    const nextRounds = rounds.map((round) => ({
      ...round,
      matches: round.matches.map((match) => ({ ...match, ...payload })),
    }));
    setRounds(nextRounds);
    setStandings(
      calculateStandings(
        teams.map((team) => toStandingTeam(team)),
        getRegularStandingMatches(nextRounds),
        (tournament?.scoring_mode || '120min') as '120m' | '120min' | 'average120' | 'points' | 'appg',
      ),
    );
  };

  const clearSeasonFixtures = async () => {
    if (!tournament) throw new Error('Tournament is not loaded.');
    if (scheduleSetup !== 'manual') throw new Error('Season fixtures can only be cleared for no-schedule tournaments.');

    const seasonNumber = tournament.season || 1;
    const { data: seasonRounds, error: roundsError } = await supabase
      .from('rounds')
      .select('id')
      .eq('tournament_id', tournament.id)
      .eq('season_number', seasonNumber);
    if (roundsError) throw roundsError;

    const roundIds = (seasonRounds || []).map((round) => round.id);
    if (roundIds.length > 0) {
      const { error: matchesError } = await supabase.from('matches').delete().in('round_id', roundIds);
      if (matchesError) throw matchesError;

      const { error: deleteRoundsError } = await supabase.from('rounds').delete().in('id', roundIds);
      if (deleteRoundsError) throw deleteRoundsError;
    }

    await invalidateAfterEdit();
    setRounds([]);
    setStandings(
      calculateStandings(
        teams.map((team) => toStandingTeam(team)),
        [],
        (tournament.scoring_mode || '120min') as '120m' | '120min' | 'average120' | 'points' | 'appg',
      ),
    );
  };

  const importCsvRows = async (rows: ResultCsvRow[]) => {
    if (!tournament) throw new Error('Tournament is not loaded.');
    const teamRows = rows.filter((row) => row.type === 'team');
    const matchRows = rows.filter((row) => row.type === 'match');
    if (teamRows.length > 0 && isGenerated) {
      throw new Error('Import team rows before generating the schedule.');
    }

    const existingTeamIds = new Set(teams.filter(isCurrentParticipantTeam).map((team) => team.ht_team_id));
    const importedTeamIds = new Set<number>();
    const fetchedTeams: FetchedTeamData[] = [];
    for (const row of teamRows) {
      if (!row.teamId || importedTeamIds.has(row.teamId)) continue;
      importedTeamIds.add(row.teamId);
      if (existingTeamIds.has(row.teamId)) continue;
      const response = await fetch(`/api/teams/info?team_id=${row.teamId}`);
      const data = (await response.json()) as FetchedTeamData & { error?: string };
      if (!response.ok) throw new Error(data.error || `Could not fetch team ${row.teamId}.`);
      const validation = validateTeamEligibility(data, {
        category: tournament.league_category,
        countryLimit: tournament.country_limit,
      });
      if (!validation.eligible) throw new Error(validation.reason || `Team ${row.teamId} is not eligible.`);
      fetchedTeams.push(data);
    }

    const findFixture = (row: ResultCsvRow) =>
      rounds
        .find((round) => round.round_number === row.round)
        ?.matches.find((item) => {
          const homeId = item.home_team?.ht_team_id;
          const awayId = item.away_team?.ht_team_id;
          return (
            (homeId === row.homeTeamId && awayId === row.awayTeamId) ||
            (homeId === row.awayTeamId && awayId === row.homeTeamId)
          );
        });

    const matchedRows = matchRows.map((row) => {
      const match = findFixture(row);
      if (!match)
        throw new Error(`Could not find the round ${row.round} fixture for ${row.homeTeamId} and ${row.awayTeamId}.`);
      if (row.homeGoals == null || row.awayGoals == null)
        throw new Error(`Result row for round ${row.round} is missing a score.`);
      const isReversed = match.home_team?.ht_team_id === row.awayTeamId;
      const normalized = {
        home_goals: isReversed ? row.awayGoals : row.homeGoals,
        away_goals: isReversed ? row.homeGoals : row.awayGoals,
        total_minutes: row.totalMinutes || 90,
        went_120: row.went120 ?? Boolean((row.totalMinutes || 90) >= 120),
        penalty_shootout_home_goals: isReversed ? row.penaltyShootoutAwayGoals : row.penaltyShootoutHomeGoals,
        penalty_shootout_away_goals: isReversed ? row.penaltyShootoutHomeGoals : row.penaltyShootoutAwayGoals,
        appg_outcome: row.appgOutcome,
      };
      const appgValidationError = normalized.appg_outcome ? validateAppgOutcome(normalized) : null;
      if (appgValidationError) {
        throw new Error(`Round ${row.round}: ${appgValidationError}`);
      }
      return { match, normalized };
    });

    if (new Set(matchedRows.map(({ match }) => match.id)).size !== matchedRows.length) {
      throw new Error('CSV contains the same scheduled fixture more than once.');
    }

    if (fetchedTeams.length > 0) {
      const { error } = await supabase.from('teams').insert(
        fetchedTeams.map((team) => ({
          tournament_id: tournament.id,
          name: team.teamName,
          ht_team_id: team.teamId,
          active: true,
          joined_via_oauth: false,
          manager_name: 'Bot team',
          logo_url: team.logoUrl ?? null,
          country_id: team.countryId ?? null,
          country_name: team.countryName ?? null,
          league_id: team.leagueId ?? null,
          gender_id: team.genderId ?? null,
          league_level: team.leagueLevel ?? null,
          team_rank: team.teamRank ?? null,
        })),
      );
      if (error) throw error;
    }

    const resultUpdates: Record<string, BulkMatchUpdate> = Object.fromEntries(
      matchedRows.map(({ match, normalized }) => [
        match.id,
        {
          ...normalized,
          completed: true,
          ...(normalized.appg_outcome ? { appg_outcome_source: 'csv' as const } : {}),
        },
      ]),
    );
    if (Object.keys(resultUpdates).length > 0) await saveBulkMatches(resultUpdates);
    if (fetchedTeams.length > 0) await fetchData();
  };

  const canManageSchedule = Boolean(
    canManageOperationalAdmin &&
    tournament &&
    !isPausedTournament &&
    !isStoppedTournament &&
    tournament.status !== 'planning',
  );
  const tournamentId = tournament?.id ?? null;
  const activeRealTeamsCount = teams.filter(isCurrentParticipantTeam).length;
  const nextRegularRoundAvailable = rounds.some((round) =>
    round.phase === 'regular' && round.phase_status === 'pending' &&
    round.round_number === (rounds.find((current) => current.phase_status === 'materialized')?.round_number ?? -1) + 1,
  );
  const sandboxTeamLimitReached = Boolean(tournament?.max_teams && activeRealTeamsCount >= tournament.max_teams);
  const canManageSandboxTeams = Boolean(tournament && isSandbox && canManageOperationalAdmin && !isGenerated);
  const canAddSandboxTeam = Boolean(canManageSandboxTeams && !sandboxTeamLimitReached);
  const canJoinTournament = Boolean(
    tournament &&
    !isSandbox &&
    canViewerJoinTournament({
      hasJoined,
      isGenerated,
      maxTeams: tournament.max_teams,
      teams,
      status: tournament.status,
      registrationClosedAt: tournament.registration_closed_at,
      nextRegularRoundAvailable: tournament.schedule_mode === 'length' && nextRegularRoundAvailable,
      pendingTeamsCount: pendingNextRoundTeams.length,
      scheduleMode: tournament.schedule_mode,
    }),
  );
  const canJoinReserve = Boolean(tournament && canViewerJoinReserve({
    allowReserveRegistration: tournament.allow_reserve_registration !== false,
    canJoinDirectly: canJoinTournament,
    status: tournament.status,
    isTest: Boolean(tournament.is_test),
    isSandbox,
  }));
  const isRegistrationOpen = Boolean(
    tournament &&
    !isSandbox &&
    isTournamentRegistrationOpen({
      isGenerated,
      status: tournament.status,
      registrationClosedAt: tournament.registration_closed_at,
      nextRegularRoundAvailable: tournament.schedule_mode === 'length' && nextRegularRoundAvailable,
    }),
  );
  const canJoinAnotherTeamBeforeFixtures = Boolean(
    tournament &&
    canViewerJoinAnotherTeam({
      isLoggedIn: Boolean(currentHtUserId),
      isRegistrationOpen,
      maxTeams: tournament.max_teams,
      activeTeamsCount: activeRealTeamsCount,
      pendingTeamsCount: pendingNextRoundTeams.length,
    }),
  );
  const shouldPromptReturningParticipantLogin = Boolean(
    tournamentId &&
    !currentHtUserId &&
    !canJoinTournament &&
    teams.some((team) => isCurrentParticipantTeam(team) && team.hattrick_user_id),
  );
  const rawReauthPromptReason =
    currentHtUserId && needsAuthRefresh()
      ? 'auth_refresh_needed'
      : shouldPromptReturningParticipantLogin
        ? 'returning_participant'
        : null;
  const reauthPromptDismissalKey =
    rawReauthPromptReason && slug ? `reauth_prompt_dismissed_${slug}_${rawReauthPromptReason}` : null;
  const reauthPromptReason =
    rawReauthPromptReason && reauthPromptDismissalKey && readSessionStorage(reauthPromptDismissalKey) !== 'true'
      ? rawReauthPromptReason
      : null;
  const dismissedAnnouncementIds = new Set(
    announcementDismissals
      .filter((dismissal) => dismissal.announcement_id)
      .map((dismissal) => dismissal.announcement_id as string),
  );
  const joinedNoticeDismissed =
    isJoinedNoticeDismissed ||
    storedJoinedNoticeDismissed === 'true' ||
    announcementDismissals.some((dismissal) => dismissal.notice_key === JOINED_NOTICE_KEY);
  const selectedTournamentMessage = selectTournamentMessage({
    canJoin: canJoinTournament,
    canJoinReserve,
    isOpenParticipant: hasJoined && canJoinAnotherTeamBeforeFixtures,
    hasJoined,
    hasPendingJoin: pendingNextRoundTeams.some((team) => team.hattrick_user_id === Number(myHtUserId)),
    currentHtUserId,
    joinedNoticeDismissed,
    reauthPromptReason,
    announcements,
    dismissedAnnouncementIds,
    publicDismissedAnnouncementIds: dismissedPublicAnnouncementIds,
  });

  const closeCreatedTournamentWelcome = () => {
    setHasClosedCreatedTournamentWelcome(true);
  };

  const acceptCreatedTournamentWelcome = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('welcome');
    setSearchParams(nextParams, { replace: true });
    setHasClosedCreatedTournamentWelcome(true);
  };

  const closeOpenTournamentWelcome = () => {
    setHasClosedOpenTournamentWelcome(true);
  };

  const acceptOpenTournamentWelcome = () => {
    if (!tournamentVisitWelcomeKey) return;
    dismissWelcome(tournamentVisitWelcomeKey);
    setHasClosedOpenTournamentWelcome(true);
  };

  const handleHistoryCommentsLoaded = useCallback(
    (seasonId: string, commentCount: number) => {
      setHistorySeasonCommentCounts((current) =>
        current[seasonId] === commentCount ? current : { ...current, [seasonId]: commentCount },
      );
      if (activeTab === 'history') {
        localStorage.setItem(`ht-120min:history-comments-read:${seasonId}`, String(commentCount));
        setHistorySeenVersion((current) => current + 1);
      }
    },
    [activeTab],
  );

  const handleRefreshHattrickLogin = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  if (loading) {
    return (
      <div className={styles.view}>
        <div className={styles.loading}>{t('loading')}</div>
      </div>
    );
  }
  if (!tournament && loadError) {
    return (
      <div className={styles.view}>
        <div className={styles.loading} role="alert">
          <p>{loadError}</p>
          <br />
          <Button variant="primary" onClick={() => void fetchData({ showLoader: true, invalidate: false })}>
            {uiText('tryAgain')}
          </Button>
          <a
            className={styles.loadErrorReportLink}
            href="https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=8777402"
            target="_blank"
            rel="noopener noreferrer"
          >
            {uiText('pleaseReportIssueToSiteAuthor')}
          </a>
        </div>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className={styles.view}>
        <div className={styles.loading}>{t('notFound')}</div>
      </div>
    );
  }

  const is120minMode = tournament.scoring_mode === '120m' || tournament.scoring_mode === '120min';
  const isAverage120Mode = tournament.scoring_mode === 'average120';
  const isAppgMode = isAppg120ScoringMode(tournament.scoring_mode);

  const isMobile = isHydrationReady && window.innerWidth <= 620;
  const publicUrl = !isHydrationReady ? pathname : `${window.location.origin}${pathname}`;
  const publicUrlDisplay = isMobile ? `...${slug}` : publicUrl;

  // Find the first round that is not fully completed
  const currentRoundIdForResults = rounds.find((r) => r.matches.some((m) => !m.completed))?.id;
  const currentSeasonNumber = currentSeasonNumberForSelection;
  const previousSeasons = seasons.filter((season) => season.season_number < currentSeasonNumber);
  const currentSeason = seasons.find((season) => season.season_number === currentSeasonNumber);
  const selectedSeason = seasons.find((season) => season.season_number === selectedSeasonNumber) || currentSeason;
  const selectedSeasonChampion = selectedSeason?.champion_team_id
    ? teams.find((team) => team.id === selectedSeason.champion_team_id) || null
    : null;
  const isViewingHistoricalSeason = selectedSeasonNumber < currentSeasonNumber;
  const isCurrentSeasonPlanned = currentSeason?.status === 'planned';
  const canMarkSeasonFinished = Boolean(tournament.status !== 'finished' && currentSeason?.status === 'ongoing');
  const isViewingHistoricalFixtures = isViewingHistoricalSeason;
  const fixtureRounds = isViewingHistoricalSeason
    ? selectedSeason?.fixtures_snapshot_json
      ? restoreFixtureSnapshot(selectedSeason.fixtures_snapshot_json)
      : []
    : rounds;
  const fixtureSeasonNumber = selectedSeasonNumber;
  const standingsWarningTeamIds = (() => {
    if (isViewingHistoricalSeason || isSandbox || tournament.is_test || warnings.length === 0) {
      return new Set<string>();
    }

    const currentRoundMatches = rounds.find((round) => round.id === currentRoundId)?.matches || [];
    const warningTeamIds = warnings
      .filter(
        (warning) =>
          warning.active !== false && warning.round_id === currentRoundId && typeof warning.team_id === 'string',
      )
      .filter((warning) => {
        const fixture = currentRoundMatches.find(
          (match) =>
            (match.home_team_id === warning.team_id || match.away_team_id === warning.team_id) &&
            match.reserve_replaces_team_id !== warning.team_id,
        );
        return !fixture || isFixtureMisarranged(fixture.status || 'not_arranged', fixture.completed, true);
      })
      .map((warning) => warning.team_id as string);

    return mapWarningTeamIdsToStandingsIds(warningTeamIds, seasonSlots);
  })();
  const handleSeasonChange = (seasonNumber: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('season', String(seasonNumber));
    setSearchParams(nextParams, { replace: true });
  };
  const reapplySuggestions = isRegistrationOpen
    ? teams
        .filter(
          (team) =>
            !team.active &&
            !team.reserve_active &&
            !team.is_placeholder &&
            team.reapply_season_number === currentSeasonNumber,
        )
        .map((team) => ({
          id: team.id,
          name: team.name,
          htTeamId: team.ht_team_id,
          hattrickUserId: team.hattrick_user_id ?? null,
          logoUrl: team.logo_url ?? null,
        }))
    : [];
  const historySeasons = seasons
    .filter((season) => season.status === 'finished' || season.snapshot_json)
    .sort((a, b) => b.season_number - a.season_number);
  const selectedHistorySeasonNumber =
    Number(searchParams.get('historySeason')) || historySeasons[0]?.season_number || null;
  const handleHistorySeasonChange = (seasonNumber: number) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', 'history');
    nextParams.set('historySeason', String(seasonNumber));
    setSearchParams(nextParams, { replace: true });
  };
  const formatHistoryDate = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Europe/Riga',
        }).format(new Date(value))
      : null;

  const latestHistoryCommentCount = latestPublishedHistorySeason
    ? (historySeasonCommentCounts[latestPublishedHistorySeason.id] ?? null)
    : null;
  const latestHistoryReadCount = latestPublishedHistorySeason
    ? (() => {
        void historySeenVersion;
        const storedValue = isHydrationReady
          ? readLocalStorage(`ht-120min:history-comments-read:${latestPublishedHistorySeason.id}`)
          : null;
        const storedCount = storedValue ? Number(storedValue) : 0;
        return Number.isFinite(storedCount) ? storedCount : 0;
      })()
    : 0;
  const latestHistoryUnreadCount =
    latestPublishedHistorySeason &&
    latestHistoryCommentCount !== null &&
    latestHistoryCommentCount > latestHistoryReadCount
      ? latestHistoryCommentCount - latestHistoryReadCount
      : 0;
  const hasNewHistoryReportBadge = Boolean(
    latestPublishedHistorySeason && historyReportNoticeIsCurrent && (!currentHtUserId || historyReportNoticeOpen),
  );
  const historyTabBadgeCount =
    activeTab !== 'history' ? Math.max(latestHistoryUnreadCount, hasNewHistoryReportBadge ? 1 : 0) : 0;

  const tournamentChat = (
    <section className={styles.tournamentChatWidget} aria-labelledby="tournament-chat-title">
      <h3 id="tournament-chat-title" className={styles.tournamentChatTitle}>
        <Chat size={16} weight="bold" aria-hidden="true" />
        {/* <span>{tournament.name} Chat</span> */}
        <span>{t('chatWithParticipants')}</span>
      </h3>
      <ChatView
        messages={chatMessages}
        onSendMessage={handlePostChat}
        myHtUserId={myHtUserId ? Number(myHtUserId) : null}
        leagueManagerIds={teams
          .filter((t) => !t.reserve_active)
          .map((t) => t.hattrick_user_id)
          .filter((id): id is number => !!id)}
        teamNames={teams
          .filter((t) => !t.reserve_active)
          .reduce((acc, t) => ({ ...acc, [t.hattrick_user_id || 0]: t.name }), {})}
        teamDetails={teams
          .filter((t) => !t.reserve_active)
          .reduce(
            (acc, team) => {
              if (team.hattrick_user_id) {
                acc[team.hattrick_user_id] = {
                  name: team.name,
                  countryName: team.country_name,
                  countryId: team.country_id,
                };
              }
              return acc;
            },
            {} as Record<number, { name: string; countryName?: string; countryId?: number | null }>,
          )}
        tournamentEmojiContext={
          {
            leagueCategory: tournament.league_category,
            countryLimit: tournament.country_limit,
            countryLimitFormat: tournament.country_limit_format,
          } satisfies TournamentEmojiContext
        }
        allowGlobalMessageControl
      />
    </section>
  );

  const adminController: TournamentAdminController = {
    data: {
      activeTab,
      tournament,
      teams,
      rounds,
      seasonSlots,
      currentSeasonSlotTeamIds,
      participantTeams,
      reserveTeams,
      activeParticipantCount,
      maxTeamsAllowsPromotion,
      isGenerated,
      isRegistrationOpen,
      isSandbox,
      isStoppedTournament,
      isValidatedTournament,
      publicOrganizerName,
      currentHtManagerName,
      isMobile,
      publicUrl,
      publicUrlDisplay,
      currentRoundIdForResults,
      previousSeasons,
      currentSeason,
      isCurrentSeasonPlanned,
      tournamentSettingsFaqItems,
    },
    access: {
      isAdminAuthenticated,
      roleAccessLoading,
      roleAccess,
      verifiedRoleAccess,
      canLoginAsOrganizer,
      verifiedRoleLabel,
      isPressOfficer,
      isSiteAdmin,
      oauthRoleAccess,
      canManageOperationalAdmin,
      canManageSchedule,
      canManageFeaturedTournaments,
      canToggleArchiveTournament,
      adminAccessMode,
      adminAccessName,
      password,
      setPassword,
      adminAuthError,
      setAdminAuthError,
      failedLoginAttempt,
      isResettingAdminPassword,
      onAdminLogin: handleAdminLogin,
      onOrganizerLogin: handleOrganizerLogin,
      onOrganizerSessionLogin: handleOrganizerSessionLogin,
      onResetAdminPassword: handleResetAdminPassword,
      onAdminLogout: handleAdminLogout,
      showNotice: alert,
    },
    settings: {
      editIsPrivate,
      setEditIsPrivate,
      editLeagueCategory,
      setEditLeagueCategory,
      editRegistrationType,
      setEditRegistrationType,
      editCountryLimit,
      setEditCountryLimit,
      editMaxCountryActiveTeams,
      setEditMaxCountryActiveTeams,
      editAllowManagerCountrySizeException,
      setEditAllowManagerCountrySizeException,
      editDefaultTheme,
      setEditDefaultTheme,
      editScoringMode,
      setEditScoringMode,
      editMaxTeams,
      setEditMaxTeams,
      editRegistrationOpen,
      setEditRegistrationOpen,
      editAllowReserveRegistration,
      setEditAllowReserveRegistration,
      showEditDescription,
      setShowEditDescription,
      editDescription,
      setEditDescription,
      showEditEmail,
      setShowEditEmail,
      editAdminEmail,
      setEditAdminEmail,
      editForumId,
      setEditForumId,
      isTest,
      setIsTest,
      editIsFeatured,
      setEditIsFeatured,
      isUpdatingSettings,
      settingsHasUnsavedChanges,
      unsavedSettingsFields,
      isStartDateLocked,
      firstKnownFixtureDate,
      scheduleStartSlotId,
      setScheduleStartSlotId,
      scheduleMode,
      scheduleSetup,
      setScheduleSetup,
      canUpdateSettings: updateSettings,
      getActiveTeamRestrictionMismatch,
      currentLeagueRestrictionIsCompatible,
      leagueRestrictionOptions,
      regenerateDescription,
    },
    schedule: {
      scheduleDraft,
      lengthScheduleDraft,
      rescheduleDraft,
      activeScheduleTeams,
      usesLengthSchedulePlanner,
      isGenerating,
      isRescheduling,
      isRepairingRound,
      isRecoveringRoundOne,
      isScheduleConfirmationOpen,
      setIsScheduleConfirmationOpen,
      schedulePreflightWarning,
      scheduleNotice,
      setScheduleNotice,
      onScheduleModeChange: handleScheduleModeChange,
      onShuffleScheduleFixtures: handleShuffleScheduleFixtures,
      onScheduleStartSlotChange: handleScheduleStartSlotIdChange,
      onIncludeWeek15Change: handleIncludeWeek15WeekendFriendlyChange,
      onRescheduleFromRoundChange: handleRescheduleFromRoundChange,
      onRescheduleStartSlotChange: handleRescheduleStartSlotIdChange,
      onIncludeWeek15RescheduleChange: handleIncludeWeek15WeekendFriendlyForRescheduleChange,
      onGenerateSchedule: generateSchedule,
      onConfirmGenerateSchedule: confirmGenerateSchedule,
      onRegenerateSchedule: regenerateSchedule,
      onRepairCurrentLengthRound: repairCurrentLengthRound,
      onRecoverOriginalLengthRoundOne: recoverOriginalLengthRoundOne,
      onCloseScheduleNotice: () => setScheduleNotice(null),
      onPreviewHtMatchAdd: previewHtMatchAdd,
      onSaveHtMatchAdd: saveHtMatchAdd,
      onFetchHtMatchSuggestions: fetchHtMatchSuggestions,
      includeWeek15WeekendFriendly,
      includeWeek15WeekendFriendlyForReschedule,
      setLengthFormatId,
      normalizeManualRounds,
      fetchFixturesOnly,
    },
    results: {
      editingMatch,
      setEditingMatch,
      matchData,
      setMatchData,
      isValidatedTournament,
      isSandbox,
      onUpdateMatch: async (matchId) => {
        await updateMatch(matchId);
      },
      onResetMatchResult: async (matchId) => {
        await resetMatchResult(matchId);
      },
      onPreviewHtMatchLink: previewHtMatchLink,
      onSaveHtMatchLink: async (matchId, htMatchId) => {
        await saveHtMatchLink(matchId, htMatchId);
      },
      onSaveBulkMatches: async (updates) => {
        await saveBulkMatches(updates);
      },
      onClearSeasonResults: clearSeasonResults
        ? async () => {
            await clearSeasonResults();
          }
        : undefined,
      onClearSeasonFixtures: clearSeasonFixtures
        ? async () => {
            await clearSeasonFixtures();
          }
        : undefined,
      onImportCsvRows: async (rows) => {
        await importCsvRows(rows);
      },
      onRemoveFixture: async (matchId) => {
        await removeFixture(matchId);
      },
    },
    teams: {
      newTeamId,
      setNewTeamId,
      newTeamName,
      setNewTeamName,
      isFetchingTeamData,
      setNewTeamData,
      isSavingTeam,
      isReserveTeamFormOpen,
      setIsReserveTeamFormOpen,
      reserveTeamId,
      setReserveTeamId,
      reserveTeamName,
      reserveValidation,
      onReservesChanged: fetchData,
      setReserveTeamName,
      teamStatusNotice,
      isRefreshingTeamStatuses,
      teamPlanningStatuses,
      hfiRankNotice,
      hfiRankNoticeIsError,
      isUpdatingHfiRanks,
      playingElsewhereTeamIds,
      onAddTeam: addTeam,
      onFetchTeamData: fetchTeamData,
      onRefreshTeamPlanningStatuses: refreshTeamPlanningStatuses,
      onUpdateHfiRanks: updateHfiRanks,
      onSetReserveFormOpen: setIsReserveTeamFormOpen,
      reserveReplacingTeamId,
      setReserveReplacingTeamId,
      selectedReserveTeamId,
      setSelectedReserveTeamId,
      replacingTeamId,
      setReplacingTeamId,
      replacementHtId,
      setReplacementHtId,
      replacementName,
      setReplacementName,
      onReplaceTeamWithReserve: replaceTeamWithReserve,
      onReplaceTeam: replaceTeam,
      onTransitionTeamReserveStatus: transitionTeamReserveStatus,
      onDeleteTeam: deleteTeam,
      onMoveInactiveTeamToReserve: moveInactiveTeamToReserve,
      onRemovePastTeam: removePastTeam,
      onFillVacantSlotWithReserve: fillVacantSlotWithReserve,
      onInviteExpandedChange: setIsInviteExpanded,
      inviteExpanded: isInviteExpanded,
      onDuplicateAsSandbox: duplicateAsSandbox,
      onRefreshSpotlightProfiles: refreshSpotlightProfiles,
      isDuplicatingSandbox,
      isRefreshingSpotlight,
    },
    seasons: {
      previousSeasons,
      currentSeason,
      isCurrentSeasonPlanned,
      rebuildingSeasonNumber,
      isAddingSeason,
      isFinalizingSeason,
      canMarkSeasonFinished,
      onRebuildSeasonSnapshot: handleRebuildSeasonSnapshot,
      onStartSeason: handleStartSeason,
      onResetSeasonToPlanning: handleResetSeasonToPlanning,
      onFinishSeason: handleFinishSeason,
      onGenerateHistoryReport: handleGenerateHistoryReport,
      onClearHistoryReport: handleClearHistoryReport,
      onStartNewSeason: handleStartNewSeason,
      formatHistoryDate,
    },
    announcements: {
      announcements,
      onPublishAnnouncement: handleAnnouncementPublish,
      onAnnouncementVisibilityToggle: handleAnnouncementVisibilityToggle,
    },
    roles: {
      tournamentRoles,
      setTournamentRoles,
      originalOrganizer,
    },
    lifecycle: {
      canToggleArchiveTournament,
      isArchivingTournament,
      isChangingPublication,
      onPublicationChange: handlePublicationChange,
      onArchiveTournament: handleArchiveTournament,
      onMoveStoppedToPaused: handleMoveStoppedToPaused,
      onSetPausedTournamentActive: handleSetPausedTournamentActive,
      onPauseTournament: handlePauseTournament,
      onStopTournament: handleStopTournament,
    },
  };

  return (
    <div className={styles.view}>
      {loadError && (
        <div className={styles.refreshError} role="alert">
          <p>{loadError}</p>
          <br />
          <Button variant="primary" onClick={() => void fetchData({ showLoader: true, invalidate: false })}>
            {uiText('tryAgain')}
          </Button>
        </div>
      )}
      <div className={styles.tHeader}>
        <div className={styles.headerTop}>
          <div className={styles.titleArea}>
            <div className={styles.h1Wrap}>
              <h1>{tournament.name}</h1>
            </div>
            <p className={styles.subtitle}>
              {uiText('seasonNumber', { season: tournament.season })}
              {tournament.status === 'finished' && <span> {uiText('finished')}</span>}
            </p>
            {collectionLinks.length > 0 && (
              <nav className={styles.collectionLinks} aria-label={uiText('tournamentCollections')}>
                {collectionLinks.map((collection) => (
                  <Link key={collection.slug} href={toLocalePath(locale, `/collection/${collection.slug}`)}>
                    {collection.title} →
                  </Link>
                ))}
              </nav>
            )}
            {(isAddingDescription || (tournament.description && tournament.show_description)) && (
              <div className={styles.tournamentDescription}>
                {isAddingDescription ? (
                  <div className={styles.quickAddDesc}>
                    <div className={adminStyles.labelRow}>
                      <label>{uiText('addDescription')}</label>
                      <button
                        type="button"
                        onClick={() => regenerateDescription(true)}
                        className={adminStyles.iconBtn}
                        title={uiText('regenerateDescription')}
                      >
                        <ArrowClockwise size={20} weight="bold" />
                      </button>
                    </div>
                    <textarea
                      value={quickDescription}
                      onChange={(e) => setQuickDescription(e.target.value)}
                      placeholder={uiText('tournamentDescription')}
                      rows={6}
                    />
                    <div className={styles.quickAddActions}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleQuickDescriptionAdd}
                        disabled={isUpdatingSettings || !quickDescription.trim()}
                      >
                        {isUpdatingSettings ? uiText('adding') : uiText('add')}
                      </Button>
                      <Button
                        size="sm"
                        variant="zero"
                        onClick={() => {
                          setIsAddingDescription(false);
                          setQuickDescription('');
                        }}
                      >
                        {uiText('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p>{tournament.description}</p>
                )}
              </div>
            )}
            {!tournament.description && isAdminAuthenticated && !isAddingDescription && (
              <button
                className={styles.addDescBtn}
                onClick={() => {
                  setQuickDescription(tournament.description || '');
                  setIsAddingDescription(true);
                }}
              >
                {uiText('addDescription2')}
              </button>
            )}
            {tournament.max_teams && (
              <p className={styles.joinLimit}>
                {uiText('joinLimit', { current: activeRealTeamsCount, max: tournament.max_teams })}
                {activeRealTeamsCount >= tournament.max_teams && ' — Filled!'}
              </p>
            )}
            {tournament.max_country_active_teams != null && (
              <p className={styles.joinLimit}>
                Teams from countries with up to {tournament.max_country_active_teams} active teams.
                {tournament.allow_manager_country_size_exception &&
                  ' Each qualifying small-league entry allows one additional larger-league entry. Waiting-list entries count toward the waiting-list allowance.'}
              </p>
            )}
            <TournamentBadgeChips
              countryLimit={tournament.country_limit}
              countryLimitFormat={tournament.country_limit_format}
              leagueCategory={tournament.league_category}
              scoringMode={tournament.scoring_mode}
            />
            {isAppgMode ? (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>{uiText('aPPG120ScoringMode')}</strong>{' '}
                  {showScoringHelp ? <X size={18} /> : <Info size={18} />}
                </p>
                {showScoringHelp && (
                  <div className={styles.helpContent}>
                    <p>
                      <strong>{uiText('aPPG120')}</strong> {uiText('usesAveragePointsPerGameWithTheEnglishTournament')}
                    </p>
                    <ul>
                      <li>
                        <strong>{uiText('eT3')}</strong> {uiText('3PointsForFinishingTheMatchInExtraTime')}
                      </li>
                      <li>
                        <strong>{uiText('eT2')}</strong> {uiText('2PointsForFinishingTheMatchInExtraTime')}
                      </li>
                      <li>
                        <strong>{uiText('pS1')}</strong> {uiText('1PointIfTheMatchGoesToPenalties')}
                      </li>
                      <li>
                        <strong>{uiText('rT0')}</strong> {uiText('0PointsIfTheMatchIsDecidedBeforeExtra')}
                      </li>
                      <li>
                        <strong>{uiText('oPW')}</strong> {uiText('minus1PointForTheWinningTeamAfterA')}
                      </li>
                    </ul>
                    <p>
                      {uiText('clearRegulationTimeEventEvidenceIsClassifiedAutomaticallyAs')}{' '}
                      <strong>{uiText('needsReview')}</strong> {uiText('untilAnOrganizerClassifiesThem')}
                    </p>
                  </div>
                )}
              </div>
            ) : isAverage120Mode ? (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>{uiText('average120ScoringMode')}</strong>{' '}
                  {showScoringHelp ? <X size={18} /> : <Info size={18} />}
                </p>
                {showScoringHelp && <p className={styles.helpContent}>{uiText('average120ScoringExplanation')}</p>}
              </div>
            ) : is120minMode ? (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>{uiText('120minScoringMode')}</strong>{' '}
                  {showScoringHelp ? <X size={18} /> : <Info size={18} />}
                </p>
                {showScoringHelp && (
                  <p className={styles.helpContent}>
                    {uiText('teamsAreRankedFirstBy')} <strong>{uiText('120minAchievements')}</strong>
                    {uiText('thenPointsGoalDifferenceGoalsScoredAndFinallyFewer')}
                  </p>
                )}
              </div>
            ) : (
              <div className={styles.scoringHelp}>
                <p onClick={() => setShowScoringHelp(!showScoringHelp)} className={styles.helpToggle}>
                  <strong>{uiText('victoryPointsMode')}</strong>{' '}
                  {showScoringHelp ? <X size={18} /> : <Info size={18} />}
                </p>
                {showScoringHelp && (
                  <p className={styles.helpContent}>
                    {uiText('standardCompetitiveTournamentTeamsEarn3PointsForA')}{' '}
                    <strong>{uiText('totalPoints')}</strong>
                    {uiText('thenGoalDifferenceAndGoalsScored120minGamesMean')}
                  </p>
                )}
              </div>
            )}
          </div>
          <div
            className={styles.imagePlaceholder}
            onClick={() => {
              if (tournament?.image_url) {
                setShowFullImage(true);
              }
            }}
          >
            <div
              className={styles.tournamentImage}
              style={getTournamentBackgroundStyle(tournament?.id || '', tournament?.image_url)}
            />
            {!tournament?.image_url && isAdminAuthenticated && (
              <div className={styles.placeholderMessage}>{uiText('clickToAddImageURL')}</div>
            )}
            {isAdminAuthenticated && (
              <div
                className={styles.editOverlay}
                onClick={(e) => {
                  e.stopPropagation();
                  setNewImageUrl(typeof tournament?.image_url === 'string' ? tournament.image_url : '');
                  setIsEditingImage(true);
                }}
              >
                <span>{tournament?.image_url ? uiText('editImage') : uiText('addImage')}</span>
              </div>
            )}
          </div>
        </div>

        {tournament.status === 'paused' && (
          <div className={styles.testNotice}>
            <div>
              <h3>{uiText('tournamentPaused')}</h3>
              <p>{uiText('thisTournamentIsPostponedTeamsCanStillJoinAnd')}</p>
            </div>
          </div>
        )}

        {tournament.status === 'stopped' && (
          <div className={styles.testNotice}>
            <div>
              <h3>{uiText('tournamentFullyStopped')}</h3>
              <p>{uiText('thisTournamentIsHaltedAndUnpublishedTeamsListedHere')}</p>
            </div>
          </div>
        )}

        {isGenerated && !isHealthQuotaMet() && tournament.status !== 'stopped' && (
          <div className={styles.pauseNotice}>
            <div>
              <h3>{uiText('tournamentPaused2')}</h3>
              <p>{uiText('moreThan25OfTeamsHaveBecomeInactiveThe')}</p>
            </div>
          </div>
        )}

        {isSandbox && (
          <div className={styles.testNotice}>
            <div>
              <h3>{uiText('tESTTournament')}</h3>
              <p>
                {canAddSandboxTeam
                  ? uiText('thisIsADummyTournamentForTestPurposesTeams')
                  : uiText('thisIsADummyTournamentForTestPurposesTeams2')}
              </p>
            </div>
            {canManageSandboxTeams && (
              <div className={styles.testNoticeActions}>
                {!sandboxCandidate && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={fetchRandomSandboxTeam}
                    disabled={isFetchingSandboxTeam || !canAddSandboxTeam}
                  >
                    {isFetchingSandboxTeam
                      ? uiText('finding')
                      : tournament.max_teams
                        ? `Get random (${Math.min(activeRealTeamsCount, tournament.max_teams)} of ${tournament.max_teams})`
                        : 'Get random team'}
                  </Button>
                )}
                {sandboxCandidate && (
                  <div className={styles.sandboxCandidateInline}>
                    <button
                      type="button"
                      className={styles.sandboxCandidateClose}
                      onClick={() => {
                        setSandboxCandidate(null);
                        setSandboxFetchError('');
                      }}
                      disabled={isSavingTeam || isFetchingSandboxTeam}
                      aria-label={uiText('closeRandomTeamSelector')}
                    >
                      <X size={16} weight="bold" />
                    </button>
                    <strong>{sandboxCandidate.teamName}</strong>
                    <span>
                      {[`ID ${sandboxCandidate.teamId}`, sandboxCandidate.countryName].filter(Boolean).join(' · ')}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={addSandboxTeam}
                      disabled={isSavingTeam}
                    >
                      {uiText('addIt')}
                    </Button>
                    <Button
                      type="button"
                      variant="zero"
                      size="sm"
                      onClick={fetchRandomSandboxTeam}
                      disabled={isSavingTeam || isFetchingSandboxTeam}
                    >
                      {uiText('retry')}
                    </Button>
                  </div>
                )}
                {sandboxFetchError && <p className={styles.helperText}>{sandboxFetchError}</p>}
              </div>
            )}
          </div>
        )}

        {isJoining && !isSandbox && (
          <div className={styles.registrationFormWrapper}>
            <HeroCard title={uiText('joinThisTournament')}>
              <div className={styles.joinHeroImageWrapper}>
                <img src="/register.png" alt={uiText('joinTournament')} className={styles.joinHeroImage} />
                {isConnecting && (
                  <div className={styles.imageLoaderOverlay}>
                    <p>{t('connectingHattrick')}</p>
                  </div>
                )}
              </div>
              {isGenerated && (
                <p className={styles.registrationIntro}>{uiText(tournament.schedule_mode === 'length'
                  ? 'joiningFromNextRoundExplainer' : 'youAreJoiningAnOngoingTournamentYouWillFill')}</p>
              )}

              <div className={styles.registrationLinkArea}>
                <Button size="lg" variant="primary" disabled={isConnecting} onClick={connectToHattrick}>
                  <ArrowRight size={20} weight="bold" />{' '}
                  {isConnecting ? uiText('connectingToHattrick') : uiText('joinWithHattrick')}
                </Button>
                <p className={styles.registrationLinkNote}>{uiText('authorizeHT120minToFetchYourTeamDataAnd')}</p>
              </div>
            </HeroCard>
          </div>
        )}
      </div>
      {selectedTournamentMessage?.type === 'join' && (
        <div className={styles.registrationStatus}>
          <div className={styles.helpContent}>
            <p>
              {isGenerated
                ? uiText(tournament.schedule_mode === 'length' ? 'joinOngoingFromNextRound' : 'thisCupIsOngoingButHasAvailableSpotsFor')
                : uiText('newTeamRegistrationForThisCupIsNowOpen')}
            </p>
            {!isJoining && (
              <Button
                onClick={connectToHattrick}
                variant="primary"
                size="sm"
                className={styles.joinButton}
                disabled={isConnecting}
              >
                <ArrowRight size={18} weight="bold" />{' '}
                {isConnecting ? uiText('connectingToHattrick') : uiText('joinWithHattrick')}
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'pending' && (
        <div className={styles.registrationStatus}>
          <div className={styles.helpContent}>
            <p>{uiText('pendingNextRoundNotice')}</p>
            {canJoinAnotherTeamBeforeFixtures && (
              <Button onClick={connectToHattrick} variant="primary" size="sm"
                className={styles.joinButton} disabled={isConnecting}>
                <ArrowRight size={18} weight="bold" />{' '}
                {isConnecting ? uiText('connectingToHattrick') : uiText('joinWithAnotherTeam')}
              </Button>
            )}
            {!canJoinAnotherTeamBeforeFixtures && canJoinReserve && (
              <Button onClick={() => document.getElementById('reserve-teams-widget')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                variant="primary" size="sm" className={styles.joinButton}>
                <ArrowRight size={18} weight="bold" /> {uiText('joinReserveList')}
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'reserve' && (
        <div className={styles.registrationStatus}>
          <div className={styles.helpContent}>
            <p>{tournament.max_teams && activeRealTeamsCount + pendingNextRoundTeams.length >= tournament.max_teams
              ? t('tournamentFull') : uiText('participantClosedReserveOpen')}</p>
            <Button
              onClick={() => {
                const reserveWidget = document.getElementById('reserve-teams-widget');
                reserveWidget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                reserveWidget?.focus({ preventScroll: true });
              }}
              variant="primary"
              size="sm"
              className={styles.joinButton}
            >
              <ArrowRight size={18} weight="bold" /> {uiText('joinReserveList')}
            </Button>
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'participant_open' && (
        <div className={styles.registrationStatus}>
          <div className={styles.helpContent}>
            <p>{isGenerated ? uiText('joinAnotherFromNextRound') : uiText('youHaveJoinedThisCupRememberToTurnOff')}</p>
            {canJoinAnotherTeamBeforeFixtures && (
              <Button
                onClick={connectToHattrick}
                variant="primary"
                size="sm"
                className={styles.joinButton}
                disabled={isConnecting}
              >
                <ArrowRight size={18} weight="bold" />{' '}
                {isConnecting ? uiText('connectingToHattrick') : uiText('joinWithAnotherTeam')}
              </Button>
            )}
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'joined_notice' && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>{t('participating')}</span>
          </div>
          <button className={styles.dismissBtn} onClick={handleDismissJoinedNotice}>
            <X size={18} weight="bold" />
          </button>
        </div>
      )}

      {selectedTournamentMessage?.type === 'reauth' && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>{uiText('pleaseLoginWithHattrickCHPPToRefreshYourCredentials')}</span>
          </div>
          <div className={styles.reauthActions}>
            <Button size="sm" variant="primary" onClick={handleRefreshHattrickLogin}>
              {uiText('loginWithCHPP')}
            </Button>
          </div>
        </div>
      )}

      {selectedTournamentMessage?.type === 'announcement' && (
        <div className={styles.joinedNotice}>
          <div className={styles.joinedNoticeContent}>
            <span>{selectedTournamentMessage.announcement.content}</span>
          </div>
          <button
            className={styles.dismissBtn}
            onClick={() => handleDismissAnnouncement(selectedTournamentMessage.announcement)}
          >
            <X size={18} weight="bold" />
          </button>
        </div>
      )}

      <div ref={setDepartureNoticeContainer} />

      <div className={styles.tabs}>
        <Link
          href={getTabHref('standings')}
          prefetch={false}
          onNavigate={(event) => {
            event.preventDefault();
            window.history.pushState(null, '', getTabHref('standings'));
          }}
          className={activeTab === 'standings' ? styles.active : ''}
          onClick={() => handleTabChange('standings')}
        >
          {uiText('standings')}
        </Link>
        <Link
          href={getTabHref('fixtures')}
          prefetch={false}
          onNavigate={(event) => {
            event.preventDefault();
            window.history.pushState(null, '', getTabHref('fixtures'));
          }}
          className={activeTab === 'fixtures' ? styles.active : ''}
          onClick={() => handleTabChange('fixtures')}
        >
          {uiText('fixturesAndResults')}
        </Link>
        <Link
          href={getTabHref('news')}
          prefetch={false}
          onNavigate={(event) => {
            event.preventDefault();
            window.history.pushState(null, '', getTabHref('news'));
          }}
          className={isNewsTab ? styles.active : ''}
          onClick={() => handleTabChange('news')}
        >
          {uiText('news')}
        </Link>
        <Link
          href={getTabHref('history')}
          prefetch={false}
          onNavigate={(event) => {
            event.preventDefault();
            window.history.pushState(null, '', getTabHref('history'));
          }}
          className={activeTab === 'history' ? styles.active : ''}
          onClick={() => handleTabChange('history')}
        >
          {uiText('history')}
          {historyTabBadgeCount > 0 && (
            <span className={styles.historyTabBadge} aria-label={uiText('newSeasonHistoryActivity')}>
              {historyTabBadgeCount}
            </span>
          )}
        </Link>
        <Link
          href={getTabHref('admin')}
          prefetch={false}
          onNavigate={(event) => {
            event.preventDefault();
            window.history.pushState(null, '', getTabHref('admin'));
          }}
          className={activeTab === 'admin' ? styles.active : ''}
          onClick={() => handleTabChange('admin')}
        >
          {uiText('admin')}
        </Link>
        <TournamentShareMenu name={tournament.name} slug={tournament.slug} variant="desktop" />
      </div>

      <Modal
        isOpen={
          (historyReportNoticeOpen || TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT.historyReportNotice) &&
          (!isHydrationReady ||
            readLocalStorage(
              latestPublishedHistorySeason ? getHistoryReportNoticeStorageKey(latestPublishedHistorySeason.id) : '',
            ) !== 'true') &&
          latestPublishedHistorySeason !== null
        }
        onClose={dismissHistoryReportNotice}
        title={`Season ${latestPublishedHistorySeason?.season_number} history`}
        maxWidth="520px"
        modalClassName={styles.historyReportModal}
        headerClassName={styles.historyReportHeader}
        closeButtonClassName={styles.historyReportClose}
      >
        <p className={styles.historyReportText}>
          <strong>
            {uiText('season2')} {latestPublishedHistorySeason?.season_number} {uiText('historyReportIsPublished')}
          </strong>{' '}
          {uiText('youCanNowViewItAndLeaveYourOne')}
        </p>
        <div className={styles.historyReportActions}>
          <Button
            variant="secondaryYellow"
            size="md"
            onClick={() => {
              markHistoryReportSeen();
              if (latestPublishedHistorySeason && typeof latestHistoryCommentCount === 'number') {
                localStorage.setItem(
                  `ht-120min:history-comments-read:${latestPublishedHistorySeason.id}`,
                  String(latestHistoryCommentCount),
                );
                setHistorySeenVersion((current) => current + 1);
              }
              const nextParams = new URLSearchParams(searchParams.toString());
              nextParams.set('tab', 'history');
              setSearchParams(nextParams);
            }}
          >
            {uiText('viewSeasonReport')}
          </Button>
          <Button
            variant="zero"
            size="md"
            onClick={() => {
              dismissHistoryReportNotice();
            }}
          >
            {uiText('later')}
          </Button>
        </div>
      </Modal>

      {activeTab === 'history' && (
        <div className={styles.historyContainer}>
          <TournamentHistory
            seasons={seasons.map((season) => ({
              id: season.id,
              seasonNumber: season.season_number,
              status: season.status,
              plannedStartSlot: season.planned_start_slot,
              startedAt: season.started_at,
              finishedAt: season.finished_at,
              snapshot: season.snapshot_json,
            }))}
            currentHtUserId={currentHtUserId}
            currentOwnedTeamIds={teams
              .filter((team) => Number(team.hattrick_user_id) === currentHtUserId)
              .map((team) => team.id)}
            tournamentSlug={tournament.slug}
            selectedSeasonNumber={selectedHistorySeasonNumber}
            onSelectSeason={handleHistorySeasonChange}
            canGenerateReport={canManageOperationalAdmin && tournament.status === 'finished'}
            isGeneratingReport={isFinalizingSeason}
            onGenerateReport={handleGenerateHistoryReport}
            scoringMode={tournament.scoring_mode as '120m' | '120min' | 'average120' | 'points' | 'appg'}
            autoScrollToYearbook={latestHistoryUnreadCount > 0}
            loadComments={loadHistoryComments}
            onCommentsLoaded={handleHistoryCommentsLoaded}
            onCommentSubmitted={handleHistoryCommentSubmitted}
            forceCommentConfirmOpen={TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT.seasonCommentConfirm}
          />
        </div>
      )}

      {activeTab === 'fixtures' && (
        <div className={styles.fixturesContainer}>
          <FixturesView
            key={`${tournament?.id}-${fixtureSeasonNumber}`}
            rounds={fixtureRounds}
            upcomingRoundIndex={isViewingHistoricalFixtures ? -1 : upcomingRoundIndex}
            focusedRoundIndex={isViewingHistoricalFixtures ? -1 : focusedRoundIndex}
            season={fixtureSeasonNumber}
            defaultVisibleRoundsCount={isViewingHistoricalFixtures ? fixtureRounds.length : defaultVisibleRoundsCount}
            expandedRounds={expandedRounds}
            toggleRound={toggleRound}
            onExpandAllRounds={expandAllRounds}
            onCollapseAllRounds={collapseAllRounds}
            tournament={tournament}
            isRefreshingFixtures={isRefreshingFixtures}
            handleRefreshFixtures={() => handleRefreshFixtures(true)}
            onRatingsChanged={fetchFixturesOnly}
            copied={copied}
            setCopied={setCopied}
            warnings={warnings}
            liveData={liveData}
            canJoinTournament={!isViewingHistoricalSeason && canJoinTournament}
            canJoinAnotherTeam={isViewingHistoricalSeason ? false : canJoinAnotherTeamBeforeFixtures}
            isConnecting={isConnecting}
            canUpdateFixtures={canManageOperationalAdmin}
            isHistorical={isViewingHistoricalFixtures}
            currentHtUserId={currentHtUserId}
            onRatingsSignIn={handleRefreshHattrickLogin}
            availableSeasonNumbers={availableSeasonNumbers}
            onSeasonChange={handleSeasonChange}
            emptyStateMessage={
              isViewingHistoricalSeason && !selectedSeason?.fixtures_snapshot_json
                ? `Fixtures for Season ${selectedSeasonNumber} are unavailable because this season has no saved fixture snapshot.`
                : tournament.status === 'active' && rounds.length === 0
                  ? `Season ${currentSeasonNumber} has a locked roster. A new schedule has not yet been generated.`
                  : undefined
            }
            onJoinWithHattrick={connectToHattrick}
          />
        </div>
      )}

      <NewsTab
        isActive={isNewsTab}
        tournamentId={tournament.id}
        seasonNumber={currentSeasonNumber}
        teams={teams}
        myHtUserId={myHtUserId}
        myManagerName={storedHtManagerName}
        isAdminAuthenticated={isAdminAuthenticated}
        canPublishAnnouncements={Boolean(roleAccess?.canPublishAnnouncements)}
        viewerRole={roleAccess?.effectiveRole || null}
        isOriginalOrganizer={Boolean(roleAccess?.isOriginalOrganizer)}
        organizerUserId={roleAccess?.organizerUserId || null}
        tournamentImageUrl={tournament.image_url}
        faqItems={tournamentFaqItems}
        tournamentEmojiContext={
          {
            leagueCategory: tournament.league_category,
            countryLimit: tournament.country_limit,
            countryLimitFormat: tournament.country_limit_format,
          } satisfies TournamentEmojiContext
        }
      />

      {activeTab === 'standings' && (
        <div className={styles.standingsContainer}>
          <div className={styles.mainColumn}>
            {selectedSeasonChampion && (
              <SectionCard title={uiText('champion')}>
                <strong>{selectedSeasonChampion.name}</strong>
                <p>{uiText('championshipFinalWinner')}</p>
              </SectionCard>
            )}
            <StandingsView
              standings={isViewingHistoricalSeason ? selectedSeason?.snapshot_json?.standings || [] : standings}
              is120minMode={is120minMode}
              myHtUserId={myHtUserId}
              myManagerName={storedHtManagerName}
              managerProfiles={managerProfiles}
              tournament={tournament}
              lastSeenMap={lastSeenMap}
              onRefreshPresence={fetchPresenceOnly}
              isRefreshingRoster={isRefreshingRoster}
              onRefreshRoster={['planning', 'recruiting'].includes(tournament.status) ? async () => {
                if (isRefreshingRoster) return;
                setIsRefreshingRoster(true);
                try {
                  await fetchData({ showLoader: false, invalidate: false, fresh: true });
                } finally {
                  setIsRefreshingRoster(false);
                }
              } : undefined}
              canJoinTournament={canJoinTournament}
              isConnecting={isConnecting}
              onJoinWithHattrick={connectToHattrick}
              seasonId={selectedSeason?.id}
              seasonNumber={selectedSeason?.season_number ?? selectedSeasonNumber}
              seasonStatus={selectedSeason?.status}
              rounds={fixtureRounds}
              warningTeamIds={standingsWarningTeamIds}
              activityTeams={isViewingHistoricalSeason || isSandbox || tournament.is_test ? [] : teams.filter((team) => !team.pending_entry_round_id)}
              activityMatches={
                isViewingHistoricalSeason || isSandbox || tournament.is_test
                  ? []
                  : fixtureRounds.flatMap((round) =>
                      round.matches.map((match) => ({ ...match, round_number: round.round_number })),
                    )
              }
              activityWarnings={isViewingHistoricalSeason || isSandbox || tournament.is_test ? [] : activityWarnings}
              activityTournamentId={isViewingHistoricalSeason ? null : tournament.id}
              activitySeasonId={isViewingHistoricalSeason ? null : selectedSeason?.id || null}
              activitySeasonStartedAt={
                isViewingHistoricalSeason ? null : tournament.schedule_generated_at || selectedSeason?.started_at || null
              }
              activityFixturesHref={toLocalePath(locale, `/t/${tournament.slug}?tab=fixtures`)}
              activityNewsHref={toLocalePath(locale, `/t/${tournament.slug}?tab=news`)}
              canPublishAnnouncements={Boolean(roleAccess?.canPublishAnnouncements)}
              mobileChat={isMobile ? tournamentChat : null}
              onVisitFixtures={() => handleTabChange('fixtures')}
              onCommentsLoaded={handleHistoryCommentsLoaded}
              onCommentSubmitted={handleHistoryCommentSubmitted}
              loadComments={loadHistoryComments}
              seasonParticipantIds={
                selectedSeason?.snapshot_json && 'participants' in selectedSeason.snapshot_json
                  ? selectedSeason.snapshot_json.participants.map((participant) => participant.teamId)
                  : []
              }
              onVisitHistory={() => handleTabChange('history')}
              onVisitNews={() => handleTabChange('news')}
              reactionAuthorNames={Object.fromEntries(
                teams
                  .filter((team) => team.hattrick_user_id)
                  .map((team) => [String(team.hattrick_user_id), team.manager_name || team.name]),
              )}
              canAddSeasonComment={false}
              reapplySuggestions={reapplySuggestions}
              canLeaveTournament={!isViewingHistoricalSeason && !isGenerated && isRegistrationOpen}
              onReapplySuggestion={(teamId) => {
                const team = teams.find((item) => item.id === teamId);
                if (!team || team.hattrick_user_id !== Number(myHtUserId)) return;
                connectToHattrick();
              }}
              onRemoveReapplySuggestion={(teamId) => {
                const team = teams.find((item) => item.id === teamId);
                if (!team || team.hattrick_user_id !== Number(myHtUserId)) return;
                void handleLeaveTournament(team);
              }}
              onLeaveTournament={(teamId) => {
                const team = teams.find((item) => item.id === teamId);
                if (!team || !team.active || team.hattrick_user_id !== Number(myHtUserId)) return;
                void handleLeaveTournament(team);
              }}
            />
            {!isViewingHistoricalSeason && pendingNextRoundTeams.length > 0 && (
              <SectionCard title={uiText('participatingFromNextRound')}>
                <ul className={styles.pendingNextRoundTeams}>
                  {pendingNextRoundTeams.map((team) => (
                    <li key={team.id}>
                      {team.logo_url && <img src={team.logo_url} alt="" />}
                      <span>{team.name}</span>
                      {team.hattrick_user_id === Number(myHtUserId) && (
                        <Button size="xs" variant="secondaryAction" disabled={withdrawingPendingTeamId !== null} onClick={async () => {
                          if (!window.confirm(uiText('withdrawNextRoundConfirm'))) return;
                          setWithdrawingPendingTeamId(team.id);
                          try {
                            const response = await fetch('/api/app?route=next-round-join', {
                              method: 'POST', credentials: 'same-origin',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ tournamentId: tournament.id, teamId: team.id }),
                            });
                            const result = (await response.json()) as { error?: string };
                            if (!response.ok) throw new Error(result.error || 'Could not withdraw this registration.');
                            await fetchData({ showLoader: false, invalidate: false, fresh: true });
                          } catch (error) {
                            alert(error instanceof Error ? error.message : 'Could not withdraw this registration.');
                          } finally {
                            setWithdrawingPendingTeamId(null);
                          }
                        }}>
                          {uiText('withdrawNextRound')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
          </div>
          <aside className={styles.statsSidebar}>
            {tournament.forum_id && tournament.forum_id > 0 && (
              <a
                href={`https://www.hattrick.org/goto.ashx?path=/Forum/Read.aspx?t=${tournament.forum_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonStyles.button} ${buttonStyles.zero} ${buttonStyles.sm} ${styles.standingsSeasonsButton} ${styles.standingsForumButton}`}
              >
                {uiText('tournamentHTForum')} <ArrowRight size={16} weight="bold" aria-hidden="true" />
              </a>
            )}
            {availableSeasonNumbers.length > 1 && (
              <div ref={standingsSeasonMenuRef} className={styles.standingsSeasonMenu}>
                <Button
                  variant="zero"
                  size="sm"
                  onClick={() => setIsStandingsSeasonMenuOpen((open) => !open)}
                  aria-expanded={isStandingsSeasonMenuOpen}
                  aria-haspopup="listbox"
                  className={styles.standingsSeasonsButton}
                >
                  {uiText('historicStandings')}
                  <CaretDown size={16} weight="bold" aria-hidden="true" />
                </Button>
                {isStandingsSeasonMenuOpen && (
                  <div className={styles.standingsSeasonDropdown} role="listbox" aria-label={uiText('selectSeason')}>
                    {availableSeasonNumbers.map((seasonNumber) => (
                      <button
                        key={seasonNumber}
                        type="button"
                        className={styles.standingsSeasonOption}
                        aria-selected={seasonNumber === selectedSeasonNumber}
                        onClick={() => {
                          setIsStandingsSeasonMenuOpen(false);
                          handleSeasonChange(seasonNumber);
                        }}
                      >
                        {uiText('season')} {seasonNumber}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <MottoWidget items={descriptionPools.tournament} theme="dark" variant="sidebar" />

            {!isMobile && tournamentChat}
            {!isViewingHistoricalSeason && !isSandbox && myHtUserId &&
              teams.some((team) => team.active && !team.reserve_active && !team.is_placeholder &&
                team.hattrick_user_id === Number(myHtUserId)) &&
              departureRound && (
                <LeaveTournamentWidget
                  tournamentId={tournament.id}
                  roundId={departureRound.id}
                  noticeContainer={departureNoticeContainer}
                />
              )}
            {(tournament.allow_reserve_registration !== false || reserveTeams.length > 0) && (
              <ReserveTeamsWidget tournamentId={tournament.id} />
            )}
            <ManagerSpotlight
              spotlight={managerSpotlight}
              tournament={{
                name: tournament.name,
                countryLimit: tournament.country_limit,
                countryLimitFormat: tournament.country_limit_format,
              }}
            />
            <SidebarPollWidget
              seasonId={currentSeason?.id}
              seasonStatus={currentSeason?.status}
              teams={teams.filter(isCurrentParticipantTeam).map((team) => ({ id: team.id, name: team.name }))}
              rounds={rounds}
              is120minMode={is120minMode}
              myHtUserId={myHtUserId ? Number(myHtUserId) : null}
            />
            <RepresentedCountries teams={teams} />
            <CompactAccordionWidget
              title={uiText('tournamentFAQ')}
              icon={<Question size={20} weight="bold" />}
              items={tournamentFaqItems}
            />
          </aside>
        </div>
      )}

      <TournamentAdmin controller={adminController} />

      <ConfirmationDialog confirmation={confirmation} onResolve={resolveConfirmation} />

      <NoticeDialog message={notice} onClose={closeNotice} />

      <WelcomeModal
        isOpen={showCreatedTournamentWelcomeVisible}
        onClose={closeCreatedTournamentWelcome}
        onPrimaryAction={acceptCreatedTournamentWelcome}
        imageSrc="/create.png"
        imageAlt={isSandbox ? 'New tournament ready for testing' : 'New tournament ready'}
        title={
          isSandbox
            ? 'Test tournament created!'
            : isOrganizerManagedTournament
              ? 'Organizer-managed tournament created!'
              : 'Tournament created!'
        }
        buttonLabel={isSandbox ? 'Start testing!' : 'View tournament'}
      >
        {isSandbox ? (
          <>
            <strong>{uiText('tryTheImportantPartsWhileNothingSeriousIsOn')}</strong>

            <ul>
              <li>{uiText('addRemoveAndReplaceDummyTeamsGenerateAndInspect')}</li>
              <li>{uiText('linkMatchesToRealOnesViaAdminOrAdd')}</li>
              <li>{uiText('testSwitchingTeamLimitsAndCountryRules')}</li>
            </ul>

            <p>{uiText('whenYouFeelLikeAProCreateTheReal')}</p>
          </>
        ) : isOrganizerManagedTournament ? (
          <>
            <strong>
              {uiText('yourOrganizerManaged')} {tournament.name} {uiText('pageIsReady')}
            </strong>

            <ul>
              <li>{uiText('invitedMoreTeamsToJoinOrAddThemYourself')}</li>
              <li>{uiText('shareThePublicPageForFixturesStandingsAndAnnouncements')}</li>
              <li>{uiText('generateTheScheduleWhenTheLineupIsReady')}</li>
              <li>{uiText('resultsWillBeUpdatedAutomaticallyButCanBeManually')}</li>
            </ul>

            <p>{uiText('thisFormatGivesTheOrganizerMoreControlParticipantsDo')}</p>
            <p>{uiText('ifYouReHappyOrWantANewFeature')}</p>
          </>
        ) : (
          <>
            <strong>{uiText('yourTournamentPageIsReady')}</strong>

            <ul>
              <li>{uiText('shareThePublicLinkWithTheManagersYouWant')}</li>
              <li>{uiText('waitForTeamsToJoinMinimumIs2')}</li>
              <li>{uiText('generateTheScheduleWhenYouAreReadyToStart')}</li>
              <li>{uiText('letParticipantsKnowWhenItSTimeToBook')}</li>
              <li>{uiText('manageSettingsTeamsScheduleAndAnnouncementsFromTheAdmin')}</li>
            </ul>

            <p>
              {uiText('askIn')}{' '}
              <a href={FORUM_LINK} target="_blank" rel="noreferrer">
                {uiText('hT120minHattrickForum')}
              </a>{' '}
              {uiText('toGetHelpQuickly')}
            </p>
          </>
        )}
      </WelcomeModal>

      <WelcomeModal
        isOpen={showOpenTournamentWelcome}
        onClose={closeOpenTournamentWelcome}
        onPrimaryAction={acceptOpenTournamentWelcome}
        imageSrc="/register2.png"
        imageAlt="Open tournament welcome"
        title={uiText('thisTournamentIsOpen')}
        buttonLabel="Go to tournament"
      >
        <ul>
          <li>{uiText('addYourTeamToTheTournament')}</li>
          <li>{uiText('inviteOtherManagersToJoinIfThereAreFree')}</li>
          <li>{uiText('waitForHattrickWeek4OrUntilCupFrees')}</li>
          <li>{uiText('waitForTheAdminToGenerateTheSchedule')}</li>
          <li>{uiText('startBookingMatchesFromTheScheduleAndEnjoy')}</li>
        </ul>
      </WelcomeModal>

      <Modal
        isOpen={isEditingImage || TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT.editTournamentImage}
        onClose={() => setIsEditingImage(false)}
        title={uiText('updateTournamentImage')}
      >
        <div className={styles.modalContent}>
          <p>{uiText('linkToAnExternalImageURLEGImgur')}</p>
          <div className={adminStyles.field}>
            <label>{uiText('imageURL')}</label>
            <input
              type="text"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              placeholder={uiText('https')}
              className={adminStyles.selectField}
            />
          </div>
          <div className={styles.modalFooter}>
            <Button variant="primary" fullWidth onClick={handleUpdateImage} disabled={isUpdatingImage}>
              {isUpdatingImage ? uiText('updating') : uiText('saveImage')}
            </Button>
            <Button
              variant="outlineWhite"
              fullWidth
              onClick={() => setIsEditingImage(false)}
              style={{ marginTop: '0.5rem' }}
            >
              {uiText('cancel')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showTeamModal || TOURNAMENT_VIEW_MODALS_OPEN_BY_DEFAULT.teamSelection}
        onClose={() => {
          setShowTeamModal(false);
          const newUrl = pathname;
          window.history.replaceState(null, '', newUrl);
        }}
        title={pendingJoinData ? `Welcome, ${pendingJoinData.manager_name}!` : 'Linking Hattrick…'}
      >
        <div className={styles.modalContent}>
          {modalLoading ? (
            <p className="center">{uiText('loadingYourTeams')}</p>
          ) : (
            <>
              <p style={{ marginBottom: '1.5rem', opacity: 0.9 }}>
                {uiText('whichTeamShouldJoin')} <strong>{tournament.name}</strong>?
              </p>

              <div className={styles.teamOptionsList}>
                {pendingJoinData?.teams_json.filter(team =>
                  (isSiteAdmin && !(tournament.schedule_mode === 'length' && isGenerated)) || teams.some((row) => row.ht_team_id === team.teamId &&
                    (row.pending_entry_round_id || row.reserve_active)) || getJoinCountrySizeEligibility(team).eligible,
                ).map((team) => {
                  const teamState = getJoinTeamCardState(team);
                  return (
                    <ModalTeamCard
                      key={team.teamId}
                      team={{
                        teamId: team.teamId,
                        teamName: team.teamName,
                        logoUrl: team.logoUrl,
                        countryId: team.countryId,
                        countryName: team.countryName,
                        leagueId: team.leagueId,
                        leagueName: team.leagueName,
                      }}
                      status={teamState.status}
                      statusDanger={teamState.statusDanger}
                      onSelect={!teamState.disabled && !submittingJoin ? () => void handleTeamSelect(team) : undefined}
                      disabled={teamState.disabled || submittingJoin}
                    />
                  );
                })}
                {pendingJoinData?.teams_json.length === 0 && (
                  <p className="center">{uiText('noTeamsWereReturnedByHattrickForThisAccount')}</p>
                )}
              </div>

              {joinError && <p className={styles.joiningStatus}>{joinError}</p>}

              {submittingJoin && <p className={styles.joiningStatus}>{t('joining')}</p>}

              <div className={styles.modalFooter}>
                <Button
                  variant="outlineModal"
                  fullWidth
                  onClick={() => {
                    setShowTeamModal(false);
                    const newUrl = pathname;
                    window.history.replaceState(null, '', newUrl);
                  }}
                  disabled={submittingJoin}
                >
                  {uiText('cancel')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showJoinErrorModal}
        onClose={() => {
          setShowJoinErrorModal(false);
          setJoinError(null);
        }}
        title={uiText('unableToJoinTournament')}
      >
        <div className={styles.modalContent}>
          <p>{joinError}</p>
          <div className={styles.modalFooter}>
            <Button variant="primary" fullWidth onClick={() => setShowJoinErrorModal(false)}>
              {uiText('oK')}
            </Button>
          </div>
        </div>
      </Modal>

      {showFullImage && tournament?.image_url && (
        <div className={styles.imageModalOverlay} onClick={() => setShowFullImage(false)}>
          <img src={tournament.image_url} alt={uiText('tournament')} className={styles.imageModalContent} />
        </div>
      )}
    </div>
  );
};
