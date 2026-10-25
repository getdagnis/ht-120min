'use client';

import { useTranslations } from 'next-intl';
import { normalizeTournamentTheme } from '../../../utils/browser-theme';
import type { EffectiveTheme } from '../../../utils/theme';
import React, { useEffect, useState } from 'react';
import { Tooltip } from '../../Tooltip/Tooltip';
import { Button } from '../../Button/Button';
import { Switch } from '../../Switch/Switch';
import { Modal } from '../../Modal/Modal';
import { SectionCard } from '../../Card/SectionCard';
import { AdminResults, type BulkMatchUpdate } from './AdminResults';
import { AdminAnnouncementComposer } from './AdminAnnouncementComposer';
import { ReserveAdmissionPanel } from './ReserveAdmissionPanel';
import { TournamentSchedulePanel } from './TournamentSchedulePanel';
import { TournamentRolesPanel } from './TournamentRolesPanel';
import { CollectionMembershipPanel } from '../../CollectionMembershipPanel/CollectionMembershipPanel';
import { CompactAccordionWidget } from '../../CompactAccordionWidget/CompactAccordionWidget';
import { ReusableWidget } from '../../ReusableWidget/ReusableWidget';
import { useHydrationReady } from '../../../hooks/useHydratedBrowserState';
import { getCompatibleLeagueRestrictionOptions } from '../../../utils/team-eligibility';
import { formatCalendarDateWithWeek } from '../../../utils/hattrick-calendar';
import { isCurrentParticipantTeam, isPastTeam } from '../../../utils/team-state';
import { normalizeTournamentRegistrationType } from '../../../utils/tournament-types';
import { normalizeLeagueLimit } from '../../../../shared/worlddetails';
import type { TournamentAnnouncement, TournamentAnnouncementVisibility } from '../../../utils/tournament-announcements';
import type { ScheduleDraftPreview } from '../../../utils/schedule-draft';
import type { LengthScheduleDraft } from '../../../utils/length-schedule';
import type { RescheduleDraftPreview } from '../../../utils/reschedule-draft';
import type { ResultCsvRow } from '../../../utils/result-csv';
import { ArrowClockwise, ArrowRight, ArrowUpRight, CopySimple, Info, Question, Star, Trash } from 'phosphor-react';
import adminStyles from '../../../legacy-pages/Public/TournamentAdmin.module.sass';
import styles from '../../../legacy-pages/Public/TournamentView.module.sass';
import type {
  FetchedTeamData,
  HtMatchAddPreview,
  HtMatchLinkPreview,
  MatchWithTeams,
  RoundWithMatches,
  ScheduleSetup,
  Team,
  TeamPlanningStatus,
  Tournament,
  TournamentRoleAccess,
  TournamentSeason,
} from '../../../legacy-pages/Public/TournamentView';
import type { TournamentOwnerRecord, TournamentRoleRecord } from './TournamentRolesPanel';

const DEFAULT_TEAM_LOGO = '/matchKitLarge.png';

const ADMIN_PANELS = [
  { id: 'settings', label: 'Tournament Settings', description: 'General tournament settings' },
  { id: 'schedule', label: 'Generate Schedule', description: 'Generate, reschedule, or add tournament matches' },
  { id: 'results', label: 'Edit Results', description: "Manage current season's fixtures" },
  { id: 'teams', label: 'Manage Teams', description: 'Add new or remove teams' },
  { id: 'season', label: 'Manage Season', description: 'Close or add new seasons, generate season reports' },
  { id: 'announcements', label: 'Cup Announcements', description: 'Create tournament announcements' },
  { id: 'lifecycle', label: 'Tournament status', description: 'Manage tournament status' },
  { id: 'roles', label: 'Roles & Access', description: 'Manage delegated tournament roles' },
] as const;

type AdminPanelId = (typeof ADMIN_PANELS)[number]['id'];
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;
type ScheduleSuggestionFetcher = NonNullable<
  React.ComponentProps<typeof TournamentSchedulePanel>['fetchHtMatchSuggestions']
>;
type ManualRoundsNormalizer = NonNullable<
  React.ComponentProps<typeof TournamentSchedulePanel>['onNormalizeManualRounds']
>;

export interface TournamentAdminController {
  data: {
    activeTab: string;
    tournament: Tournament;
    teams: Team[];
    rounds: RoundWithMatches[];
    seasonSlots: Array<{ id: string; current_team_id: string | null }>;
    fixtureWarningTeamIds: ReadonlySet<string>;
    participantTeams: Team[];
    reserveTeams: Team[];
    activeParticipantCount: number;
    isGenerated: boolean;
    isRegistrationOpen: boolean;
    isSandbox: boolean;
    isStoppedTournament: boolean;
    isValidatedTournament: boolean;
    publicOrganizerName: string | null;
    currentHtManagerName: string;
    isMobile: boolean;
    publicUrl: string;
    publicUrlDisplay: string;
    currentRoundIdForResults: string | undefined;
    previousSeasons: TournamentSeason[];
    currentSeason: TournamentSeason | undefined;
    isCurrentSeasonPlanned: boolean;
    tournamentSettingsFaqItems: Array<{ id: string; title: string; body: string }>;
  };
  access: {
    isAdminAuthenticated: boolean;
    roleAccessLoading: boolean;
    roleAccess: TournamentRoleAccess | null;
    verifiedRoleAccess: boolean;
    canLoginAsOrganizer: boolean;
    verifiedRoleLabel: string;
    isPressOfficer: boolean;
    isSiteAdmin: boolean;
    oauthRoleAccess: boolean;
    canManageOperationalAdmin: boolean;
    canManageSchedule: boolean;
    canManageFeaturedTournaments: boolean;
    canToggleArchiveTournament: boolean;
    adminAccessMode: string;
    adminAccessName: string;
    password: string;
    setPassword: Setter<string>;
    adminAuthError: boolean;
    setAdminAuthError: Setter<boolean>;
    failedLoginAttempt: boolean;
    isResettingAdminPassword: boolean;
    onAdminLogin: (event: React.FormEvent) => void | Promise<void>;
    onOrganizerLogin: (event: React.FormEvent) => void;
    onOrganizerSessionLogin: (event: React.FormEvent) => void;
    onResetAdminPassword: () => void | Promise<void>;
    onAdminLogout: () => void;
    showNotice: (message: string) => void;
  };
  settings: {
    editIsPrivate: boolean;
    setEditIsPrivate: Setter<boolean>;
    editLeagueCategory: 'male' | 'hfi';
    setEditLeagueCategory: Setter<'male' | 'hfi'>;
    editRegistrationType: string;
    setEditRegistrationType: Setter<string>;
    editScoringMode: '120min' | 'average120' | 'points' | 'appg';
    setEditScoringMode: Setter<'120min' | 'average120' | 'points' | 'appg'>;
    editDefaultTheme: EffectiveTheme | null;
    setEditDefaultTheme: Setter<EffectiveTheme | null>;
    editCountryLimit: string | null;
    setEditCountryLimit: Setter<string | null>;
    editMaxCountryActiveTeams: number | null;
    setEditMaxCountryActiveTeams: Setter<number | null>;
    editAllowManagerCountrySizeException: boolean;
    setEditAllowManagerCountrySizeException: Setter<boolean>;
    editMaxTeams: number | null;
    setEditMaxTeams: Setter<number | null>;
    editRegistrationOpen: boolean;
    setEditRegistrationOpen: Setter<boolean>;
    showEditDescription: boolean;
    setShowEditDescription: Setter<boolean>;
    editDescription: string;
    setEditDescription: Setter<string>;
    showEditEmail: boolean;
    setShowEditEmail: Setter<boolean>;
    editAdminEmail: string;
    setEditAdminEmail: Setter<string>;
    editForumId: string;
    setEditForumId: Setter<string>;
    isTest: boolean;
    setIsTest: Setter<boolean>;
    editIsFeatured: boolean;
    setEditIsFeatured: Setter<boolean>;
    isUpdatingSettings: boolean;
    settingsHasUnsavedChanges: boolean;
    unsavedSettingsFields: Record<string, boolean>;
    isStartDateLocked: boolean;
    firstKnownFixtureDate: Date | null;
    scheduleStartSlotId: string;
    setScheduleStartSlotId: Setter<string>;
    scheduleMode: string;
    scheduleSetup: ScheduleSetup;
    setScheduleSetup: Setter<ScheduleSetup>;
    canUpdateSettings: () => void | Promise<void>;
    getActiveTeamRestrictionMismatch: (countryLimit?: string | null) => string | null;
    currentLeagueRestrictionIsCompatible: boolean;
    leagueRestrictionOptions: ReturnType<typeof getCompatibleLeagueRestrictionOptions>;
    regenerateDescription: (isQuick: boolean) => void;
  };
  schedule: {
    scheduleDraft: ScheduleDraftPreview;
    lengthScheduleDraft: LengthScheduleDraft;
    rescheduleDraft: RescheduleDraftPreview;
    activeScheduleTeams: Array<{
      id: string;
      name: string;
      active: boolean;
      isPlaceholder: boolean | undefined;
      countryName: string | null;
      leagueLevel: number | null;
      teamRank: number | null;
    }>;
    usesLengthSchedulePlanner: boolean;
    isGenerating: boolean;
    isRescheduling: boolean;
    isRepairingRound: boolean;
    isRecoveringRoundOne: boolean;
    isScheduleConfirmationOpen: boolean;
    setIsScheduleConfirmationOpen: Setter<boolean>;
    schedulePreflightWarning: string | null;
    scheduleNotice: { title: string; message: string; showMatches?: boolean } | null;
    setScheduleNotice: Setter<{ title: string; message: string; showMatches?: boolean } | null>;
    onScheduleModeChange: (mode: 'single' | 'double' | 'recurring') => void;
    onShuffleScheduleFixtures: () => void;
    onScheduleStartSlotChange: (id: string) => void;
    onIncludeWeek15Change: (value: boolean) => void;
    onRescheduleFromRoundChange: (round: number) => void;
    onRescheduleStartSlotChange: (id: string) => void;
    onIncludeWeek15RescheduleChange: (value: boolean) => void;
    onGenerateSchedule: () => void | Promise<void>;
    onConfirmGenerateSchedule: () => void | Promise<void>;
    onRegenerateSchedule: () => Promise<boolean>;
    onRepairCurrentLengthRound: () => void | Promise<void>;
    onRecoverOriginalLengthRoundOne: () => void | Promise<void>;
    onCloseScheduleNotice: () => void;
    onPreviewHtMatchAdd: (matchId: string) => Promise<HtMatchAddPreview>;
    onSaveHtMatchAdd: (matchId: string, options?: { refreshFixtures?: boolean }) => Promise<undefined>;
    onFetchHtMatchSuggestions: ScheduleSuggestionFetcher;
    includeWeek15WeekendFriendly: boolean;
    includeWeek15WeekendFriendlyForReschedule: boolean;
    setLengthFormatId: Setter<string | null>;
    normalizeManualRounds: ManualRoundsNormalizer;
    fetchFixturesOnly: () => Promise<void>;
  };
  results: {
    editingMatch: string | null;
    setEditingMatch: Setter<string | null>;
    matchData: Record<string, Partial<MatchWithTeams>>;
    setMatchData: Setter<Record<string, Partial<MatchWithTeams>>>;
    isValidatedTournament: boolean;
    isSandbox: boolean;
    onUpdateMatch: (matchId: string) => void | Promise<void>;
    onResetMatchResult: (matchId: string) => Promise<void>;
    onPreviewHtMatchLink: (matchId: string, htMatchId: string) => Promise<HtMatchLinkPreview>;
    onSaveHtMatchLink: (matchId: string, htMatchId: string) => Promise<void>;
    onSaveBulkMatches: (updates: Record<string, BulkMatchUpdate>) => Promise<void>;
    onClearSeasonResults: (() => Promise<void>) | undefined;
    onClearSeasonFixtures: (() => Promise<void>) | undefined;
    onImportCsvRows: (rows: ResultCsvRow[]) => Promise<void>;
    onRemoveFixture: (matchId: string) => Promise<void>;
  };
  teams: {
    newTeamId: string;
    setNewTeamId: Setter<string>;
    newTeamName: string;
    setNewTeamName: Setter<string>;
    isFetchingTeamData: boolean;
    setNewTeamData: Setter<FetchedTeamData | null>;
    isSavingTeam: boolean;
    isReserveTeamFormOpen: boolean;
    setIsReserveTeamFormOpen: Setter<boolean>;
    reserveTeamId: string;
    setReserveTeamId: Setter<string>;
    reserveTeamName: string;
    reserveValidation: { teamId: string; validated: boolean; known: boolean; managerName: string | null } | null;
    onReservesChanged: () => void | Promise<void>;
    setReserveTeamName: Setter<string>;
    teamStatusNotice: string | null;
    isRefreshingTeamStatuses: boolean;
    teamPlanningStatuses: Record<string, TeamPlanningStatus>;
    hfiRankNotice: string | null;
    hfiRankNoticeIsError: boolean;
    isUpdatingHfiRanks: boolean;
    playingElsewhereTeamIds: Set<number>;
    onAddTeam: (event: React.FormEvent, isJoin?: boolean, addAsReserve?: boolean) => void | Promise<void>;
    onFetchTeamData: (htId: string, isReplacement: boolean, isReserve?: boolean) => void | Promise<void>;
    onRefreshTeamPlanningStatuses: () => void | Promise<void>;
    onLoadTeamPlanningStatuses: () => void | Promise<void>;
    onUpdateHfiRanks: () => void | Promise<void>;
    onSetReserveFormOpen: Setter<boolean>;
    reserveReplacingTeamId: string | null;
    setReserveReplacingTeamId: Setter<string | null>;
    selectedReserveTeamId: string;
    setSelectedReserveTeamId: Setter<string>;
    replacingTeamId: string | null;
    setReplacingTeamId: Setter<string | null>;
    replacementHtId: string;
    setReplacementHtId: Setter<string>;
    replacementName: string;
    setReplacementName: Setter<string>;
    onReplaceTeamWithReserve: (formerTeamId: string) => void | Promise<void>;
    onReplaceTeam: (oldTeamId: string) => void | Promise<void>;
    onDeleteTeam: (id: string) => void | Promise<void>;
    onInviteExpandedChange: Setter<boolean>;
    inviteExpanded: boolean;
    onDuplicateAsSandbox: () => void | Promise<void>;
    onRefreshSpotlightProfiles: () => void | Promise<void>;
    isDuplicatingSandbox: boolean;
    isRefreshingSpotlight: boolean;
  };
  seasons: {
    previousSeasons: TournamentSeason[];
    currentSeason: TournamentSeason | undefined;
    isCurrentSeasonPlanned: boolean;
    rebuildingSeasonNumber: number | null;
    isAddingSeason: boolean;
    isFinalizingSeason: boolean;
    canMarkSeasonFinished: boolean;
    onRebuildSeasonSnapshot: (season: TournamentSeason) => void | Promise<void>;
    onStartSeason: () => void | Promise<void>;
    onResetSeasonToPlanning: () => void | Promise<void>;
    onFinishSeason: () => void | Promise<void>;
    onGenerateHistoryReport: () => void | Promise<void>;
    onClearHistoryReport: () => void | Promise<void>;
    onStartNewSeason: (mode: 'auto' | 'open') => void | Promise<void>;
    formatHistoryDate: (value?: string | null) => string | null;
  };
  announcements: {
    announcements: TournamentAnnouncement[];
    onPublishAnnouncement: (input: {
      content: string;
      templateKey: string | null;
      visibility: TournamentAnnouncementVisibility;
    }) => Promise<void>;
    onAnnouncementVisibilityToggle: (announcement: TournamentAnnouncement) => void | Promise<void>;
  };
  roles: {
    tournamentRoles: TournamentRoleRecord[];
    setTournamentRoles: Setter<TournamentRoleRecord[]>;
    originalOrganizer: TournamentOwnerRecord;
  };
  lifecycle: {
    isChangingPublication: boolean;
    onPublicationChange: (target: 'planning' | 'recruiting') => Promise<void>;
    canToggleArchiveTournament: boolean;
    isArchivingTournament: boolean;
    onArchiveTournament: () => void | Promise<void>;
    onMoveStoppedToPaused: () => void | Promise<void>;
    onSetPausedTournamentActive: () => void | Promise<void>;
    onPauseTournament: () => void | Promise<void>;
    onStopTournament: () => void | Promise<void>;
  };
}

const readSessionStorage = (key: string) => (typeof window === 'undefined' ? null : window.sessionStorage.getItem(key));
const readStoredSessionBoolean = (key: string, fallback: boolean) => {
  const value = readSessionStorage(key);
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as boolean;
  } catch {
    return fallback;
  }
};

type DepartureNotice = { teamId: string; teamName: string; needsReview: boolean };

function DepartureNotices({ tournamentId, tournamentSlug }: { tournamentId: string; tournamentSlug: string }) {
  const [notices, setNotices] = useState<DepartureNotice[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/app?route=tournament-team-departure', {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'admin-list',
            tournamentId,
            adminPassword: window.localStorage.getItem(`admin_pw_${tournamentSlug}`) || '',
          }),
        });
        if (!response.ok) return;
        const result = (await response.json()) as { departures?: DepartureNotice[] };
        if (active) setNotices(result.departures || []);
      } catch {
        // Keep the last confirmed notice visible through a transient read error.
      }
    };
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('tournament-departure-updated', refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('tournament-departure-updated', refresh);
      window.clearInterval(interval);
    };
  }, [tournamentId, tournamentSlug]);

  return notices.map((departure) => (
    <div key={departure.teamId} className={adminStyles.departureNotice}>
      {departure.needsReview
        ? `${departure.teamName} requested to leave after the completed round. Departure needs organizer review.`
        : `${departure.teamName} has opted to leave the tournament after this round.`}
    </div>
  ));
}

export const TournamentAdmin: React.FC<{ controller: TournamentAdminController }> = ({ controller }) => {
  const {
    data,
    access,
    settings,
    schedule,
    results,
    teams: teamAdmin,
    seasons,
    announcements: announcementController,
    roles,
    lifecycle,
  } = controller;
  const {
    activeTab,
    tournament,
    teams,
    rounds,
    seasonSlots,
    fixtureWarningTeamIds,
    participantTeams,
    reserveTeams,
    activeParticipantCount,
    isGenerated,
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
  } = data;
  const tournamentAllowsTeamActions = !['finished', 'stopped', 'archived'].includes(tournament.status);
  const {
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
  } = access;
  const {
    editIsPrivate,
    setEditIsPrivate,
    editLeagueCategory,
    setEditLeagueCategory,
    editRegistrationType,
    setEditRegistrationType,
    editDefaultTheme,
    setEditDefaultTheme,
    editScoringMode,
    setEditScoringMode,
    editCountryLimit,
    setEditCountryLimit,
    editMaxCountryActiveTeams,
    setEditMaxCountryActiveTeams,
    editAllowManagerCountrySizeException,
    setEditAllowManagerCountrySizeException,
    editMaxTeams,
    setEditMaxTeams,
    editRegistrationOpen,
    setEditRegistrationOpen,
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
    scheduleSetup,
    setScheduleSetup,
    canUpdateSettings: saveTournamentSettings,
    getActiveTeamRestrictionMismatch,
    currentLeagueRestrictionIsCompatible,
    leagueRestrictionOptions,
    regenerateDescription,
  } = settings;
  const {
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
    onPreviewHtMatchAdd: previewHtMatchAdd,
    onSaveHtMatchAdd: saveHtMatchAdd,
    onFetchHtMatchSuggestions: fetchHtMatchSuggestions,
    includeWeek15WeekendFriendly,
    includeWeek15WeekendFriendlyForReschedule,
    setLengthFormatId,
    normalizeManualRounds,
    fetchFixturesOnly,
  } = schedule;
  const {
    editingMatch,
    setEditingMatch,
    matchData,
    setMatchData,
    onUpdateMatch: updateMatch,
    onResetMatchResult: resetMatchResult,
    onPreviewHtMatchLink: previewHtMatchLink,
    onSaveHtMatchLink: saveHtMatchLink,
    onSaveBulkMatches: saveBulkMatches,
    onClearSeasonResults: clearSeasonResults,
    onClearSeasonFixtures: clearSeasonFixtures,
    onImportCsvRows: importCsvRows,
    onRemoveFixture: removeFixture,
  } = results;
  const {
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
    onReservesChanged,
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
    onLoadTeamPlanningStatuses: loadTeamPlanningStatuses,
    onUpdateHfiRanks: updateHfiRanks,
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
    onDeleteTeam: deleteTeam,
    onInviteExpandedChange: setIsInviteExpanded,
    inviteExpanded: isInviteExpanded,
    onDuplicateAsSandbox: duplicateAsSandbox,
    onRefreshSpotlightProfiles: refreshSpotlightProfiles,
    isDuplicatingSandbox,
    isRefreshingSpotlight,
  } = teamAdmin;
  const {
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
  } = seasons;
  const {
    announcements,
    onPublishAnnouncement: handleAnnouncementPublish,
    onAnnouncementVisibilityToggle: handleAnnouncementVisibilityToggle,
  } = announcementController;
  const { tournamentRoles, setTournamentRoles, originalOrganizer } = roles;
  const {
    isChangingPublication,
    onPublicationChange,
    onArchiveTournament: handleArchiveTournament,
    isArchivingTournament,
    onMoveStoppedToPaused: handleMoveStoppedToPaused,
    onSetPausedTournamentActive: handleSetPausedTournamentActive,
    onPauseTournament: handlePauseTournament,
    onStopTournament: handleStopTournament,
  } = lifecycle;

  const themeText = useTranslations('TournamentView');
  const standingsText = useTranslations('PublicUI.StandingsView');
  const isHydrationReady = useHydrationReady();
  const showLocalSiteAdminSettings =
    isHydrationReady &&
    isSiteAdmin &&
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
  const [showSiteAdminSettings, setShowSiteAdminSettings] = useState(false);
  const [admissionSelection, setAdmissionSelection] = useState<string[]>([]);
  const selectedAdmissionIds = admissionSelection.filter((id) => reserveTeams.some((team) => team.id === id));
  const pastTeams = teams.filter(isPastTeam);
  const [pastTeamsExpanded, setPastTeamsExpanded] = useState<boolean | null>(null);
  const isPastTeamsExpanded = pastTeamsExpanded ?? pastTeams.length <= 8;
  const [changingReserveId, setChangingReserveId] = useState<string | null>(null);
  const [waitingReasons, setWaitingReasons] = useState<Record<string, string>>({});
  useEffect(() => {
    if (canManageOperationalAdmin) void loadTeamPlanningStatuses();
  }, [canManageOperationalAdmin, loadTeamPlanningStatuses, rounds]);
  useEffect(() => {
    if (!canManageOperationalAdmin) return;
    let cancelled = false;
    void fetch(`/api/app?route=team-membership&tournamentId=${encodeURIComponent(tournament.id)}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not check Waiting teams.');
        if (!cancelled)
          setWaitingReasons(
            Object.fromEntries(
              (data.rejected || []).map((row: { teamId: string; reason: string }) => [row.teamId, row.reason]),
            ),
          );
      })
      .catch(() => {
        if (!cancelled) setWaitingReasons({});
      });
    return () => {
      cancelled = true;
    };
  }, [canManageOperationalAdmin, tournament.id, teams]);
  const changeMembership = async (
    team: Team,
    action: 'promote' | 'to_waiting' | 'remove' | 'return' | 'ready',
    ready?: boolean,
  ) => {
    const description =
      action === 'promote'
        ? `Promote ${team.name} to Active? It will be included in normal schedule planning.`
        : action === 'to_waiting'
          ? `Move ${team.name} to Waiting, unchecked?`
          : action === 'return'
            ? `Return ${team.name} to Waiting, checked to join when possible?`
            : `Remove ${team.name} to Past? Its match history will be kept.`;
    const overrideWarning =
      isSiteAdmin && action === 'promote'
        ? `\n\n${waitingReasons[team.id] || 'Eligibility, membership and capacity checks may be overridden.'} Existing fixtures and history stay protected.`
        : '';
    if (action !== 'ready' && !window.confirm(description + overrideWarning)) return;
    setChangingReserveId(team.id);
    try {
      const response = await fetch('/api/app?route=team-membership', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: tournament.id, teamId: team.id, action, ready }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Membership could not be changed.');
      setAdmissionSelection((ids) => ids.filter((id) => id !== team.id));
      await onReservesChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Membership could not be changed.');
    } finally {
      setChangingReserveId(null);
    }
  };
  const validateReserve = async (team: Team) => {
    try {
      const response = await fetch('/api/app?route=admin-add-reserve-team', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: tournament.id,
          teamId: team.ht_team_id,
          validated: true,
          ...(team.active ? { action: 'validate-participant' } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Validation failed.');
      await onReservesChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Validation failed.');
    }
  };
  const [, setIsSettingsCollapsed] = useState(() =>
    readStoredSessionBoolean(`settings_collapsed_${tournament.slug}`, false),
  );
  const [settingsCollapseOverride, setSettingsCollapseOverride] = useState<boolean | null>(() => {
    const stored = readSessionStorage(`settings_collapsed_${tournament.slug}`);
    return stored === null ? null : readStoredSessionBoolean(`settings_collapsed_${tournament.slug}`, false);
  });
  const [isTeamsCollapsed, setIsTeamsCollapsed] = useState(() =>
    readStoredSessionBoolean(`teams_collapsed_${tournament.slug}`, true),
  );
  const [isResultsCollapsed, setIsResultsCollapsed] = useState(() =>
    readStoredSessionBoolean(`results_collapsed_${tournament.slug}`, true),
  );
  const [isSeasonCollapsed, setIsSeasonCollapsed] = useState(() =>
    readStoredSessionBoolean(`season_collapsed_${tournament.slug}`, true),
  );
  const [isAnnouncementsCollapsed, setIsAnnouncementsCollapsed] = useState(() =>
    readStoredSessionBoolean(`announcements_collapsed_${tournament.slug}`, true),
  );
  const [isRolesCollapsed, setIsRolesCollapsed] = useState(() =>
    readStoredSessionBoolean(`roles_collapsed_${tournament.slug}`, true),
  );
  const [scheduleCollapseOverrides, setScheduleCollapseOverrides] = useState<Record<string, boolean>>({});
  const scheduleCollapseStorageKey = tournament.slug ? `schedule_collapsed_${tournament.slug}` : null;
  const scheduleCollapseOverride = (() => {
    if (!scheduleCollapseStorageKey) return null;
    if (Object.prototype.hasOwnProperty.call(scheduleCollapseOverrides, tournament.slug)) {
      return scheduleCollapseOverrides[tournament.slug];
    }
    if (!isHydrationReady) return null;
    const stored = readSessionStorage(scheduleCollapseStorageKey);
    if (stored === null) return null;
    try {
      return JSON.parse(stored) as boolean;
    } catch {
      return null;
    }
  })();
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const resolvedScheduleCollapsed = scheduleCollapseOverride ?? true;
  const resolvedSettingsCollapsed = settingsCollapseOverride ?? false;
  const resolvedSeasonCollapsed = isSeasonCollapsed;

  const togglePanel = (key: string, state: boolean, setter: Setter<boolean>) => {
    setter(state);
    if (key === 'settings') setSettingsCollapseOverride(state);
    window.sessionStorage.setItem(`${key}_collapsed_${tournament.slug}`, JSON.stringify(state));
  };
  const setSchedulePanelCollapsed = (state: boolean) => {
    if (tournament.slug) setScheduleCollapseOverrides((current) => ({ ...current, [tournament.slug]: state }));
    if (scheduleCollapseStorageKey) window.sessionStorage.setItem(scheduleCollapseStorageKey, JSON.stringify(state));
  };
  const expandAllAdminPanels = () => {
    togglePanel('settings', false, setIsSettingsCollapsed);
    togglePanel('announcements', false, setIsAnnouncementsCollapsed);
    togglePanel('roles', false, setIsRolesCollapsed);
    togglePanel('season', false, setIsSeasonCollapsed);
    togglePanel('results', false, setIsResultsCollapsed);
    togglePanel('teams', false, setIsTeamsCollapsed);
    setSchedulePanelCollapsed(false);
  };
  const collapseAllAdminPanels = () => {
    togglePanel('settings', true, setIsSettingsCollapsed);
    togglePanel('announcements', true, setIsAnnouncementsCollapsed);
    togglePanel('roles', true, setIsRolesCollapsed);
    togglePanel('season', true, setIsSeasonCollapsed);
    togglePanel('results', true, setIsResultsCollapsed);
    togglePanel('teams', true, setIsTeamsCollapsed);
    setSchedulePanelCollapsed(true);
  };
  const scrollToAdminPanel = (panelId: AdminPanelId) => {
    if (panelId === 'settings') togglePanel('settings', false, setIsSettingsCollapsed);
    if (panelId === 'announcements') togglePanel('announcements', false, setIsAnnouncementsCollapsed);
    if (panelId === 'roles') togglePanel('roles', false, setIsRolesCollapsed);
    if (panelId === 'season') togglePanel('season', false, setIsSeasonCollapsed);
    if (panelId === 'teams') togglePanel('teams', false, setIsTeamsCollapsed);
    if (panelId === 'results') togglePanel('results', false, setIsResultsCollapsed);
    if (panelId === 'schedule') setSchedulePanelCollapsed(false);
    window.setTimeout(() => {
      const target = document.getElementById(`admin-panel-${panelId}`);
      if (!target) return;
      const top = Math.max(window.scrollY + target.getBoundingClientRect().top - 120, 0);
      window.scrollTo({ top, behavior: 'smooth' });
    }, 80);
  };
  const closeScheduleNotice = () => {
    const showMatches = scheduleNotice?.showMatches;
    setScheduleNotice(null);
    if (showMatches) {
      collapseAllAdminPanels();
      scrollToAdminPanel('results');
    }
  };
  const renderUnsavedSettingsNote = (isChanged: boolean) =>
    isChanged ? <p className={adminStyles.unsavedSettingsNote}>Use save button to apply changes!</p> : null;
  const renderSettingsLabel = (label: string, note?: string) => (
    <div className={adminStyles.settingsLabelRow}>
      <label>{label}</label>
      {note && <span className={adminStyles.labelHelp}>{note}</span>}
    </div>
  );
  const updateSettings = async () => {
    await saveTournamentSettings();
    if (settings.settingsHasUnsavedChanges) {
      window.setTimeout(() => togglePanel('settings', true, setIsSettingsCollapsed), 1000);
    }
  };
  const handleRegenerateSchedule = async () => {
    if (await regenerateSchedule()) setSchedulePanelCollapsed(true);
  };

  return (
    <>
      {activeTab === 'admin' && (
        <div className={styles.adminTabContent}>
          {!isAdminAuthenticated ? (
            <div className={`${adminStyles.admin} ${adminStyles.adminLoginPanel}`}>
              <SectionCard
                title="Admin Access"
                subtitle={
                  publicOrganizerName && (
                    <div className={adminStyles.organizerInfo}>
                      <span className={adminStyles.organizerLabel}>Organiser: </span>
                      <span className={adminStyles.organizerName}>
                        {tournament.organizer_id ? (
                          <a
                            href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${tournament.organizer_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${styles.htLink} ${adminStyles.headerBadge}`}
                          >
                            {publicOrganizerName}{' '}
                            <ArrowUpRight size={16} weight="bold" style={{ marginLeft: '0.25rem' }} />
                          </a>
                        ) : (
                          publicOrganizerName
                        )}
                      </span>
                    </div>
                  )
                }
              >
                <div className={adminStyles.adminAuthForm}>
                  {roleAccessLoading ? (
                    <p className={adminStyles.smallNote}>Checking your tournament access…</p>
                  ) : (
                    <form
                      onSubmit={
                        verifiedRoleAccess
                          ? handleOrganizerLogin
                          : canLoginAsOrganizer
                            ? handleOrganizerSessionLogin
                            : handleAdminLogin
                      }
                    >
                      <div className={adminStyles.authField}>
                        <label>
                          {verifiedRoleAccess || canLoginAsOrganizer
                            ? 'Sign in with your Hattrick account:'
                            : 'Tournament Password'}
                        </label>
                        {verifiedRoleAccess || canLoginAsOrganizer ? (
                          <input
                            type="text"
                            value={
                              verifiedRoleAccess && roleAccess?.viewerManagerName
                                ? `${roleAccess.viewerManagerName} (${verifiedRoleLabel})`
                                : `${currentHtManagerName} (Organiser)`
                            }
                            readOnly
                            className={styles.readOnlyName}
                          />
                        ) : (
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => {
                              setPassword(e.target.value);
                              if (adminAuthError) setAdminAuthError(false);
                            }}
                            placeholder="Enter admin password"
                            required
                          />
                        )}
                      </div>
                      {!verifiedRoleAccess && adminAuthError && (
                        <p className={adminStyles.authError}>Invalid password. Please try again.</p>
                      )}
                      <Button type="submit" variant="primaryDanger" size="md">
                        {verifiedRoleAccess
                          ? `Sign in as ${verifiedRoleLabel}`
                          : canLoginAsOrganizer
                            ? 'Sign in as Organiser'
                            : 'Login'}{' '}
                        <ArrowRight size={18} weight="bold" />
                      </Button>
                    </form>
                  )}

                  <div className={adminStyles.adminAuthFooter}>
                    {failedLoginAttempt ? (
                      <p className={adminStyles.adminAuthNote}>Forgot password? Recover with a registered email.</p>
                    ) : (
                      <a href="/create" className={adminStyles.adminAuthLink}>
                        Want to be an admin? <u>Start your own tournament</u>.
                      </a>
                    )}
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : (
            <div className={adminStyles.admin}>
              <div className={adminStyles.mainGrid}>
                <section className={`${adminStyles.teamsSection} ${isPressOfficer ? adminStyles.pressOnlyAdmin : ''}`}>
                  {!isPressOfficer && (
                    <>
                      {canManageOperationalAdmin && (
                        <DepartureNotices
                          key={tournament.id}
                          tournamentId={tournament.id}
                          tournamentSlug={tournament.slug}
                        />
                      )}
                      <div id="admin-panel-settings">
                        <SectionCard
                          title="Tournament Settings"
                          collapsible
                          isCollapsed={resolvedSettingsCollapsed}
                          onToggleCollapse={() =>
                            togglePanel('settings', !resolvedSettingsCollapsed, setIsSettingsCollapsed)
                          }
                        >
                          <div className={adminStyles.settingsGroup}>
                            {/* EDIT TOURNAMENT NAME **
                      <div className={adminStyles.field}>

                        <div className={adminStyles.labelRow}>
                          <label>Tournament Name</label>
                          <button type="button" onClick={regenerateName} className={adminStyles.iconBtn}>
                            <ArrowClockwise size={20} weight="bold" />
                          </button>
                        </div>
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </div> */}

                            <div className={adminStyles.meta}>
                              <div className={adminStyles.metaItem}>
                                {!isMobile ? (
                                  <span className={adminStyles.label}>Public URL:</span>
                                ) : (
                                  <span className={adminStyles.label}>URL:</span>
                                )}
                                <a href={publicUrl} target="_blank" className={styles.publicUrl}>
                                  <code>{publicUrlDisplay}</code>
                                </a>
                                <CopySimple
                                  size={24}
                                  onClick={() => {
                                    navigator.clipboard.writeText(publicUrl);
                                    alert('URL copied!');
                                  }}
                                  weight="bold"
                                  className={adminStyles.copyIcon}
                                />
                              </div>
                              <div className={adminStyles.metaItem}>
                                {!isMobile ? (
                                  <span className={adminStyles.label}>Admin Password:</span>
                                ) : (
                                  <span className={adminStyles.label}>Password:</span>
                                )}

                                <code>{tournament.admin_password}</code>
                                {canLoginAsOrganizer && (
                                  <button
                                    type="button"
                                    onClick={handleResetAdminPassword}
                                    className={adminStyles.copyIcon}
                                    title="Reset password"
                                    aria-label="Reset tournament admin password"
                                    disabled={isResettingAdminPassword}
                                  >
                                    <ArrowClockwise size={18} weight="bold" />
                                  </button>
                                )}
                                <CopySimple
                                  size={24}
                                  onClick={() => {
                                    navigator.clipboard.writeText(tournament.admin_password);
                                    alert("Password copied! Don't lose it.");
                                  }}
                                  weight="bold"
                                  className={adminStyles.copyIcon}
                                />
                              </div>
                            </div>

                            <div className={adminStyles.field}>
                              {renderSettingsLabel(
                                'Tournament Category',
                                participantTeams.length > 0 && !isSiteAdmin
                                  ? '(locked once teams register)'
                                  : undefined,
                              )}
                              <select
                                value={editLeagueCategory}
                                onChange={(e) => setEditLeagueCategory(e.target.value as 'male' | 'hfi')}
                                disabled={participantTeams.length > 0 && !isSiteAdmin}
                                className={adminStyles.selectField}
                              >
                                <option value="male">Regular league (male)</option>
                                <option value="hfi">Hattrick Femme International (HFI)</option>
                              </select>
                              {renderUnsavedSettingsNote(unsavedSettingsFields.leagueCategory)}
                            </div>

                            <div className={adminStyles.field}>
                              {renderSettingsLabel('Team limit', '(set maximum allowed, minimum is 2)')}
                              <select
                                value={editMaxTeams ?? ''}
                                onChange={(e) => setEditMaxTeams(e.target.value ? Number(e.target.value) : null)}
                                className={adminStyles.selectField}
                              >
                                <option value="">Undecided (open till start)</option>
                                {[2, 4, 6, 8, 10, 12, 14, 16].map((n) => (
                                  <option key={n} value={n}>
                                    {n} teams
                                  </option>
                                ))}
                              </select>
                              {renderUnsavedSettingsNote(unsavedSettingsFields.maxTeams)}
                            </div>

                            <div className={adminStyles.field}>
                              {renderSettingsLabel(
                                isStartDateLocked ? 'Start date' : 'Planned start date',
                                isStartDateLocked
                                  ? '(locked by first fixture)'
                                  : '(indicative, will lock to first fixture when present)',
                              )}
                              {isStartDateLocked && firstKnownFixtureDate ? (
                                <>
                                  <input
                                    type="text"
                                    value={formatCalendarDateWithWeek(firstKnownFixtureDate, 'short')}
                                    disabled
                                    className={adminStyles.selectField}
                                  />
                                </>
                              ) : (
                                <>
                                  <select
                                    value={scheduleStartSlotId}
                                    onChange={(e) => setScheduleStartSlotId(e.target.value)}
                                    disabled={scheduleDraft.startSlotOptions.length === 0}
                                    className={adminStyles.selectField}
                                  >
                                    <option value="" disabled>
                                      {scheduleDraft.startSlotOptions.length > 0
                                        ? 'Select a start date...'
                                        : 'Not enough teams'}
                                    </option>
                                    {scheduleDraft.startSlotOptions.map((slot) => (
                                      <option key={slot.id} value={slot.id}>
                                        {`HT S${slot.ht120minSeason} W${slot.htWeek} • ${formatCalendarDateWithWeek(slot.nominalDate, 'short')}`}
                                      </option>
                                    ))}
                                  </select>
                                </>
                              )}
                              {renderUnsavedSettingsNote(unsavedSettingsFields.scheduleStart)}
                            </div>

                            <div className={adminStyles.field}>
                              {renderSettingsLabel('Registration')}
                              <Switch
                                checked={editRegistrationOpen}
                                onChange={setEditRegistrationOpen}
                                size="sm"
                                label={
                                  editRegistrationOpen
                                    ? 'Tournament open for registration'
                                    : 'Tournament closed for registration'
                                }
                              />
                              {renderUnsavedSettingsNote(unsavedSettingsFields.registrationOpen)}
                            </div>

                            <div className={adminStyles.checkboxField}>
                              <label className={adminStyles.checkboxLabel}>
                                <input
                                  type="checkbox"
                                  checked={editIsPrivate}
                                  onChange={(e) => setEditIsPrivate(e.target.checked)}
                                />
                                Private Tournament (unlisted on home page)
                              </label>
                              {renderUnsavedSettingsNote(unsavedSettingsFields.private)}
                            </div>

                            <div>
                              <div className={adminStyles.checkboxField}>
                                <div className={adminStyles.labelRow}>
                                  <label className={adminStyles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      checked={showEditDescription}
                                      onChange={(e) => setShowEditDescription(e.target.checked)}
                                    />
                                    Show Description
                                  </label>
                                  {showEditDescription && (
                                    <button
                                      type="button"
                                      onClick={() => regenerateDescription(false)}
                                      className={adminStyles.iconBtn}
                                      title="Regenerate description"
                                    >
                                      <ArrowClockwise size={20} weight="bold" />
                                    </button>
                                  )}
                                </div>
                                {renderUnsavedSettingsNote(unsavedSettingsFields.showDescription)}
                              </div>

                              {showEditDescription && (
                                <div className={`${adminStyles.textField} ${styles.mt1}`}>
                                  <textarea
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    placeholder="Tournament description..."
                                    rows={6}
                                  />
                                  {renderUnsavedSettingsNote(unsavedSettingsFields.description)}
                                </div>
                              )}

                              <div className={`${adminStyles.field} ${styles.mt1}`}>
                                <label htmlFor="tournament-forum-id">Tournament HT-Forum thread ID</label>
                                <input
                                  id="tournament-forum-id"
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={editForumId}
                                  onChange={(event) => setEditForumId(event.target.value.replace(/\D/g, ''))}
                                  placeholder="17682260"
                                />
                                {renderUnsavedSettingsNote(unsavedSettingsFields.forumId)}
                              </div>
                            </div>

                          </div>
                          <div className={adminStyles.settingsActions}>
                            <Button
                              onClick={updateSettings}
                              disabled={isUpdatingSettings}
                              variant={settingsHasUnsavedChanges ? 'primary' : 'secondaryAction'}
                              size="sm"
                            >
                              {isUpdatingSettings ? 'Saving...' : 'Save Settings'}
                            </Button>
                            <Button
                              type="button"
                              onClick={() => setShowAdvancedSettings((current) => !current)}
                              variant="secondaryAction"
                              size="sm"
                            >
                              {showAdvancedSettings ? 'Hide more settings' : 'Show more settings'}
                            </Button>
                            {showLocalSiteAdminSettings && (
                              <Button
                                type="button"
                                onClick={() => setShowSiteAdminSettings((current) => !current)}
                                variant="secondaryAction"
                                size="sm"
                                aria-expanded={showSiteAdminSettings}
                              >
                                {showSiteAdminSettings ? 'Hide site admin settings' : 'Site admin settings'}
                              </Button>
                            )}
                          </div>
                          {renderUnsavedSettingsNote(settingsHasUnsavedChanges)}
                          {showLocalSiteAdminSettings && showSiteAdminSettings && (
                            <div className={adminStyles.settingsGroup}>
                              <div className={`${adminStyles.checkboxField} ${styles.formDivider}`}>
                                <label className={adminStyles.checkboxLabel}>
                                  <input
                                    type="checkbox"
                                    checked={isTest}
                                    onChange={(e) => setIsTest(e.target.checked)}
                                  />
                                  Testing Ground
                                </label>
                                {renderUnsavedSettingsNote(unsavedSettingsFields.test)}
                              </div>

                              {canManageFeaturedTournaments && (
                                <div className={`${adminStyles.checkboxField} ${styles.formDivider}`}>
                                  <label className={adminStyles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      checked={editIsFeatured}
                                      onChange={(e) => setEditIsFeatured(e.target.checked)}
                                    />
                                    <Star size={16} weight="bold" />
                                    Featured tournament
                                  </label>
                                  <p className={adminStyles.smallNote}>Pinned to the top of its public lists.</p>
                                  {renderUnsavedSettingsNote(unsavedSettingsFields.featured)}
                                </div>
                              )}

                              {tournament && <CollectionMembershipPanel tournamentId={tournament.id} />}
                            </div>
                          )}
                          {showAdvancedSettings && (
                            <div className={adminStyles.settingsGroup}>
                              <div className={adminStyles.field}>
                                {renderSettingsLabel('Schedule setup', '(advanced setting, see FAQ)')}
                                <select
                                  value={scheduleSetup}
                                  onChange={(event) => setScheduleSetup(event.target.value as ScheduleSetup)}
                                  className={adminStyles.selectField}
                                >
                                  <option value="generated">Generated schedule</option>
                                  <option value="manual">No pre-made schedule</option>
                                </select>
                                {renderUnsavedSettingsNote(unsavedSettingsFields.scheduleMode)}
                              </div>

                              <div className={adminStyles.field}>
                                {renderSettingsLabel(
                                  'Tournament Type',
                                  participantTeams.length > 0 && !isSiteAdmin
                                    ? '(locked once teams register)'
                                    : undefined,
                                )}
                                <select
                                  value={editRegistrationType}
                                  onChange={(e) =>
                                    setEditRegistrationType(normalizeTournamentRegistrationType(e.target.value))
                                  }
                                  disabled={participantTeams.length > 0 && !isSiteAdmin}
                                  className={adminStyles.selectField}
                                >
                                  <option value="validated">Hattrick Validated (CHPP)</option>
                                  <option value="manual">Organizer-Managed</option>
                                  <option value="sandbox">Sandbox Playground</option>
                                </select>
                                {renderUnsavedSettingsNote(unsavedSettingsFields.registrationType)}
                              </div>

                              <div className={adminStyles.field}>
                                {renderSettingsLabel('Country limit', '(locked to already registerd teams)')}
                                <select
                                  value={editCountryLimit || ''}
                                  onChange={(e) => {
                                    const nextCountryLimit = e.target.value || null;
                                    const mismatch = getActiveTeamRestrictionMismatch(nextCountryLimit);
                                    if (mismatch) {
                                      alert(mismatch);
                                      return;
                                    }
                                    setEditCountryLimit(nextCountryLimit);
                                  }}
                                  className={adminStyles.selectField}
                                >
                                  <option value="">Any country</option>
                                  {editCountryLimit && !currentLeagueRestrictionIsCompatible && (
                                    <option value={editCountryLimit} disabled>
                                      Current setting conflicts with registered teams
                                    </option>
                                  )}
                                  {leagueRestrictionOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                {(() => {
                                  const countries = Array.from(
                                    new Set(
                                      teams
                                        .filter(isCurrentParticipantTeam)
                                        .map((team) =>
                                          normalizeLeagueLimit(
                                            team.country_id ? String(team.country_id) : team.country_name,
                                          ),
                                        )
                                        .filter(Boolean),
                                    ),
                                  );
                                  if (countries.length >= 2) {
                                    return (
                                      <p className={adminStyles.smallNote}>
                                        Teams from at least 2 countries already registered.
                                      </p>
                                    );
                                  }
                                  return null;
                                })()}
                                {renderUnsavedSettingsNote(unsavedSettingsFields.countryLimit)}
                              </div>

                              <div className={adminStyles.field}>
                                {renderSettingsLabel('Maximum active teams in country')}
                                <input
                                  type="number"
                                  min={1}
                                  max={1200}
                                  value={editMaxCountryActiveTeams ?? ''}
                                  onChange={(event) =>
                                    setEditMaxCountryActiveTeams(event.target.value ? Number(event.target.value) : null)
                                  }
                                  className={adminStyles.selectField}
                                  placeholder="No restriction"
                                />
                              </div>
                              <label className={adminStyles.checkboxLabel}>
                                <input
                                  type="checkbox"
                                  checked={editAllowManagerCountrySizeException}
                                  onChange={(event) => setEditAllowManagerCountrySizeException(event.target.checked)}
                                />
                                Allow other teams from managers already participating with a qualifying team
                              </label>

                              <div className={adminStyles.field}>
                                <label htmlFor="tournament-scoring-mode">{themeText('scoringModeLabel')}</label>
                                <select
                                  id="tournament-scoring-mode"
                                  className={adminStyles.selectField}
                                  value={editScoringMode}
                                  onChange={(event) => setEditScoringMode(event.target.value as typeof editScoringMode)}
                                >
                                  <option value="120min">{themeText('standard120ScoringMode')}</option>
                                  <option value="average120">{themeText('average120ScoringMode')}</option>
                                  <option value="points">{themeText('regular90ScoringMode')}</option>
                                  {editRegistrationType !== 'validated' && (
                                    <option value="appg">{themeText('appg120ScoringMode')}</option>
                                  )}
                                </select>
                                {renderUnsavedSettingsNote(unsavedSettingsFields.scoringMode)}
                              </div>

                              <div className={adminStyles.field}>
                                <label htmlFor="tournament-default-theme">{themeText('defaultColorTheme')}</label>
                                <select
                                  id="tournament-default-theme"
                                  className={adminStyles.selectField}
                                  value={editDefaultTheme ?? ''}
                                  onChange={(event) =>
                                    setEditDefaultTheme(normalizeTournamentTheme(event.target.value))
                                  }
                                >
                                  <option value="">{themeText('visitorThemePreference')}</option>
                                  <option value="light">{themeText('lightTheme')}</option>
                                  <option value="dark">{themeText('darkTheme')}</option>
                                </select>
                                {renderUnsavedSettingsNote(unsavedSettingsFields.defaultTheme)}
                              </div>

                              <div className={styles.mt1}>
                                <div className={adminStyles.checkboxField}>
                                  <label className={adminStyles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      checked={showEditEmail}
                                      onChange={(e) => setShowEditEmail(e.target.checked)}
                                    />
                                    Recovery email address
                                  </label>
                                  {renderUnsavedSettingsNote(unsavedSettingsFields.showEmail)}
                                </div>
                                {showEditEmail && (
                                  <div className={`${adminStyles.textField} ${styles.mt1}`}>
                                    <input
                                      type="email"
                                      value={editAdminEmail}
                                      onChange={(e) => setEditAdminEmail(e.target.value)}
                                      placeholder="In case you forget your admin password..."
                                    />
                                    {renderUnsavedSettingsNote(unsavedSettingsFields.adminEmail)}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </SectionCard>
                      </div>
                    </>
                  )}

                  {!isPressOfficer && (
                    <>
                      {!isGenerated && canManageSchedule && (
                        <div id="admin-panel-schedule">
                          <TournamentSchedulePanel
                            isGenerated={isGenerated}
                            isCollapsed={resolvedScheduleCollapsed}
                            onToggleCollapse={() => setSchedulePanelCollapsed(!resolvedScheduleCollapsed)}
                            scheduleSetup={scheduleSetup}
                            draft={scheduleDraft}
                            onScheduleModeChange={handleScheduleModeChange}
                            onSelectedStartSlotIdChange={handleScheduleStartSlotIdChange}
                            includeWeek15WeekendFriendly={includeWeek15WeekendFriendly}
                            onIncludeWeek15WeekendFriendlyChange={handleIncludeWeek15WeekendFriendlyChange}
                            isGenerating={isGenerating}
                            onGenerate={generateSchedule}
                            onShuffleFixtures={handleShuffleScheduleFixtures}
                            tournamentTeamLimit={editMaxTeams}
                            teams={teams}
                            previewHtMatchAdd={previewHtMatchAdd}
                            saveHtMatchAdd={saveHtMatchAdd}
                            onRefreshFixtures={fetchFixturesOnly}
                            onNormalizeManualRounds={scheduleSetup === 'manual' ? normalizeManualRounds : undefined}
                            fetchHtMatchSuggestions={fetchHtMatchSuggestions}
                            lengthDraft={usesLengthSchedulePlanner ? lengthScheduleDraft : null}
                            onLengthFormatChange={setLengthFormatId}
                          />
                        </div>
                      )}

                      {isGenerated && canManageSchedule && (
                        <div id="admin-panel-schedule">
                          <TournamentSchedulePanel
                            isGenerated={isGenerated}
                            isCollapsed={resolvedScheduleCollapsed}
                            onToggleCollapse={() => setSchedulePanelCollapsed(!resolvedScheduleCollapsed)}
                            scheduleSetup={scheduleSetup}
                            draft={scheduleDraft}
                            onScheduleModeChange={handleScheduleModeChange}
                            onSelectedStartSlotIdChange={handleScheduleStartSlotIdChange}
                            includeWeek15WeekendFriendly={includeWeek15WeekendFriendly}
                            onIncludeWeek15WeekendFriendlyChange={handleIncludeWeek15WeekendFriendlyChange}
                            isGenerating={isGenerating}
                            onGenerate={generateSchedule}
                            onShuffleFixtures={handleShuffleScheduleFixtures}
                            tournamentTeamLimit={editMaxTeams}
                            rescheduleDraft={rescheduleDraft}
                            onRescheduleFromRoundChange={handleRescheduleFromRoundChange}
                            onRescheduleStartSlotIdChange={handleRescheduleStartSlotIdChange}
                            includeWeek15WeekendFriendlyForReschedule={includeWeek15WeekendFriendlyForReschedule}
                            onIncludeWeek15WeekendFriendlyForRescheduleChange={
                              handleIncludeWeek15WeekendFriendlyForRescheduleChange
                            }
                            isRescheduling={isRescheduling}
                            onReschedule={handleRegenerateSchedule}
                            teams={teams}
                            previewHtMatchAdd={previewHtMatchAdd}
                            saveHtMatchAdd={saveHtMatchAdd}
                            onRefreshFixtures={fetchFixturesOnly}
                            onNormalizeManualRounds={scheduleSetup === 'manual' ? normalizeManualRounds : undefined}
                            fetchHtMatchSuggestions={fetchHtMatchSuggestions}
                            lengthDraft={tournament.schedule_mode === 'length' ? lengthScheduleDraft : null}
                            lengthRounds={tournament.schedule_mode === 'length' ? rounds : []}
                            isRepairingRound={isRepairingRound}
                            onRepairRound={tournament.schedule_mode === 'length' ? repairCurrentLengthRound : undefined}
                            reserveAdmissionControl={
                              canManageOperationalAdmin && reserveTeams.length > 0 ? (
                                <>
                                  <div className={adminStyles.reservePairingSelection}>
                                    <p>Choose Waiting teams to pair in the current round:</p>
                                    {reserveTeams.map((team) => (
                                      <label key={team.id} className={adminStyles.checkboxLabel}>
                                        <input
                                          type="checkbox"
                                          checked={selectedAdmissionIds.includes(team.id)}
                                          onChange={(event) => {
                                            const checked = event.currentTarget.checked;
                                            setAdmissionSelection((ids) =>
                                              checked
                                                ? [...new Set([...ids, team.id])]
                                                : ids.filter((id) => id !== team.id),
                                            );
                                          }}
                                        />
                                        {team.name}
                                      </label>
                                    ))}
                                  </div>
                                  <ReserveAdmissionPanel
                                    tournamentId={tournament.id}
                                    teamIds={selectedAdmissionIds}
                                    isSiteAdmin={isSiteAdmin}
                                    onChanged={async () => {
                                      setAdmissionSelection([]);
                                      await onReservesChanged();
                                    }}
                                  />
                                </>
                              ) : undefined
                            }
                            isRecoveringRoundOne={isRecoveringRoundOne}
                            onRecoverRoundOne={
                              tournament.schedule_mode === 'length' ? recoverOriginalLengthRoundOne : undefined
                            }
                          />
                        </div>
                      )}

                      {canManageSchedule && (
                        <div id="admin-panel-results">
                          <AdminResults
                            rounds={rounds}
                            editingMatch={editingMatch}
                            setEditingMatch={setEditingMatch}
                            updateMatch={async (matchId) => {
                              await updateMatch(matchId);
                            }}
                            resetMatchResult={resetMatchResult}
                            isResultsCollapsed={isResultsCollapsed}
                            setIsResultsCollapsed={setIsResultsCollapsed}
                            togglePanel={togglePanel}
                            matchData={matchData}
                            setMatchData={
                              setMatchData as unknown as React.ComponentProps<typeof AdminResults>['setMatchData']
                            }
                            currentRoundId={currentRoundIdForResults ?? undefined}
                            previewHtMatchLink={previewHtMatchLink}
                            saveHtMatchLink={saveHtMatchLink}
                            scoringMode={tournament.scoring_mode}
                            saveBulkMatches={isValidatedTournament ? undefined : saveBulkMatches}
                            clearSeasonResults={isValidatedTournament ? undefined : clearSeasonResults}
                            clearSeasonFixtures={
                              isValidatedTournament || scheduleSetup !== 'manual' ? undefined : clearSeasonFixtures
                            }
                            importCsvRows={isValidatedTournament ? undefined : importCsvRows}
                            isSandbox={isSandbox}
                            canRemoveFixtures={scheduleSetup === 'manual'}
                            onRemoveFixture={removeFixture}
                          />
                        </div>
                      )}

                      <div id="admin-panel-teams">
                        <SectionCard
                          title={`Manage Teams (${activeParticipantCount})`}
                          collapsible
                          isCollapsed={isTeamsCollapsed}
                          onToggleCollapse={() => togglePanel('teams', !isTeamsCollapsed, setIsTeamsCollapsed)}
                        >
                          {!isGenerated && (
                            <div className={adminStyles.addTeamSection}>
                              <h3 className={adminStyles.sectionTitle}>
                                {isValidatedTournament ? 'Add placeholder' : 'Add Team'}
                              </h3>
                              {isValidatedTournament && (
                                <p className={styles.helperText}>
                                  Add an unverified team placeholder using the team&apos;s Hattrick data. It will work
                                  for generating schedule and manager will be able to verify it once they log in.
                                </p>
                              )}
                              <form onSubmit={(e) => addTeam(e, false)} className={adminStyles.teamForm}>
                                <div className={adminStyles.inputGroup}>
                                  <input
                                    name="team_ht_id"
                                    type="text"
                                    placeholder="HT Team ID"
                                    value={newTeamId}
                                    onChange={(e) => {
                                      setNewTeamId(e.target.value.replace(/\D/g, ''));
                                      setNewTeamName('');
                                      setNewTeamData(null);
                                    }}
                                    minLength={6}
                                    maxLength={9}
                                    required
                                  />
                                  <input
                                    name="team_name"
                                    type="text"
                                    placeholder="Team Name"
                                    value={newTeamName}
                                    readOnly
                                    className={!newTeamName ? styles.opacity06 : ''}
                                    required
                                  />
                                </div>
                                {newTeamId.length >= 6 && !newTeamName && (
                                  <Button
                                    type="button"
                                    onClick={() => fetchTeamData(newTeamId, false)}
                                    disabled={isFetchingTeamData}
                                    variant="primary"
                                  >
                                    {isFetchingTeamData ? 'Fetching...' : 'Get team data'}
                                  </Button>
                                )}
                                {newTeamName && (
                                  <>
                                    {isValidatedTournament ? (
                                      <Button type="submit" disabled={isSavingTeam} variant="primary">
                                        {isSavingTeam ? 'Saving...' : 'Add placeholder'}
                                      </Button>
                                    ) : (
                                      <Button type="submit" disabled={isSavingTeam} variant="primary">
                                        {isSavingTeam ? 'Saving...' : 'Add team to tournament'}
                                      </Button>
                                    )}
                                  </>
                                )}
                              </form>
                            </div>
                          )}
                          {canManageOperationalAdmin && (
                            <div className={adminStyles.teamPlanningTools}>
                              <div className={adminStyles.teamPlanningRow}>
                                <div>
                                  <p className={adminStyles.smallNote}>
                                    Check current Hattrick cup and next-friendly status before generating a schedule.
                                  </p>
                                  {teamStatusNotice && (
                                    <p className={adminStyles.teamPlanningNotice}>{teamStatusNotice}</p>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondaryAction"
                                  onClick={() => void refreshTeamPlanningStatuses()}
                                  disabled={isRefreshingTeamStatuses}
                                >
                                  {isRefreshingTeamStatuses ? 'Chatting with Hattrick...' : 'Check booking status'}
                                </Button>
                              </div>
                              {oauthRoleAccess && roleAccess?.canManageOperations && (
                                <div className={adminStyles.teamPlanningRow}>
                                  <div>
                                    <p className={adminStyles.smallNote}>
                                      Refresh current{' '}
                                      {tournament.league_category === 'hfi' ? 'HFI ranks' : 'Power Rankings'} before
                                      generating a schedule.
                                    </p>
                                    {hfiRankNotice && (
                                      <p
                                        className={`${adminStyles.teamPlanningNotice} ${
                                          hfiRankNoticeIsError
                                            ? adminStyles.teamPlanningNoticeError
                                            : adminStyles.teamPlanningNoticeSuccess
                                        }`}
                                      >
                                        {hfiRankNotice}
                                      </p>
                                    )}
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondaryAction"
                                    onClick={() => void updateHfiRanks()}
                                    disabled={isUpdatingHfiRanks}
                                  >
                                    {isUpdatingHfiRanks
                                      ? 'Updating ranks...'
                                      : tournament.league_category === 'hfi'
                                        ? 'Update HFI ranks'
                                        : 'Update Power Rankings'}
                                  </Button>
                                </div>
                              )}
                              {tournamentAllowsTeamActions && (
                                  <>
                                    <div className={adminStyles.teamPlanningRow}>
                                      <div>
                                        <p className={adminStyles.smallNote}>
                                          Add a manually selected Hattrick team to Waiting for review.
                                        </p>
                                      </div>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondaryAction"
                                        onClick={() => setIsReserveTeamFormOpen((open) => !open)}
                                      >
                                        {isReserveTeamFormOpen ? 'Cancel' : 'Add to Waiting'}
                                      </Button>
                                    </div>
                                    {isReserveTeamFormOpen && (
                                      <form
                                        onSubmit={(e) => void addTeam(e, false, true)}
                                        className={adminStyles.teamForm}
                                      >
                                        <p className={adminStyles.smallNote}>
                                          Enter the Hattrick team ID. Team data and eligibility will be checked before
                                          it is added.
                                        </p>
                                        <div className={adminStyles.inputGroup}>
                                          <input
                                            name="reserve_team_ht_id"
                                            type="text"
                                            placeholder="HT Team ID"
                                            value={reserveTeamId}
                                            onChange={(e) => {
                                              setReserveTeamId(e.target.value.replace(/\D/g, ''));
                                              setReserveTeamName('');
                                            }}
                                            minLength={1}
                                            maxLength={10}
                                            required
                                          />
                                          <input
                                            name="reserve_team_name"
                                            type="text"
                                            placeholder="Team Name"
                                            value={reserveTeamName}
                                            readOnly
                                            className={!reserveTeamName ? styles.opacity06 : ''}
                                            required
                                          />
                                        </div>
                                        {/^\d{1,10}$/.test(reserveTeamId.trim()) && !reserveTeamName && (
                                          <Button
                                            type="button"
                                            onClick={() => void fetchTeamData(reserveTeamId, false, true)}
                                            disabled={isFetchingTeamData}
                                            variant="primary"
                                          >
                                            {isFetchingTeamData ? 'Fetching...' : 'Get team data'}
                                          </Button>
                                        )}
                                        {reserveTeamName && (
                                          <p>
                                            {isFetchingTeamData
                                              ? 'Checking current ownership...'
                                              : reserveValidation?.teamId === reserveTeamId &&
                                                  reserveValidation.validated
                                                ? `Already CHPP validated · ${reserveValidation.managerName}`
                                                : reserveValidation?.teamId === reserveTeamId && reserveValidation.known
                                                  ? 'Known team — current ownership could not be verified. Add as an unverified Waiting team.'
                                                  : 'Add as an unverified Waiting team.'}
                                          </p>
                                        )}
                                        {reserveTeamName && (
                                          <Button
                                            type="submit"
                                            disabled={isSavingTeam || isFetchingTeamData}
                                            variant="primary"
                                          >
                                            {isSavingTeam
                                              ? 'Saving...'
                                              : reserveValidation?.teamId === reserveTeamId &&
                                                  reserveValidation.validated
                                                ? 'Add verified team to Waiting'
                                                : 'Add to Waiting'}
                                          </Button>
                                        )}
                                      </form>
                                    )}
                                  </>
                                )}
                            </div>
                          )}
                          <h3 className={adminStyles.sectionTitle}>Active ({activeParticipantCount})</h3>
                          <ul className={adminStyles.teamList}>
                            {teams
                              .filter((team) => team.active && !team.reserve_active)
                              .map((team) => (
                                <li key={team.id}>
                                  <div className={adminStyles.teamCard}>
                                    <img
                                      src={team.logo_url || DEFAULT_TEAM_LOGO}
                                      alt=""
                                      className={adminStyles.teamLogo}
                                      onError={(event) => {
                                        event.currentTarget.onerror = null;
                                        event.currentTarget.src = DEFAULT_TEAM_LOGO;
                                      }}
                                    />
                                    <div className={adminStyles.teamInfo}>
                                      <div className={adminStyles.teamNameRow}>
                                        {team.ht_team_id ? (
                                          <a
                                            href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={adminStyles.teamLink}
                                          >
                                            {team.name}
                                          </a>
                                        ) : (
                                          <span className={adminStyles.name}>{team.name || 'Open slot'}</span>
                                        )}
                                          {fixtureWarningTeamIds.has(team.id) && (
                                            <span title={standingsText('warningIssued')}>
                                              <img
                                                src="/warn-red.png"
                                                alt={standingsText('warningIssued')}
                                                className={styles.standingWarningIcon}
                                              />
                                            </span>
                                          )}
                                        {teamPlanningStatuses[team.id]?.inCup === true && (
                                          <span className={adminStyles.planningStatus}>[in cup]</span>
                                        )}
                                        {teamPlanningStatuses[team.id]?.bookedOutsideTournament && (
                                          <span
                                            className={`${adminStyles.planningStatus} ${adminStyles.planningStatusBooked}`}
                                          >
                                            [booked]
                                          </span>
                                        )}
                                        {team.joined_via_oauth && <span title="Hattrick Validated Team"></span>}
                                        {isStoppedTournament &&
                                          team.active &&
                                          team.ht_team_id &&
                                          playingElsewhereTeamIds.has(team.ht_team_id) && (
                                            <span className={adminStyles.playingElsewhere}>PLAYING ELSEWHERE!</span>
                                          )}
                                      </div>
                                      {team.ht_team_id && (
                                        <div className={adminStyles.teamMeta}>
                                          <a
                                            href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={adminStyles.teamMetaLink}
                                          >
                                            ID: {team.ht_team_id}
                                          </a>
                                          {team.manager_name && (
                                            <>
                                              <span className={adminStyles.teamMetaSeparator}>·</span>
                                              {team.hattrick_user_id ? (
                                                <a
                                                  href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.hattrick_user_id}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className={adminStyles.teamMetaLink}
                                                >
                                                  {team.manager_name}
                                                </a>
                                              ) : (
                                                <span>{team.manager_name}</span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  <div className={adminStyles.teamActions}>
                                    <>
                                      {canManageOperationalAdmin && !team.joined_via_oauth && team.ht_team_id && (
                                        <Button
                                          type="button"
                                          size="xs"
                                          variant="secondaryAction"
                                          onClick={() => void validateReserve(team)}
                                        >
                                          Validate team
                                        </Button>
                                      )}
                                      {tournament.schedule_mode !== 'length' &&
                                        isGenerated &&
                                        roleAccess?.canManageOperations &&
                                        seasonSlots.some((slot) => slot.current_team_id === team.id) &&
                                        reserveTeams.length > 0 &&
                                        (reserveReplacingTeamId === team.id ? (
                                          <div className={adminStyles.inlineReplace}>
                                            <select
                                              className={adminStyles.selectField}
                                              value={selectedReserveTeamId}
                                              onChange={(event) => setSelectedReserveTeamId(event.target.value)}
                                              disabled={isSavingTeam}
                                            >
                                              <option value="">Choose Waiting team</option>
                                              {reserveTeams.map((reserveTeam) => (
                                                <option key={reserveTeam.id} value={reserveTeam.id}>
                                                  {reserveTeam.name}
                                                </option>
                                              ))}
                                            </select>
                                            <div className={adminStyles.replaceActions}>
                                              <Button
                                                size="xs"
                                                variant="action"
                                                onClick={() => void replaceTeamWithReserve(team.id)}
                                                disabled={isSavingTeam || !selectedReserveTeamId}
                                              >
                                                Replace with Waiting team
                                              </Button>
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                  setReserveReplacingTeamId(null);
                                                  setSelectedReserveTeamId('');
                                                }}
                                              >
                                                Cancel
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <Button
                                            size="xs"
                                            variant="action"
                                            onClick={() => {
                                              setReserveReplacingTeamId(team.id);
                                              setSelectedReserveTeamId('');
                                            }}
                                            disabled={isSavingTeam}
                                          >
                                            Replace with Waiting team
                                          </Button>
                                        ))}
                                      {!isGenerated && replacingTeamId === team.id ? (
                                        <div className={adminStyles.inlineReplace}>
                                          <input
                                            name={`replace_id_${team.id}`}
                                            type="text"
                                            placeholder="New HT ID"
                                            value={replacementHtId}
                                            onChange={(e) => {
                                              setReplacementHtId(e.target.value.replace(/\D/g, ''));
                                              setReplacementName('');
                                            }}
                                            required
                                          />
                                          <input
                                            name={`replace_name_${team.id}`}
                                            type="text"
                                            placeholder="New Name"
                                            value={replacementName}
                                            readOnly
                                            className={!replacementName ? styles.opacity06 : ''}
                                            required
                                          />
                                          <div className={adminStyles.replaceActions}>
                                            {replacementHtId.length >= 6 && !replacementName && (
                                              <Button
                                                size="xs"
                                                onClick={() => fetchTeamData(replacementHtId, true)}
                                                disabled={isFetchingTeamData}
                                                variant="action"
                                              >
                                                Check
                                              </Button>
                                            )}
                                            {replacementName && (
                                              <Button
                                                size="xs"
                                                onClick={() => replaceTeam(team.id)}
                                                disabled={isSavingTeam}
                                                variant="action"
                                              >
                                                Save
                                              </Button>
                                            )}
                                            <Button
                                              size="sm"
                                              variant="secondary"
                                              onClick={() => {
                                                setReplacingTeamId(null);
                                                setReplacementHtId('');
                                                setReplacementName('');
                                              }}
                                            >
                                              Cancel
                                            </Button>
                                          </div>
                                        </div>
                                      ) : !isGenerated ? (
                                        <Button size="xs" variant="action" onClick={() => setReplacingTeamId(team.id)}>
                                          <ArrowClockwise size={16} /> Replace
                                        </Button>
                                      ) : null}
                                      {roleAccess?.canManageOperations &&
                                        tournamentAllowsTeamActions &&
                                        (!isGenerated || isSiteAdmin) && (
                                          <>
                                            <Button
                                              size="xs"
                                              variant="action"
                                              onClick={() => void changeMembership(team, 'to_waiting')}
                                              disabled={isSavingTeam}
                                            >
                                              Waiting List
                                            </Button>
                                          </>
                                        )}
                                      <Button
                                        size="xs"
                                        variant="danger"
                                        onClick={() =>
                                          team.is_placeholder || isSandbox
                                            ? void deleteTeam(team.id)
                                            : void changeMembership(team, 'remove')
                                        }
                                        title="Remove team"
                                      >
                                        <Trash size={16} /> Remove
                                      </Button>
                                    </>
                                  </div>
                                </li>
                              ))}
                          </ul>

                          {reserveTeams.length > 0 && (
                            <>
                              <h3 className={adminStyles.sectionTitle}>Waiting ({reserveTeams.length})</h3>
                              <p className={adminStyles.smallNote}>
                                Checked teams join automatically when possible. Unchecked teams stay here for review.
                              </p>
                              <ul className={adminStyles.teamList}>
                                {reserveTeams.map((team) => (
                                  <li key={team.id} className={adminStyles.reserveTeam}>
                                    <div className={adminStyles.teamCard}>
                                      <img
                                        src={team.logo_url || DEFAULT_TEAM_LOGO}
                                        alt=""
                                        className={adminStyles.teamLogo}
                                        onError={(event) => {
                                          event.currentTarget.onerror = null;
                                          event.currentTarget.src = DEFAULT_TEAM_LOGO;
                                        }}
                                      />
                                      <div className={adminStyles.teamInfo}>
                                        <div className={adminStyles.teamNameRow}>
                                          {team.ht_team_id ? (
                                            <a
                                              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={adminStyles.teamLink}
                                            >
                                              {team.name}
                                            </a>
                                          ) : (
                                            <span className={adminStyles.name}>{team.name || 'Waiting team'}</span>
                                          )}
                                          {fixtureWarningTeamIds.has(team.id) && (
                                            <span title={standingsText('warningIssued')}>
                                              <img
                                                src="/warn-red.png"
                                                alt={standingsText('warningIssued')}
                                                className={styles.standingWarningIcon}
                                              />
                                            </span>
                                          )}
                                          {teamPlanningStatuses[team.id]?.inCup === true && (
                                            <span className={adminStyles.planningStatus}>[in cup]</span>
                                          )}
                                          {teamPlanningStatuses[team.id]?.bookedOutsideTournament && (
                                            <span
                                              className={`${adminStyles.planningStatus} ${adminStyles.planningStatusBooked}`}
                                            >
                                              [booked]
                                            </span>
                                          )}
                                        </div>
                                        <div className={adminStyles.teamMeta}>
                                          {team.ht_team_id && (
                                            <a
                                              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={adminStyles.teamMetaLink}
                                            >
                                              ID: {team.ht_team_id}
                                            </a>
                                          )}
                                          {team.manager_name && (
                                            <>
                                              <span className={adminStyles.teamMetaSeparator}>·</span>
                                              {team.hattrick_user_id ? (
                                                <a
                                                  href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${team.hattrick_user_id}`}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className={adminStyles.teamMetaLink}
                                                >
                                                  {team.manager_name}
                                                </a>
                                              ) : (
                                                <span>{team.manager_name}</span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    {canManageOperationalAdmin && (
                                      <div className={adminStyles.teamActions}>
                                        <label className={adminStyles.checkboxLabel}>
                                          <input
                                            type="checkbox"
                                            checked={team.actively_waiting === true}
                                            disabled={changingReserveId !== null}
                                            onChange={(event) =>
                                              void changeMembership(team, 'ready', event.currentTarget.checked)
                                            }
                                          />
                                          Auto promote
                                        </label>
                                        <Button
                                          type="button"
                                          size="xs"
                                          variant="primary"
                                          disabled={
                                            isSavingTeam ||
                                            changingReserveId !== null ||
                                            !tournamentAllowsTeamActions ||
                                            (isGenerated && !isSiteAdmin)
                                          }
                                          onClick={() => void changeMembership(team, 'promote')}
                                        >
                                          Promote
                                        </Button>
                                        <Button
                                          type="button"
                                          size="xs"
                                          variant="secondaryDanger"
                                          disabled={changingReserveId !== null}
                                          onClick={() => void changeMembership(team, 'remove')}
                                        >
                                          Remove
                                        </Button>
                                        {waitingReasons[team.id] && (
                                          <p className={adminStyles.waitingReason}>{waitingReasons[team.id]}</p>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}

                          {pastTeams.length > 0 && (
                            <>
                              <h3 className={adminStyles.sectionTitle}>
                                <span>Past teams ({pastTeams.length})</span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondaryAction"
                                  aria-expanded={isPastTeamsExpanded}
                                  aria-controls="admin-past-teams"
                                  onClick={() => setPastTeamsExpanded(!isPastTeamsExpanded)}
                                >
                                  {isPastTeamsExpanded ? 'Hide' : 'Show'}
                                </Button>
                              </h3>
                              <ul id="admin-past-teams" className={adminStyles.teamList} hidden={!isPastTeamsExpanded}>
                                {pastTeams.map((team) => (
                                  <li key={team.id} className={adminStyles.pastTeam}>
                                    <div className={adminStyles.teamCard}>
                                      <img
                                        src={team.logo_url || DEFAULT_TEAM_LOGO}
                                        alt=""
                                        className={adminStyles.teamLogo}
                                        onError={(event) => {
                                          event.currentTarget.onerror = null;
                                          event.currentTarget.src = DEFAULT_TEAM_LOGO;
                                        }}
                                      />
                                      <div className={adminStyles.teamInfo}>
                                        <div className={adminStyles.teamNameRow}>
                                          {team.ht_team_id ? (
                                            <a
                                              href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className={adminStyles.teamLink}
                                            >
                                              {team.name}
                                            </a>
                                          ) : (
                                            <span className={adminStyles.name}>{team.name}</span>
                                          )}
                                          {teamPlanningStatuses[team.id]?.inCup === true && (
                                            <span className={adminStyles.planningStatus}>[in cup]</span>
                                          )}
                                          {teamPlanningStatuses[team.id]?.bookedOutsideTournament && (
                                            <span
                                              className={`${adminStyles.planningStatus} ${adminStyles.planningStatusBooked}`}
                                            >
                                              [booked]
                                            </span>
                                          )}
                                          {fixtureWarningTeamIds.has(team.id) && (
                                            <span title={standingsText('warningIssued')}>
                                              <img
                                                src="/warn-red.png"
                                                alt={standingsText('warningIssued')}
                                                className={styles.standingWarningIcon}
                                              />
                                            </span>
                                          )}
                                        </div>
                                        {team.ht_team_id && (
                                          <div className={adminStyles.teamMeta}>ID: {team.ht_team_id}</div>
                                        )}
                                      </div>
                                    </div>
                                    {canManageOperationalAdmin && (
                                      <div className={adminStyles.teamActions}>
                                        {tournament.schedule_mode === 'length' ? null : isGenerated ? (
                                          reserveReplacingTeamId === team.id ? (
                                            <div className={adminStyles.inlineReplace}>
                                              <select
                                                className={adminStyles.selectField}
                                                value={selectedReserveTeamId}
                                                onChange={(event) => setSelectedReserveTeamId(event.target.value)}
                                                disabled={isSavingTeam}
                                              >
                                                <option value="">Choose Waiting team</option>
                                                {reserveTeams.map((reserveTeam) => (
                                                  <option key={reserveTeam.id} value={reserveTeam.id}>
                                                    {reserveTeam.name}
                                                  </option>
                                                ))}
                                              </select>
                                              <div className={adminStyles.replaceActions}>
                                                <Button
                                                  size="xs"
                                                  variant="action"
                                                  onClick={() => void replaceTeamWithReserve(team.id)}
                                                  disabled={isSavingTeam || !selectedReserveTeamId}
                                                >
                                                  Replace
                                                </Button>
                                                <Button
                                                  size="xs"
                                                  variant="secondary"
                                                  onClick={() => {
                                                    setReserveReplacingTeamId(null);
                                                    setSelectedReserveTeamId('');
                                                  }}
                                                >
                                                  Cancel
                                                </Button>
                                              </div>
                                            </div>
                                          ) : (
                                            <Button
                                              size="xs"
                                              variant="action"
                                              disabled={isSavingTeam || reserveTeams.length === 0}
                                              title={reserveTeams.length === 0 ? 'Add a Waiting team first' : undefined}
                                              onClick={() => {
                                                setReserveReplacingTeamId(team.id);
                                                setSelectedReserveTeamId('');
                                              }}
                                            >
                                              Replace
                                            </Button>
                                          )
                                        ) : replacingTeamId === team.id ? (
                                          <div className={adminStyles.inlineReplace}>
                                            <input
                                              type="text"
                                              placeholder="New HT ID"
                                              value={replacementHtId}
                                              onChange={(event) => {
                                                setReplacementHtId(event.target.value.replace(/\D/g, ''));
                                                setReplacementName('');
                                              }}
                                            />
                                            <input
                                              type="text"
                                              placeholder="New Name"
                                              value={replacementName}
                                              readOnly
                                              className={!replacementName ? styles.opacity06 : ''}
                                            />
                                            <div className={adminStyles.replaceActions}>
                                              {replacementHtId.length >= 6 && !replacementName && (
                                                <Button
                                                  size="xs"
                                                  variant="action"
                                                  onClick={() => fetchTeamData(replacementHtId, true)}
                                                  disabled={isFetchingTeamData}
                                                >
                                                  Check
                                                </Button>
                                              )}
                                              {replacementName && (
                                                <Button
                                                  size="xs"
                                                  variant="action"
                                                  onClick={() => replaceTeam(team.id)}
                                                  disabled={isSavingTeam}
                                                >
                                                  Replace
                                                </Button>
                                              )}
                                              <Button
                                                size="xs"
                                                variant="secondary"
                                                onClick={() => {
                                                  setReplacingTeamId(null);
                                                  setReplacementHtId('');
                                                  setReplacementName('');
                                                }}
                                              >
                                                Cancel
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <Button
                                            size="xs"
                                            variant="action"
                                            onClick={() => setReplacingTeamId(team.id)}
                                            disabled={isSavingTeam}
                                          >
                                            Replace
                                          </Button>
                                        )}
                                        <Button
                                          size="xs"
                                          variant="action"
                                          onClick={() => void changeMembership(team, 'return')}
                                          disabled={isSavingTeam}
                                          title="Return this team to Waiting, checked to join when possible"
                                        >
                                          To waiting
                                        </Button>
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}

                          <div className={adminStyles.inviteTemplate}>
                            <Button
                              size="sm"
                              variant="action"
                              onClick={() => setIsInviteExpanded(!isInviteExpanded)}
                              className={adminStyles.inviteBtn}
                            >
                              {isInviteExpanded ? 'Hide invitation' : 'Invite a Team'}
                            </Button>
                            {isInviteExpanded && (
                              <div className={adminStyles.templateBox}>
                                <label className={adminStyles.inviteLabel}>Invitation with Hattrick formatting</label>
                                <textarea
                                  readOnly
                                  value={`An invitation to join [b]${tournament.name}[/b] (Season ${tournament.season}) tournament on HT-120min! Register your team here: [link=${publicUrl}]`}
                                />
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `I'd like to invite you to join "${tournament.name}" (Season ${tournament.season}) tournament on HT-120min! Register your team here: ${publicUrl}`,
                                    );
                                    alert('Invitation copied!');
                                  }}
                                >
                                  Copy to clipboard
                                </Button>
                              </div>
                            )}
                          </div>
                        </SectionCard>
                      </div>

                      <div id="admin-panel-season">
                        <SectionCard
                          title="Manage Season"
                          className={adminStyles.seasonPlannerCard}
                          collapsible
                          isCollapsed={resolvedSeasonCollapsed}
                          onToggleCollapse={() => togglePanel('season', !resolvedSeasonCollapsed, setIsSeasonCollapsed)}
                        >
                          <div className={adminStyles.seasonPlanner}>
                            {previousSeasons.length > 0 && (
                              <div>
                                <h3>Previous seasons</h3>
                                <ul className={adminStyles.seasonList}>
                                  {previousSeasons.map((season) => (
                                    <li key={season.id}>
                                      <span>
                                        Season {season.season_number} {season.status}
                                      </span>
                                      {season.snapshot_json &&
                                        (!('version' in season.snapshot_json) ||
                                          season.snapshot_json.version !== 2) && (
                                          <Button
                                            variant="zero"
                                            size="xs"
                                            onClick={() => handleRebuildSeasonSnapshot(season)}
                                            disabled={rebuildingSeasonNumber !== null}
                                          >
                                            {rebuildingSeasonNumber === season.season_number
                                              ? 'Rebuilding...'
                                              : 'Rebuild archive'}
                                          </Button>
                                        )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div>
                              <h3>Current season</h3>
                              <p className={adminStyles.seasonCurrent}>
                                Season {tournament.season} {currentSeason?.status || tournament.status}
                                {tournament.status === 'finished'
                                  ? formatHistoryDate(currentSeason?.finished_at) &&
                                    ` • Finished ${formatHistoryDate(currentSeason?.finished_at)}`
                                  : isGenerated
                                    ? formatHistoryDate(
                                        currentSeason?.started_at || tournament.schedule_generated_at,
                                      ) &&
                                      ` • Started ${formatHistoryDate(currentSeason?.started_at || tournament.schedule_generated_at)}`
                                    : formatHistoryDate(
                                        currentSeason?.planned_start_slot || tournament.schedule_start_slot,
                                      ) &&
                                      ` • Planned ${formatHistoryDate(currentSeason?.planned_start_slot || tournament.schedule_start_slot)}`}
                              </p>
                              <p className={adminStyles.smallNote}>
                                {tournament.status === 'finished' && !currentSeason?.snapshot_json
                                  ? 'This season is finished, but its History report has not been generated yet.'
                                  : tournament.status === 'finished'
                                    ? 'This season is finished and preserved in History. You can now add a new season.'
                                    : isCurrentSeasonPlanned
                                      ? 'Set the season as started to close registration. You can then add fixtures manually or generate a schedule.'
                                      : "Mark the season finished when it's complete. That lets you generate History report and start a new one.\nReset to planning to start from scratch (only available when no matches played, otherwise reschedule rounds)."}
                              </p>
                              <div className={adminStyles.seasonActions}>
                                {isCurrentSeasonPlanned && tournament.status !== 'planning' && (
                                  <Button
                                    variant="primaryAction"
                                    size="sm"
                                    onClick={handleStartSeason}
                                    disabled={isFinalizingSeason}
                                  >
                                    {isFinalizingSeason ? 'Starting...' : 'Set season as started'}
                                  </Button>
                                )}
                                {currentSeason?.status === 'ongoing' && canManageOperationalAdmin && (
                                  <Button
                                    variant="secondaryDanger"
                                    size="sm"
                                    onClick={() => void handleResetSeasonToPlanning()}
                                    disabled={isFinalizingSeason}
                                  >
                                    {isFinalizingSeason ? 'Resetting...' : 'Reset to planning'}
                                  </Button>
                                )}
                                {canMarkSeasonFinished && (
                                  <Button
                                    variant="secondaryDanger"
                                    size="sm"
                                    onClick={handleFinishSeason}
                                    disabled={isFinalizingSeason}
                                  >
                                    {isFinalizingSeason ? 'Finishing...' : 'Mark as finished'}
                                  </Button>
                                )}
                                {tournament.status === 'finished' && !currentSeason?.snapshot_json && (
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={handleGenerateHistoryReport}
                                    disabled={isFinalizingSeason}
                                  >
                                    {isFinalizingSeason ? 'Generating...' : 'Generate history report'}
                                  </Button>
                                )}
                                {tournament.status === 'finished' && currentSeason?.snapshot_json && (
                                  <div className={adminStyles.seasonBtnContainer}>
                                    <Button
                                      variant="secondaryAction"
                                      size="sm"
                                      onClick={handleClearHistoryReport}
                                      disabled={isFinalizingSeason}
                                    >
                                      {isFinalizingSeason ? 'Clearing...' : 'Clear history report'}
                                    </Button>
                                    <div className={adminStyles.seasonBtns}>
                                      <Button
                                        variant="primaryAction"
                                        size="sm"
                                        onClick={() => handleStartNewSeason('auto')}
                                        disabled={isAddingSeason}
                                        data-tooltip-id="auto-start-season-tooltip"
                                      >
                                        {isAddingSeason
                                          ? 'Starting...'
                                          : `Auto-start Season ${(tournament.season || 1) + 1}`}
                                      </Button>
                                      <Tooltip
                                        id="auto-start-season-tooltip"
                                        className="tooltip"
                                        content="Keeps the existing roster. The next season starts with a clean table and waits for you to generate a new schedule."
                                      />
                                      <Button
                                        variant="primaryAction"
                                        size="sm"
                                        onClick={() => handleStartNewSeason('open')}
                                        disabled={isAddingSeason}
                                        data-tooltip-id="open-next-season-tooltip"
                                      >
                                        Open Season {(tournament.season || 1) + 1} registration
                                      </Button>
                                      <Tooltip
                                        id="open-next-season-tooltip"
                                        className="tooltip"
                                        content="Opens a new roster. Previous teams stay as quiet re-application suggestions for their owners."
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </SectionCard>
                      </div>
                      {!tournament.is_test &&
                        !isSandbox &&
                        !tournament.is_archived &&
                        !['finished', 'stopped', 'archived'].includes(tournament.status) && (
                          <SectionCard
                            title={themeText(
                              tournament.status === 'planning'
                                ? 'planningState'
                                : tournament.status === 'recruiting'
                                  ? 'recruitingState'
                                  : 'publishedState',
                            )}
                          >
                            <p>
                              {themeText(
                                tournament.status === 'planning' ? 'planningDescription' : 'recruitingDescription',
                              )}
                            </p>
                            <Button
                              type="button"
                              variant={tournament.status === 'planning' ? 'primary' : 'secondaryAction'}
                              disabled={isChangingPublication}
                              size="sm"
                              className="mt-1 mb-1"
                              onClick={() =>
                                void onPublicationChange(tournament.status === 'planning' ? 'recruiting' : 'planning')
                              }
                            >
                              {themeText(
                                isChangingPublication
                                  ? 'changingPublication'
                                  : tournament.status === 'planning'
                                    ? 'publishTournament'
                                    : 'returnToPlanning',
                              )}
                            </Button>
                          </SectionCard>
                        )}
                    </>
                  )}

                  <div id="admin-panel-announcements">
                    <SectionCard
                      title="Cup Announcements"
                      collapsible
                      isCollapsed={isAnnouncementsCollapsed}
                      onToggleCollapse={() =>
                        togglePanel('announcements', !isAnnouncementsCollapsed, setIsAnnouncementsCollapsed)
                      }
                    >
                      <p className={adminStyles.smallNote}>
                        Publish a dismissible message in the top tournament notice area.
                      </p>
                      <AdminAnnouncementComposer
                        onPublishAnnouncement={async (input) => {
                          await handleAnnouncementPublish(input);
                        }}
                      />

                      <div className={adminStyles.announcementList}>
                        {announcements.length === 0 ? (
                          <>
                            <h4>Current announcements</h4>
                            <p className={adminStyles.smallNote}>No announcements yet.</p>
                          </>
                        ) : (
                          announcements.map((announcement) => (
                            <div
                              key={announcement.id}
                              className={`${adminStyles.announcementListItem} ${
                                !announcement.is_active ? adminStyles.announcementHidden : ''
                              }`}
                            >
                              <div>
                                <p>{announcement.content}</p>
                                <span>
                                  {announcement.visibility === 'public' ? 'Public' : 'Participants'} •{' '}
                                  {announcement.is_active ? 'Visible' : 'Hidden'} •{' '}
                                  {new Date(announcement.created_at).toLocaleDateString('en-GB', {
                                    timeZone: 'Europe/Riga',
                                  })}
                                </span>
                              </div>
                              <Button
                                variant="zero"
                                size="sm"
                                onClick={() => handleAnnouncementVisibilityToggle(announcement)}
                              >
                                {announcement.is_active ? 'Hide for all' : 'Show for all'}
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </SectionCard>
                  </div>

                  {!isPressOfficer && oauthRoleAccess && (
                    <div id="admin-panel-roles">
                      <SectionCard
                        title="Roles & Access"
                        collapsible
                        isCollapsed={isRolesCollapsed}
                        onToggleCollapse={() => togglePanel('roles', !isRolesCollapsed, setIsRolesCollapsed)}
                      >
                        <TournamentRolesPanel
                          tournamentId={tournament.id}
                          roles={tournamentRoles}
                          originalOrganizer={originalOrganizer}
                          canManageAdmins={Boolean(roleAccess?.canManageAdmins && oauthRoleAccess)}
                          canManagePressOfficer={Boolean(roleAccess?.canManagePressOfficer && oauthRoleAccess)}
                          canManageCoOrganizer={Boolean(roleAccess?.canManageCoOrganizer && oauthRoleAccess)}
                          onRolesChanged={setTournamentRoles}
                        />
                      </SectionCard>
                    </div>
                  )}
                  {isSiteAdmin && !isSandbox && (
                    <SectionCard title="Site admin tools">
                      <p className={adminStyles.smallNote}>
                        Create a private, detached sandbox using the current competition settings and effective roster.
                        Team metadata is refreshed from Hattrick before the copy is created.
                      </p>
                      <p className={adminStyles.smallNote}>
                        Update stored manager snapshots for active managers in this tournament. Reserves and
                        placeholders are excluded.
                      </p>
                      <div className={adminStyles.settingsActions}>
                        <Button
                          type="button"
                          variant="secondaryAction"
                          size="sm"
                          onClick={duplicateAsSandbox}
                          disabled={isDuplicatingSandbox || isRefreshingSpotlight}
                        >
                          {isDuplicatingSandbox ? 'Creating sandbox…' : 'Duplicate as sandbox'}
                        </Button>
                        <Button
                          type="button"
                          variant="secondaryAction"
                          size="sm"
                          onClick={refreshSpotlightProfiles}
                          disabled={isDuplicatingSandbox || isRefreshingSpotlight}
                        >
                          {isRefreshingSpotlight ? 'Updating manager snapshots…' : 'Update manager snapshots'}
                        </Button>
                      </div>
                    </SectionCard>
                  )}

                  <div id="admin-panel-lifecycle" className={adminStyles.footerActions}>
                    {tournament.status === 'planning' ? (
                      <p className={adminStyles.lifecycleHelp}>{themeText('planningDescription')}</p>
                    ) : tournament.status === 'finished' ? (
                      <>
                        <p className={adminStyles.lifecycleHelp}>
                          Until a new season is started, this tournament is considered finished. Its history stays
                          visible, but participating teams can join or create other tournaments.
                        </p>
                        <div className={adminStyles.lifecycleButtons}>
                          <Button variant="zero" size="sm" disabled>
                            Finished
                          </Button>
                          {canToggleArchiveTournament && (
                            <Button
                              variant={tournament.is_archived ? 'secondaryAction' : 'danger'}
                              size="sm"
                              onClick={() => void handleArchiveTournament()}
                              disabled={isArchivingTournament}
                            >
                              {isArchivingTournament
                                ? tournament.is_archived
                                  ? 'Unarchiving...'
                                  : 'Archiving...'
                                : tournament.is_archived
                                  ? 'Unarchive'
                                  : 'Archive'}
                            </Button>
                          )}
                        </div>
                      </>
                    ) : tournament.status === 'stopped' ? (
                      <>
                        <p className={adminStyles.lifecycleHelp}>
                          This tournament is fully stopped and unpublished. Teams may join other tournaments. Move it to
                          paused only after removing or replacing any team already playing elsewhere.
                        </p>
                        <div className={adminStyles.lifecycleButtons}>
                          <Button variant="secondaryAction" size="sm" onClick={handleMoveStoppedToPaused}>
                            Full stopped. Move to paused.
                          </Button>
                          {canToggleArchiveTournament && (
                            <Button
                              variant={tournament.is_archived ? 'secondaryAction' : 'danger'}
                              size="sm"
                              onClick={() => void handleArchiveTournament()}
                              disabled={isArchivingTournament}
                            >
                              {isArchivingTournament
                                ? tournament.is_archived
                                  ? 'Unarchiving...'
                                  : 'Archiving...'
                                : tournament.is_archived
                                  ? 'Unarchive'
                                  : 'Archive'}
                            </Button>
                          )}
                        </div>
                      </>
                    ) : tournament.status === 'paused' ? (
                      <>
                        <p className={adminStyles.lifecycleHelp}>
                          This tournament is paused. Teams can still join and admins can edit participants, but schedule
                          generation and rescheduling stay hidden until it is active.
                        </p>
                        <div className={adminStyles.lifecycleButtons}>
                          <Button variant="primary" size="sm" onClick={handleSetPausedTournamentActive}>
                            Paused. Set as active!
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className={adminStyles.lifecycleHelp}>
                          This tournament is active. Pause it to wait for teams or take a break. Stop it to halt the
                          tournament, unpublish it and allow participants to play elsewhere.
                        </p>
                        <div className={adminStyles.lifecycleButtons}>
                          <Button variant="zero" size="sm" onClick={handlePauseTournament}>
                            Pause Tournament
                          </Button>
                          <Button
                            variant="zero"
                            size="sm"
                            onClick={handleStopTournament}
                            data-tooltip-id="admin-tooltip"
                            data-tooltip-content={
                              'Stopping a tournament means the schedule is halted, the tournament is unpublished from public lists, and participants are allowed to join another tournament.'
                            }
                          >
                            Stop Tournament
                          </Button>
                        </div>
                      </>
                    )}
                    {/* PERMANENTLY DELETE TOURNAMENT *
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => window.confirm('Permanently DELETE this tournament? This cannot be undone!')}
                >
                    Delete Tournament
                  </Button> */}
                  </div>
                </section>
                <aside className={adminStyles.adminSidebar}>
                  <ReusableWidget title="Admin" icon={<Info size={20} weight="bold" />}>
                    <div className={adminStyles.accessCard}>
                      <span className={adminStyles.accessLabel}>Accessing as:</span>
                      <strong>
                        {adminAccessName} <span>({adminAccessMode})</span>
                      </strong>
                      <button type="button" className={styles.fixturesHeaderAction} onClick={handleAdminLogout}>
                        <span>LOGOUT</span>
                      </button>
                    </div>
                    <div className={adminStyles.adminLinksCard}>
                      <span className={adminStyles.accessLabel}>Quick links</span>
                      {ADMIN_PANELS.filter((panel) => {
                        if (isPressOfficer) return panel.id === 'announcements';
                        if (panel.id === 'roles') return oauthRoleAccess;
                        if (panel.id === 'schedule') return canManageSchedule;
                        if (panel.id === 'results') return canManageSchedule;
                        return true;
                      }).map((panel) => (
                        <button
                          key={panel.id}
                          type="button"
                          className={adminStyles.adminLinkButton}
                          onClick={() => scrollToAdminPanel(panel.id)}
                          data-tooltip-id="admin-tooltip"
                          data-tooltip-content={panel.description}
                        >
                          <span>
                            {panel.id === 'schedule' && scheduleSetup === 'manual' ? 'Add matches' : panel.label}
                          </span>
                        </button>
                      ))}
                      <div className={styles.fixturesHeaderActions}>
                        <button type="button" className={styles.fixturesHeaderAction} onClick={expandAllAdminPanels}>
                          <span>EXPAND ALL</span>
                        </button>
                        <button type="button" className={styles.fixturesHeaderAction} onClick={collapseAllAdminPanels}>
                          <span>COLLAPSE ALL</span>
                        </button>
                      </div>
                    </div>
                  </ReusableWidget>
                  <CompactAccordionWidget
                    title="Tournament Settings FAQ"
                    icon={<Question size={20} weight="bold" />}
                    items={tournamentSettingsFaqItems}
                  />
                </aside>
              </div>
              <Tooltip id="admin-tooltip" className="tooltip" />
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={isScheduleConfirmationOpen}
        onClose={() => setIsScheduleConfirmationOpen(false)}
        title="Generate schedule?"
        appearance="plain"
        maxWidth="520px"
      >
        <p>
          Generate{' '}
          {usesLengthSchedulePlanner && lengthScheduleDraft.selectedFormat
            ? `${lengthScheduleDraft.selectedFormat.totalRounds} reserved rounds`
            : 'the schedule'}{' '}
          with {activeScheduleTeams.length} teams and start Season {tournament.season}?
        </p>
        {usesLengthSchedulePlanner && (
          <p>Only Round 1 is paired now. Later rounds are generated after the current round is resolved.</p>
        )}
        {schedulePreflightWarning && <p className={adminStyles.scheduleWarning}>⚠️ {schedulePreflightWarning}</p>}
        {activeScheduleTeams.length % 2 !== 0 && (
          <p>One team will have a BYE each round. You can define a house rule for how those teams earn points.</p>
        )}
        <div className={styles.modalFooter}>
          <Button type="button" variant="secondary" onClick={() => setIsScheduleConfirmationOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void confirmGenerateSchedule()}>
            Generate schedule
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(scheduleNotice)}
        onClose={closeScheduleNotice}
        title={scheduleNotice?.title}
        appearance="plain"
        maxWidth="520px"
      >
        <p>{scheduleNotice?.message}</p>
        <div className={styles.modalFooter}>
          <Button type="button" variant="primary" onClick={closeScheduleNotice}>
            {scheduleNotice?.showMatches ? 'OK · View matches' : 'OK'}
          </Button>
        </div>
      </Modal>
    </>
  );
};
