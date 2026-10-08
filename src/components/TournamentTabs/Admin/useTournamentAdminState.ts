'use client';

import { useState } from 'react';
import type { FetchedTeamData, MatchWithTeams, ScheduleSetup, TeamPlanningStatus } from '../../../legacy-pages/Public/TournamentView';
import type { TournamentOwnerRecord, TournamentRoleRecord } from './TournamentRolesPanel';

export function useTournamentAdminState() {
  const [tournamentRoles, setTournamentRoles] = useState<TournamentRoleRecord[]>([]);
  const [originalOrganizer, setOriginalOrganizer] = useState<TournamentOwnerRecord>({
    hattrick_user_id: null,
    manager_name: null,
  });
  const [roleAccessLoading, setRoleAccessLoading] = useState(false);
  const [adminAuthSource, setAdminAuthSource] = useState<'oauth_role' | 'legacy_password' | null>(null);
  const [adminAuthError, setAdminAuthError] = useState(false);
  const [failedLoginAttempt, setFailedLoginAttempt] = useState(false);
  const [isDuplicatingSandbox, setIsDuplicatingSandbox] = useState(false);
  const [isRefreshingSpotlight, setIsRefreshingSpotlight] = useState(false);
  const [isArchivingTournament, setIsArchivingTournament] = useState(false);
  const [newTeamId, setNewTeamId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamData, setNewTeamData] = useState<FetchedTeamData | null>(null);
  const [isReserveTeamFormOpen, setIsReserveTeamFormOpen] = useState(false);
  const [reserveTeamId, setReserveTeamId] = useState('');
  const [reserveTeamName, setReserveTeamName] = useState('');
  const [sandboxCandidate, setSandboxCandidate] = useState<FetchedTeamData | null>(null);
  const [sandboxFetchError, setSandboxFetchError] = useState('');
  const [isFetchingSandboxTeam, setIsFetchingSandboxTeam] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState<{ title: string; message: string; showMatches?: boolean } | null>(null);
  const [schedulePreflightWarning, setSchedulePreflightWarning] = useState<string | null>(null);
  const [isScheduleConfirmationOpen, setIsScheduleConfirmationOpen] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [editingMatch, setEditingMatch] = useState<string | null>(null);
  const [matchData, setMatchData] = useState<Record<string, Partial<MatchWithTeams>>>({});
  const [replacingTeamId, setReplacingTeamId] = useState<string | null>(null);
  const [reserveReplacingTeamId, setReserveReplacingTeamId] = useState<string | null>(null);
  const [selectedReserveTeamId, setSelectedReserveTeamId] = useState('');
  const [replacementHtId, setReplacementHtId] = useState('');
  const [replacementName, setReplacementName] = useState('');
  const [isFetchingTeamData, setIsFetchingTeamData] = useState(false);
  const [teamPlanningStatuses, setTeamPlanningStatuses] = useState<Record<string, TeamPlanningStatus>>({});
  const [isRefreshingTeamStatuses, setIsRefreshingTeamStatuses] = useState(false);
  const [teamStatusNotice, setTeamStatusNotice] = useState<string | null>(null);
  const [isUpdatingHfiRanks, setIsUpdatingHfiRanks] = useState(false);
  const [hfiRankNotice, setHfiRankNotice] = useState<string | null>(null);
  const [hfiRankNoticeIsError, setHfiRankNoticeIsError] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<'single' | 'double' | 'recurring'>('single');
  const [scheduleSetup, setScheduleSetup] = useState<ScheduleSetup>('generated');
  const [scheduleStartSlotId, setScheduleStartSlotId] = useState('');
  const [scheduleTeamOrder, setScheduleTeamOrder] = useState<string[] | null>(null);
  const [lengthFormatId, setLengthFormatId] = useState<string | null>(null);
  const [customLengthRoundCount, setCustomLengthRoundCount] = useState(1);
  const [isRepairingRound, setIsRepairingRound] = useState(false);
  const [isRecoveringRoundOne, setIsRecoveringRoundOne] = useState(false);
  const [includeWeek15WeekendFriendly, setIncludeWeek15WeekendFriendly] = useState(false);
  const [rescheduleFromRoundNumber, setRescheduleFromRoundNumber] = useState<number | null>(null);
  const [rescheduleStartSlotId, setRescheduleStartSlotId] = useState('');
  const [includeWeek15WeekendFriendlyForReschedule, setIncludeWeek15WeekendFriendlyForReschedule] = useState(false);
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editChppOnlyJoin, setEditChppOnlyJoin] = useState(true);
  const [editLeagueCategory, setEditLeagueCategory] = useState<'male' | 'hfi'>('male');
  const [editRegistrationType, setEditRegistrationType] = useState('validated');
  const [editCountryLimit, setEditCountryLimit] = useState<string | null>(null);
  const [editMaxTeams, setEditMaxTeams] = useState<number | null>(null);
  const [editRegistrationOpen, setEditRegistrationOpen] = useState(true);
  const [editAllowReserveRegistration, setEditAllowReserveRegistration] = useState(true);
  const [showEditDescription, setShowEditDescription] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [showEditEmail, setShowEditEmail] = useState(false);
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [editForumId, setEditForumId] = useState('');
  const [isUpdatingSettings, setIsUpdatingSettings] = useState(false);
  const [isResettingAdminPassword, setIsResettingAdminPassword] = useState(false);
  const [isTest, setIsTest] = useState(false);
  const [editIsFeatured, setEditIsFeatured] = useState(false);
  const [isInviteExpanded, setIsInviteExpanded] = useState(false);

  return {
    tournamentRoles, setTournamentRoles, originalOrganizer, setOriginalOrganizer,
    roleAccessLoading, setRoleAccessLoading, adminAuthSource, setAdminAuthSource,
    adminAuthError, setAdminAuthError, failedLoginAttempt, setFailedLoginAttempt,
    isDuplicatingSandbox, setIsDuplicatingSandbox, isRefreshingSpotlight, setIsRefreshingSpotlight,
    isArchivingTournament, setIsArchivingTournament,
    newTeamId, setNewTeamId, newTeamName, setNewTeamName, newTeamData, setNewTeamData,
    isReserveTeamFormOpen, setIsReserveTeamFormOpen, reserveTeamId, setReserveTeamId,
    reserveTeamName, setReserveTeamName, sandboxCandidate, setSandboxCandidate,
    sandboxFetchError, setSandboxFetchError, isFetchingSandboxTeam, setIsFetchingSandboxTeam,
    isSavingTeam, setIsSavingTeam, isGenerating, setIsGenerating, scheduleNotice, setScheduleNotice,
    schedulePreflightWarning, setSchedulePreflightWarning, isScheduleConfirmationOpen,
    setIsScheduleConfirmationOpen, isRescheduling, setIsRescheduling, editingMatch, setEditingMatch,
    matchData, setMatchData, replacingTeamId, setReplacingTeamId, reserveReplacingTeamId,
    setReserveReplacingTeamId, selectedReserveTeamId, setSelectedReserveTeamId,
    replacementHtId, setReplacementHtId, replacementName, setReplacementName,
    isFetchingTeamData, setIsFetchingTeamData, teamPlanningStatuses, setTeamPlanningStatuses,
    isRefreshingTeamStatuses, setIsRefreshingTeamStatuses, teamStatusNotice, setTeamStatusNotice,
    isUpdatingHfiRanks, setIsUpdatingHfiRanks, hfiRankNotice, setHfiRankNotice,
    hfiRankNoticeIsError, setHfiRankNoticeIsError, scheduleMode, setScheduleMode,
    scheduleSetup, setScheduleSetup, scheduleStartSlotId, setScheduleStartSlotId,
    scheduleTeamOrder, setScheduleTeamOrder, lengthFormatId, setLengthFormatId,
    customLengthRoundCount, setCustomLengthRoundCount, isRepairingRound, setIsRepairingRound,
    isRecoveringRoundOne, setIsRecoveringRoundOne, includeWeek15WeekendFriendly,
    setIncludeWeek15WeekendFriendly, rescheduleFromRoundNumber, setRescheduleFromRoundNumber,
    rescheduleStartSlotId, setRescheduleStartSlotId, includeWeek15WeekendFriendlyForReschedule,
    setIncludeWeek15WeekendFriendlyForReschedule, editName, setEditName, editIsPrivate, setEditIsPrivate,
    editChppOnlyJoin, setEditChppOnlyJoin, editLeagueCategory, setEditLeagueCategory,
    editRegistrationType, setEditRegistrationType, editCountryLimit, setEditCountryLimit,
    editMaxTeams, setEditMaxTeams, editRegistrationOpen, setEditRegistrationOpen,
    editAllowReserveRegistration, setEditAllowReserveRegistration, showEditDescription,
    setShowEditDescription, editDescription, setEditDescription, showEditEmail, setShowEditEmail,
    editAdminEmail, setEditAdminEmail, editForumId, setEditForumId, isUpdatingSettings,
    setIsUpdatingSettings, isResettingAdminPassword, setIsResettingAdminPassword, isTest, setIsTest,
    editIsFeatured, setEditIsFeatured, isInviteExpanded, setIsInviteExpanded,
  };
}
