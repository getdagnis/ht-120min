import React, { useState } from 'react';
import { Button } from '../../Button/Button';
import { SectionCard } from '../../Card/SectionCard';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';
import {
  formatCalendarDate,
  formatCalendarDateWithWeek,
  getCupWeekDecoration,
  getHattrickCalendarContext,
} from '../../../utils/hattrick-calendar';
import type { ScheduleDraftPreview, ScheduleMode } from '../../../utils/schedule-draft';
import type { RescheduleDraftPreview } from '../../../utils/reschedule-draft';

type ScheduleSetup = 'generated' | 'manual';
type MatchFetchWindow = 'current' | 'previous' | 'last50';
type MatchFetchCategory = 'friendlies' | 'cup' | 'league';

interface HtMatchAddPreview {
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

interface HtMatchSuggestion {
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

interface SchedulePanelTeam {
  id: string;
  name: string;
  ht_team_id: number;
  logo_url?: string | null;
  active?: boolean;
  is_placeholder?: boolean;
}

interface TournamentSchedulePanelProps {
  isGenerated: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  scheduleSetup: ScheduleSetup;
  draft: ScheduleDraftPreview;
  onScheduleModeChange: (mode: ScheduleMode) => void;
  onSelectedStartSlotIdChange: (value: string) => void;
  includeWeek15WeekendFriendly: boolean;
  onIncludeWeek15WeekendFriendlyChange: (value: boolean) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  tournamentTeamLimit?: number | null;
  teams?: SchedulePanelTeam[];
  generatedSummary?: {
    scheduleMode?: string | null;
    scheduleStartSlot?: string | null;
    scheduleLockedAt?: string | null;
    registrationClosedAt?: string | null;
    scheduleGeneratedAt?: string | null;
  };
  rescheduleDraft?: RescheduleDraftPreview | null;
  onRescheduleFromRoundChange?: (roundNumber: number) => void;
  onRescheduleStartSlotIdChange?: (value: string) => void;
  includeWeek15WeekendFriendlyForReschedule?: boolean;
  onIncludeWeek15WeekendFriendlyForRescheduleChange?: (value: boolean) => void;
  isRescheduling?: boolean;
  onReschedule?: () => void;
  previewHtMatchAdd?: (htMatchId: string) => Promise<HtMatchAddPreview>;
  saveHtMatchAdd?: (htMatchId: string, options?: { refreshFixtures?: boolean }) => Promise<void>;
  onRefreshFixtures?: () => Promise<void>;
  fetchHtMatchSuggestions?: (options?: {
    teamHtId?: number;
    offset?: number;
    fetchWindow?: MatchFetchWindow;
    matchCategories?: MatchFetchCategory[];
  }) => Promise<{ matches: HtMatchSuggestion[]; nextOffset: number; hasMore: boolean }>;
}

function formatModeLabel(mode: ScheduleMode) {
  if (mode === 'single') return 'Play each other once';
  if (mode === 'double') return 'Play each other twice';
  return 'Recurring schedule';
}

function formatModeReason(reason: string | null) {
  return reason || 'No valid start window found yet.';
}

function getPlannerTeamCount(draft: ScheduleDraftPreview, tournamentTeamLimit?: number | null) {
  if (tournamentTeamLimit && tournamentTeamLimit > 0) return tournamentTeamLimit;
  return draft.teamCount % 2 === 0 ? draft.teamCount : draft.teamCount + 1;
}

function formatSeasonWeek(slot: { ht120minSeason: number; htWeek: number }, includeWeekend = false) {
  return `S${slot.ht120minSeason} W${slot.htWeek}${includeWeekend ? ' (weekend)' : ''}`;
}

function formatStartOption(slot: ScheduleDraftPreview['startSlotOptions'][number], options?: { current?: boolean }) {
  const cupDecoration = getCupWeekDecoration(slot.htWeek);
  const current = options?.current ? ' (current)' : '';
  if (!slot.selectable && slot.kind === 'blocked_cup_week') {
    return `Week ${slot.htWeek} / ${formatShortDate(slot.nominalDate)} • ⛔️ ${cupDecoration?.label ?? 'Cup'}${current}`;
  }

  const cupSuffix = cupDecoration ? ` • ${cupDecoration.tone === 'warning' ? '⚠️' : '🟢'} ${cupDecoration.label}` : '';
  const weekend = slot.kind === 'weekend_friendly' ? ' (weekend)' : '';
  return `Week ${slot.htWeek} / ${formatShortDate(slot.nominalDate)}${weekend}${cupSuffix}${current}`;
}

function formatLeadTime(daysUntilStart: number | null) {
  if (daysUntilStart == null) return '? days';
  if (daysUntilStart > 14) return `${Math.floor(daysUntilStart / 7)} weeks from now`;
  return `${daysUntilStart} day${daysUntilStart === 1 ? '' : 's'}`;
}

function getSelectedStartWarning(daysUntilStart: number | null) {
  if (daysUntilStart == null) return null;
  if (daysUntilStart === 3 || daysUntilStart === 4) return `⚠️ In ${daysUntilStart} days`;
  if (daysUntilStart > 14) return `⚠️ In ${formatLeadTime(daysUntilStart)}`;
  return null;
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat('lv-LV', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatLongDate(date: Date) {
  return formatCalendarDateWithWeek(date, 'long');
}

function formatModeSummary(mode: ScheduleMode) {
  if (mode === 'single') return 'single round-robin';
  if (mode === 'double') return 'double round-robin';
  return 'recurring';
}

function formatMatchType(type: number | null) {
  if (type === 1) return 'League match';
  if (type === 3) return 'Cup match';
  if (type === 4) return 'Friendly';
  if (type === 5) return 'Cup friendly';
  if (type === 8) return 'International friendly';
  if (type === 9) return 'International cup friendly';
  return type ? `Match type ${type}` : 'Match type unknown';
}

function formatAddMatchDate(value: string | null) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export const TournamentSchedulePanel: React.FC<TournamentSchedulePanelProps> = ({
  isGenerated,
  isCollapsed,
  onToggleCollapse,
  scheduleSetup,
  draft,
  onScheduleModeChange,
  onSelectedStartSlotIdChange,
  includeWeek15WeekendFriendly,
  onIncludeWeek15WeekendFriendlyChange,
  isGenerating,
  onGenerate,
  tournamentTeamLimit,
  teams = [],
  rescheduleDraft,
  onRescheduleFromRoundChange,
  onRescheduleStartSlotIdChange,
  includeWeek15WeekendFriendlyForReschedule = false,
  onIncludeWeek15WeekendFriendlyForRescheduleChange,
  isRescheduling = false,
  onReschedule,
  previewHtMatchAdd,
  saveHtMatchAdd,
  onRefreshFixtures,
  fetchHtMatchSuggestions,
}) => {
  const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [addMatchInput, setAddMatchInput] = useState('');
  const [addMatchPreview, setAddMatchPreview] = useState<HtMatchAddPreview | null>(null);
  const [addMatchError, setAddMatchError] = useState('');
  const [addMatchNotice, setAddMatchNotice] = useState('');
  const [isCheckingAddMatch, setIsCheckingAddMatch] = useState(false);
  const [isSavingAddMatch, setIsSavingAddMatch] = useState(false);
  const [suggestionTeamId, setSuggestionTeamId] = useState<number | null>(null);
  const [suggestedMatches, setSuggestedMatches] = useState<HtMatchSuggestion[]>([]);
  const [suggestionsOffset, setSuggestionsOffset] = useState(0);
  const [suggestionsHasMore, setSuggestionsHasMore] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [suggestionsNotice, setSuggestionsNotice] = useState('');
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
  const [savingSuggestedMatchId, setSavingSuggestedMatchId] = useState<number | null>(null);
  const [isAddingAllSuggested, setIsAddingAllSuggested] = useState(false);
  const [renderTimestamp] = useState(() => Date.now());
  const [calendarContext] = useState(() => getHattrickCalendarContext());
  const [suggestionFetchWindow, setSuggestionFetchWindow] = useState<MatchFetchWindow>(() =>
    getHattrickCalendarContext().htWeek <= 3 ? 'previous' : 'current',
  );
  const [suggestionCategories, setSuggestionCategories] = useState<MatchFetchCategory[]>(['friendlies']);
  const [showSuggestionOptions, setShowSuggestionOptions] = useState(false);
  const plannerTeamCount = getPlannerTeamCount(draft, tournamentTeamLimit);
  const selectedStartWarning =
    draft.requestedStartSlotId && draft.selectedStartSlot && getCupWeekDecoration(draft.selectedStartSlot.htWeek)
      ? null
      : draft.requestedStartSlotId
        ? getSelectedStartWarning(draft.daysUntilStart)
        : null;
  const validStartSlotIds = new Set(draft.startSlotOptions.map((slot) => slot.id));
  const dropdownOptions = draft.allSlotOptions.flatMap((slot, index, slots) => {
    const previous = slots[index - 1];
    const header =
      !previous || previous.ht120minSeason !== slot.ht120minSeason
        ? [
            {
              kind: 'header' as const,
              id: `season-${slot.ht120minSeason} jump`,
              label: ``,
            },
            {
              kind: 'header' as const,
              id: `season-${slot.ht120minSeason}`,
              label: `HT-120min Season ${slot.ht120minSeason}`,
            },
          ]
        : [];
    return [...header, { kind: 'slot' as const, slot }];
  });
  const subtitle = draft.selectedStartSlot
    ? `Closest start date: ${formatCalendarDate(draft.selectedStartSlot.nominalDate)} (${formatLeadTime(draft.daysUntilStart)})`
    : 'No valid start window found';
  const firstRound = draft.rounds[0] || null;
  const lastRound = draft.rounds[draft.rounds.length - 1] || null;
  const rescheduleValidStartSlotIds = new Set(rescheduleDraft?.startSlotOptions.map((slot) => slot.id) ?? []);
  const rescheduleDropdownOptions = (rescheduleDraft?.allSlotOptions ?? []).flatMap((slot, index, slots) => {
    const previous = slots[index - 1];
    const header =
      !previous || previous.ht120minSeason !== slot.ht120minSeason
        ? [
            {
              kind: 'header' as const,
              id: `reschedule-season-${slot.ht120minSeason} jump`,
              label: ``,
            },
            {
              kind: 'header' as const,
              id: `reschedule-season-${slot.ht120minSeason}`,
              label: `HT-120min Season ${slot.ht120minSeason}`,
            },
          ]
        : [];
    return [...header, { kind: 'slot' as const, slot }];
  });
  const rescheduleLastRound = rescheduleDraft?.rounds[rescheduleDraft.rounds.length - 1] || null;
  const hasSelectedRescheduleRound = Boolean(rescheduleDraft?.selectedFromRoundNumber);
  const hasSelectedRescheduleStart = Boolean(rescheduleDraft?.selectedStartSlot);
  const hasSelectedStartSlot = Boolean(draft.requestedStartSlotId);
  const showCalendarPreview = hasSelectedStartSlot && draft.rounds.length > 0;
  const startSlotPlaceholder =
    draft.valid || draft.startSlotOptions.length > 0
      ? 'Select a start date...'
      : draft.reason === 'At least 2 active teams are required.'
        ? 'Not enough teams'
        : draft.reason || 'No valid start date';
  const invalidReason = !draft.valid ? draft.blockingReasons[0] || draft.reason : null;
  const canAddFetchedMatch = Boolean(addMatchPreview?.home_team_known && addMatchPreview?.away_team_known);
  const activeTeams = teams.filter((team) => team.active !== false && !team.is_placeholder && team.ht_team_id);
  const showPerTeamSuggestions = activeTeams.length > 4;
  const selectedSuggestionTeam = suggestionTeamId
    ? activeTeams.find((team) => Number(team.ht_team_id) === suggestionTeamId) || null
    : null;

  const handleFetchAddMatch = async () => {
    const htMatchId = addMatchInput.replace(/\D/g, '');
    if (!previewHtMatchAdd || htMatchId.length < 5) return;

    setIsCheckingAddMatch(true);
    setAddMatchError('');
    setAddMatchNotice('');
    setAddMatchPreview(null);
    try {
      setAddMatchPreview(await previewHtMatchAdd(htMatchId));
    } catch (error) {
      setAddMatchError(error instanceof Error ? error.message : 'Could not preview that match.');
    } finally {
      setIsCheckingAddMatch(false);
    }
  };

  const handleSaveAddMatch = async () => {
    if (!saveHtMatchAdd || !addMatchPreview || !canAddFetchedMatch) return;

    setIsSavingAddMatch(true);
    setAddMatchError('');
    setAddMatchNotice('');
    try {
      await saveHtMatchAdd(String(addMatchPreview.ht_match_id));
      setAddMatchInput('');
      setAddMatchPreview(null);
      setAddMatchNotice('Hattrick match added to fixtures.');
    } catch (error) {
      setAddMatchError(error instanceof Error ? error.message : 'Could not add that match.');
    } finally {
      setIsSavingAddMatch(false);
    }
  };

  const handleFetchSuggestions = async (options?: { append?: boolean; teamHtId?: number }) => {
    if (!fetchHtMatchSuggestions) return;
    const teamHtId = options?.teamHtId ?? suggestionTeamId ?? undefined;
    const append = Boolean(options?.append);

    setIsFetchingSuggestions(true);
    setSuggestionsError('');
    setSuggestionsNotice('');
    if (!append) {
      setSuggestedMatches([]);
      setSuggestionsOffset(0);
      setSuggestionsHasMore(false);
    }

    try {
      const result = await fetchHtMatchSuggestions({
        teamHtId,
        offset: append ? suggestionsOffset : 0,
        fetchWindow: suggestionFetchWindow,
        matchCategories: suggestionCategories,
      });
      setSuggestedMatches((current) => {
        const next = append ? [...current] : [];
        const known = new Set(next.map((match) => match.ht_match_id));
        for (const match of result.matches) {
          if (!known.has(match.ht_match_id)) {
            next.push(match);
            known.add(match.ht_match_id);
          }
        }
        return next;
      });
      setSuggestionsOffset(result.nextOffset);
      setSuggestionsHasMore(result.hasMore);
      if (!append && result.matches.length === 0) {
        setSuggestionsNotice('No additional matches found between registered teams.');
      }
    } catch (error) {
      setSuggestionsError(error instanceof Error ? error.message : 'Could not fetch suggested matches.');
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const handleFetchAllSuggestions = async () => {
    if (!fetchHtMatchSuggestions || activeTeams.length < 2) return;

    setIsFetchingSuggestions(true);
    setSuggestionsError('');
    setSuggestionsNotice('');
    setSuggestedMatches([]);
    setSuggestionsOffset(0);
    setSuggestionsHasMore(false);
    setSuggestionTeamId(null);

    const mergedMatches = new Map<number, HtMatchSuggestion>();

    try {
      for (const [teamIndex, team] of activeTeams.entries()) {
        setSuggestionsNotice(`Fetching ${teamIndex + 1} of ${activeTeams.length}: ${team.name}`);

        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          const result = await fetchHtMatchSuggestions({
            teamHtId: Number(team.ht_team_id),
            offset,
            fetchWindow: suggestionFetchWindow,
            matchCategories: suggestionCategories,
          });

          for (const match of result.matches) {
            mergedMatches.set(match.ht_match_id, match);
          }

          hasMore = result.hasMore && result.nextOffset > offset;
          offset = result.nextOffset;
        }
      }

      const now = renderTimestamp;
      const orderedMatches = [...mergedMatches.values()].sort((a, b) => {
        const aDate = a.match_date ? new Date(a.match_date).getTime() : 0;
        const bDate = b.match_date ? new Date(b.match_date).getTime() : 0;
        const aIsFuture = aDate > now;
        const bIsFuture = bDate > now;

        if (aIsFuture !== bIsFuture) return aIsFuture ? 1 : -1;
        return aIsFuture ? aDate - bDate : bDate - aDate;
      });

      setSuggestedMatches(orderedMatches);
      setSuggestionsNotice(
        orderedMatches.length === 0
          ? 'No additional matches found between registered teams.'
          : `${orderedMatches.length} unique match${orderedMatches.length === 1 ? '' : 'es'} found.`,
      );
    } catch (error) {
      setSuggestionsError(error instanceof Error ? error.message : 'Could not fetch all team matches.');
    } finally {
      setIsFetchingSuggestions(false);
    }
  };

  const handleAddSuggestedMatch = async (match: HtMatchSuggestion) => {
    if (!saveHtMatchAdd) return;
    setSavingSuggestedMatchId(match.ht_match_id);
    setSuggestionsError('');
    setSuggestionsNotice('');
    try {
      await saveHtMatchAdd(String(match.ht_match_id));
      setSuggestedMatches((current) => current.filter((item) => item.ht_match_id !== match.ht_match_id));
      setSuggestionsNotice('Match added to fixtures.');
    } catch (error) {
      setSuggestionsError(error instanceof Error ? error.message : 'Could not add that match.');
    } finally {
      setSavingSuggestedMatchId(null);
    }
  };

  const handleAddAllSuggestedMatches = async () => {
    if (!saveHtMatchAdd || suggestedMatches.length === 0) return;

    const matchesToAdd = [...suggestedMatches];
    let addedCount = 0;
    const failedMessages: string[] = [];

    setIsAddingAllSuggested(true);
    setSuggestionsError('');
    setSuggestionsNotice('');

    try {
      for (const [matchIndex, match] of matchesToAdd.entries()) {
        setSavingSuggestedMatchId(match.ht_match_id);
        setSuggestionsNotice(`Adding ${matchIndex + 1} of ${matchesToAdd.length}...`);

        try {
          await saveHtMatchAdd(String(match.ht_match_id), { refreshFixtures: false });
          addedCount += 1;
          setSuggestedMatches((current) => current.filter((item) => item.ht_match_id !== match.ht_match_id));
        } catch (error) {
          failedMessages.push(
            error instanceof Error ? error.message : `Could not add Hattrick match ${match.ht_match_id}.`,
          );
        }
      }

      if (addedCount > 0 && onRefreshFixtures) {
        await onRefreshFixtures();
      }

      setSuggestionsNotice(
        `${addedCount} match${addedCount === 1 ? '' : 'es'} added.` +
          (failedMessages.length > 0 ? ` ${failedMessages.length} failed and remain in the list.` : ''),
      );

      if (failedMessages.length > 0) {
        setSuggestionsError(failedMessages[0]);
      }
    } catch (error) {
      setSuggestionsError(error instanceof Error ? error.message : 'Could not finish adding the matches.');
    } finally {
      setSavingSuggestedMatchId(null);
      setIsAddingAllSuggested(false);
    }
  };

  const renderAddMatchPreview = () => {
    if (!addMatchPreview) return null;
    return (
      <div className={adminStyles.addHtMatchPreview}>
        <div className={adminStyles.addHtMatchTeams}>
          <div className={adminStyles.addHtMatchTeam}>
            {addMatchPreview.home_team?.logo_url && <img src={addMatchPreview.home_team.logo_url} alt="" />}
            <strong>
              {addMatchPreview.home_team?.name || addMatchPreview.actual_home_team_name || 'Unknown home'}
            </strong>
            <span>{addMatchPreview.home_team_known ? 'Registered team' : 'Not in this tournament'}</span>
          </div>
          <span className={adminStyles.addHtMatchScore}>
            {addMatchPreview.home_goals ?? '-'} - {addMatchPreview.away_goals ?? '-'}
          </span>
          <div className={adminStyles.addHtMatchTeam}>
            {addMatchPreview.away_team?.logo_url && <img src={addMatchPreview.away_team.logo_url} alt="" />}
            <strong>
              {addMatchPreview.away_team?.name || addMatchPreview.actual_away_team_name || 'Unknown away'}
            </strong>
            <span>{addMatchPreview.away_team_known ? 'Registered team' : 'Not in this tournament'}</span>
          </div>
        </div>
        <p className={adminStyles.addHtMatchMeta}>
          {formatAddMatchDate(addMatchPreview.match_date)} · {formatMatchType(addMatchPreview.match_type)} ·{' '}
          {addMatchPreview.status}
          {addMatchPreview.total_minutes ? ` · ${addMatchPreview.total_minutes}m` : ''}
        </p>
        {!canAddFetchedMatch && (
          <p className={adminStyles.scheduleDanger}>Both teams must be registered before this match can be added.</p>
        )}
      </div>
    );
  };

  const renderSuggestedMatch = (match: HtMatchSuggestion) => (
    <div key={match.ht_match_id} className={adminStyles.suggestedMatchRow}>
      <div className={adminStyles.addHtMatchTeam}>
        {match.home_team?.logo_url && <img src={match.home_team.logo_url} alt="" />}
        <strong>{match.home_team?.name || match.actual_home_team_name || 'Unknown home'}</strong>
      </div>
      <div className={adminStyles.suggestedMatchScore}>
        <strong>
          {match.home_goals ?? '-'} - {match.away_goals ?? '-'}
        </strong>
        <span>{formatAddMatchDate(match.match_date)}</span>
        <span>{formatMatchType(match.match_type)}</span>
      </div>
      <div className={adminStyles.addHtMatchTeam}>
        {match.away_team?.logo_url && <img src={match.away_team.logo_url} alt="" />}
        <strong>{match.away_team?.name || match.actual_away_team_name || 'Unknown away'}</strong>
      </div>
      <Button
        size="xs"
        variant="primary"
        onClick={() => void handleAddSuggestedMatch(match)}
        disabled={isAddingAllSuggested || savingSuggestedMatchId === match.ht_match_id}
      >
        {savingSuggestedMatchId === match.ht_match_id ? 'Adding...' : 'Add to fixtures'}
      </Button>
    </div>
  );

  const renderSuggestedMatches = () => {
    const now = renderTimestamp;
    const past = suggestedMatches.filter((match) => !match.match_date || new Date(match.match_date).getTime() <= now);
    const future = suggestedMatches.filter((match) => match.match_date && new Date(match.match_date).getTime() > now);

    return (
      <div className={adminStyles.suggestedMatches}>
        {suggestedMatches.length > 1 && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => void handleAddAllSuggestedMatches()}
            disabled={isAddingAllSuggested || isFetchingSuggestions}
          >
            {isAddingAllSuggested ? 'Adding matches...' : `Add all shown (${suggestedMatches.length})`}
          </Button>
        )}
        {past.length > 0 && (
          <>
            <h3>Suggested matches</h3>
            {past.map(renderSuggestedMatch)}
          </>
        )}
        {future.length > 0 && (
          <>
            <h3 className={adminStyles.secondaryTitle}>Future matches</h3>
            {future.map(renderSuggestedMatch)}
          </>
        )}
        {suggestionsHasMore && (
          <Button
            size="xs"
            variant="secondaryAction"
            onClick={() => void handleFetchSuggestions({ append: true })}
            disabled={isFetchingSuggestions || isAddingAllSuggested}
          >
            Load more
          </Button>
        )}
      </div>
    );
  };

  const toggleSuggestionCategory = (category: MatchFetchCategory) => {
    setSuggestionCategories((current) =>
      current.includes(category) ? current.filter((item) => item !== category) : [...current, category],
    );
    setSuggestedMatches([]);
    setSuggestionsOffset(0);
    setSuggestionsHasMore(false);
    setSuggestionsNotice('');
    setSuggestionsError('');
  };

  const handleSuggestionWindowChange = (window: MatchFetchWindow) => {
    setSuggestionFetchWindow(window);
    setSuggestedMatches([]);
    setSuggestionsOffset(0);
    setSuggestionsHasMore(false);
    setSuggestionsNotice('');
    setSuggestionsError('');
  };

  const renderSuggestionOptions = () => (
    <div className={adminStyles.matchFetchOptions}>
      <fieldset>
        <legend>Timeframe</legend>
        <label>
          <input
            type="radio"
            name="matchFetchWindow"
            value="current"
            checked={suggestionFetchWindow === 'current'}
            onChange={() => handleSuggestionWindowChange('current')}
          />
          This season ({calendarContext.htSeason})
        </label>
        <label>
          <input
            type="radio"
            name="matchFetchWindow"
            value="previous"
            checked={suggestionFetchWindow === 'previous'}
            onChange={() => handleSuggestionWindowChange('previous')}
          />
          Previous season ({calendarContext.htSeason - 1})
        </label>
        <label>
          <input
            type="radio"
            name="matchFetchWindow"
            value="last50"
            checked={suggestionFetchWindow === 'last50'}
            onChange={() => handleSuggestionWindowChange('last50')}
          />
          Last 50 matches
        </label>
      </fieldset>

      <fieldset>
        <legend>Match types</legend>
        {[
          ['friendlies', 'Friendlies'],
          ['cup', 'Cup matches'],
          ['league', 'League matches'],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={suggestionCategories.includes(value as MatchFetchCategory)}
              onChange={() => toggleSuggestionCategory(value as MatchFetchCategory)}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );

  const renderManualScheduleTools = () => (
    <div className={adminStyles.genOptions}>
      <div className={adminStyles.scheduleIntro}>
        <h2>No pre-made schedule</h2>
        <p className={adminStyles.scheduleSubtitle}>
          Add real Hattrick matches one by one. Teams must already be registered in this tournament.
        </p>
      </div>

      <div className={adminStyles.addHtMatchPanel}>
        {!manualAddOpen ? (
          <>
            {showPerTeamSuggestions ? (
              <div className={adminStyles.suggestionTeamList}>
                <p className={adminStyles.smallNote}>Fetch one team, or scan every registered team.</p>
                {activeTeams.map((team) => (
                  <Button
                    key={team.id}
                    size="xs"
                    variant={suggestionTeamId === Number(team.ht_team_id) ? 'secondaryAction' : 'action'}
                    onClick={() => {
                      setSuggestionTeamId(Number(team.ht_team_id));
                      void handleFetchSuggestions({ teamHtId: Number(team.ht_team_id) });
                    }}
                    disabled={isFetchingSuggestions || isAddingAllSuggested || suggestionCategories.length === 0}
                  >
                    {team.name}
                  </Button>
                ))}
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondaryAction"
                onClick={() => void handleFetchSuggestions()}
                disabled={
                  !fetchHtMatchSuggestions ||
                  activeTeams.length < 2 ||
                  isFetchingSuggestions ||
                  suggestionCategories.length === 0
                }
              >
                {isFetchingSuggestions ? 'Fetching matches...' : 'Fetch matches'}
              </Button>
            )}
            <div className={adminStyles.textLinks}>
              <button
                type="button"
                className={adminStyles.textLinkButton}
                onClick={() => setShowSuggestionOptions((current) => !current)}
              >
                {showSuggestionOptions ? 'Hide options' : 'Show options'}
              </button>
              <button type="button" className={adminStyles.textLinkButton} onClick={() => setManualAddOpen(true)}>
                Add matches manually
              </button>
            </div>
            {showSuggestionOptions && renderSuggestionOptions()}
            {showPerTeamSuggestions && (
              <Button
                size="xs"
                variant="primaryAction"
                onClick={() => void handleFetchAllSuggestions()}
                disabled={isFetchingSuggestions || isAddingAllSuggested || suggestionCategories.length === 0}
              >
                {isFetchingSuggestions ? 'Fetching matches...' : 'Fetch all teams'}
              </Button>
            )}
            {selectedSuggestionTeam && (
              <p className={adminStyles.smallNote}>Showing matches found from {selectedSuggestionTeam.name}.</p>
            )}
            {suggestionsError && <p className={adminStyles.scheduleDanger}>{suggestionsError}</p>}
            {suggestionsNotice && <p className={adminStyles.resultNotice}>{suggestionsNotice}</p>}
            {renderSuggestedMatches()}
          </>
        ) : (
          <>
            <div className={adminStyles.linkActions}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={10}
                value={addMatchInput}
                onChange={(event) => {
                  setAddMatchInput(event.target.value.replace(/\D/g, ''));
                  setAddMatchPreview(null);
                  setAddMatchError('');
                  setAddMatchNotice('');
                }}
                placeholder="Match ID"
                className={adminStyles.matchIdInput}
              />
              <Button
                size="xs"
                variant="secondaryAction"
                onClick={() => void handleFetchAddMatch()}
                disabled={!previewHtMatchAdd || addMatchInput.replace(/\D/g, '').length < 5 || isCheckingAddMatch}
              >
                Fetch match
              </Button>
              {addMatchPreview && canAddFetchedMatch && (
                <Button
                  size="xs"
                  variant="primary"
                  onClick={() => void handleSaveAddMatch()}
                  disabled={isSavingAddMatch}
                >
                  Add to fixtures
                </Button>
              )}
            </div>
            <button type="button" className={adminStyles.textLinkButton} onClick={() => setManualAddOpen(false)}>
              Back to suggested matches
            </button>
            {isCheckingAddMatch && <p className={adminStyles.smallNote}>Fetching match...</p>}
            {addMatchError && <p className={adminStyles.scheduleDanger}>{addMatchError}</p>}
            {addMatchNotice && <p className={adminStyles.resultNotice}>{addMatchNotice}</p>}
            {renderAddMatchPreview()}
          </>
        )}
      </div>
    </div>
  );

  return (
    <SectionCard
      title={scheduleSetup === 'manual' ? 'Add HT matches' : isGenerated ? 'Manage schedule' : 'Generate a schedule'}
      className={adminStyles.scheduleCard}
      collapsible
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      {scheduleSetup === 'manual' ? (
        renderManualScheduleTools()
      ) : !isGenerated ? (
        <div className={adminStyles.genOptions}>
          <div className={adminStyles.scheduleIntro}>
            <h2>{plannerTeamCount} team tournament</h2>
            <p className={adminStyles.scheduleSubtitle}>{subtitle}</p>
          </div>

          <div className={adminStyles.checkboxGroup}>
            {draft.availableModes.map((option) => (
              <label
                key={option.mode}
                className={adminStyles.checkboxLabel}
                aria-disabled={!option.available}
                title={option.available ? undefined : formatModeReason(option.reason)}
              >
                <input
                  type="radio"
                  name="scheduleMode"
                  checked={draft.mode === option.mode}
                  disabled={!option.available}
                  onChange={() => onScheduleModeChange(option.mode)}
                />
                <div className={adminStyles.labelRow}>
                  <span>{formatModeLabel(option.mode)}</span>
                  {!option.available && (
                    <span className={adminStyles.smallNote}>{formatModeReason(option.reason)}</span>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className={adminStyles.startSlotGroup}>
            <h3 className={adminStyles.startSlotLabel}>Choose start date</h3>
            <select
              className={adminStyles.startSlotSelect}
              value={draft.requestedStartSlotId || ''}
              onChange={(e) => onSelectedStartSlotIdChange(e.target.value)}
              disabled={draft.startSlotOptions.length === 0}
            >
              <option value="" disabled>
                {startSlotPlaceholder}
              </option>
              {dropdownOptions.map((option) =>
                option.kind === 'header' ? (
                  <option key={option.id} value={option.id} disabled>
                    {option.label}
                  </option>
                ) : (
                  <option
                    key={option.slot.id}
                    value={option.slot.id}
                    disabled={!option.slot.selectable || !validStartSlotIds.has(option.slot.id)}
                  >
                    {formatStartOption(option.slot)}
                  </option>
                ),
              )}
            </select>
            {selectedStartWarning && <p className={adminStyles.startSlotWarning}>{selectedStartWarning}</p>}
          </div>

          {draft.canIncludeWeek15WeekendFriendly && (
            <label className={adminStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={includeWeek15WeekendFriendly}
                onChange={(event) => onIncludeWeek15WeekendFriendlyChange(event.target.checked)}
              />
              <span>also include week 15 friendly match (possible qualifiers)</span>
            </label>
          )}

          {showCalendarPreview && (
            <div className={adminStyles.schedulePreview}>
              <h3>Calendar preview</h3>
              {draft.rounds.map((round) => (
                <div key={round.roundNumber} className={adminStyles.previewRow}>
                  <button
                    type="button"
                    className={adminStyles.previewToggle}
                    onClick={() =>
                      setExpandedRounds((current) => ({
                        ...current,
                        [round.roundNumber]: !current[round.roundNumber],
                      }))
                    }
                  >
                    <strong>Round {round.roundNumber}: </strong>
                    <span>
                      {' '}
                      {round.displayDateLabel} • {formatSeasonWeek(round.slot, round.slot.kind === 'weekend_friendly')}
                    </span>
                  </button>
                  {expandedRounds[round.roundNumber] && (
                    <div className={adminStyles.previewMatches}>
                      {round.matches.map((match) => (
                        <div
                          key={`${round.roundNumber}-${match.homeTeamId}-${match.awayTeamId}`}
                          className={adminStyles.roundRow}
                        >
                          {match.isBye ? (
                            <>
                              {match.homeTeamName === 'BYE' ? match.awayTeamName : match.homeTeamName}
                              <span> has a BYE</span>
                            </>
                          ) : (
                            <>
                              {match.homeTeamName}
                              <span className={adminStyles.rowmiddle}> vs</span> {match.awayTeamName}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {invalidReason && <p className={adminStyles.scheduleReason}>{invalidReason}</p>}

          {draft.valid && firstRound && lastRound && hasSelectedStartSlot && (
            <div className={adminStyles.scheduleNotice}>
              <span>
                Generate a schedule for a{' '}
                <strong>
                  {plannerTeamCount} team {formatModeSummary(draft.mode)}
                </strong>{' '}
                tournament that will start on <strong>{formatLongDate(firstRound.displayDate)}</strong> and last for{' '}
                <strong>{draft.roundCount} rounds</strong> with the last round played on{' '}
                <strong>{formatLongDate(lastRound.displayDate)}</strong>.
              </span>
            </div>
          )}

          <div className={adminStyles.scheduleAction}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onGenerate}
              disabled={!draft.valid || isGenerating || !hasSelectedStartSlot}
            >
              Generate a schedule
            </Button>
          </div>

          <p className="center w-100">Generating a schedule also closes registration and locks the selected start.</p>
        </div>
      ) : rescheduleDraft ? (
        <div className={adminStyles.genOptions}>
          <div className={adminStyles.scheduleIntro}>
            <h2>Regenerate schedule</h2>
            <p className={adminStyles.scheduleSubtitle}>Move future unarranged rounds without changing pairings.</p>
          </div>

          <div className={adminStyles.startSlotGroup}>
            <label className={adminStyles.startSlotLabel}>Regenerate from round</label>
            <select
              className={adminStyles.startSlotSelect}
              value={rescheduleDraft.selectedFromRoundNumber || ''}
              onChange={(event) => onRescheduleFromRoundChange?.(Number(event.target.value))}
              disabled={
                !onRescheduleFromRoundChange || rescheduleDraft.roundChoices.every((choice) => !choice.available)
              }
            >
              <option value="">Select...</option>
              {rescheduleDraft.roundChoices.map((choice) => (
                <option key={choice.roundNumber} value={choice.roundNumber} disabled={!choice.available}>
                  {choice.label}
                  {!choice.available && choice.reason ? ` - ${choice.reason}` : ''}
                </option>
              ))}
            </select>
          </div>

          {hasSelectedRescheduleRound && (
            <div className={adminStyles.startSlotGroup}>
              <label className={adminStyles.startSlotLabel}>New start date</label>
              <select
                className={adminStyles.startSlotSelect}
                value={rescheduleDraft.selectedStartSlotId || ''}
                onChange={(event) => onRescheduleStartSlotIdChange?.(event.target.value)}
                disabled={!onRescheduleStartSlotIdChange || rescheduleDraft.startSlotOptions.length === 0}
              >
                <option value="">Select...</option>
                {rescheduleDropdownOptions.map((option) =>
                  option.kind === 'header' ? (
                    <option key={option.id} value={option.id} disabled>
                      {option.label}
                    </option>
                  ) : (
                    <option
                      key={option.slot.id}
                      value={option.slot.id}
                      disabled={
                        !option.slot.selectable ||
                        !rescheduleValidStartSlotIds.has(option.slot.id) ||
                        option.slot.id === rescheduleDraft.currentStartSlotId
                      }
                    >
                      {formatStartOption(option.slot, {
                        current: option.slot.id === rescheduleDraft.currentStartSlotId,
                      })}
                    </option>
                  ),
                )}
              </select>
              {rescheduleDraft.daysUntilStart !== null &&
                rescheduleDraft.daysUntilStart <= 4 &&
                !(
                  rescheduleDraft.selectedStartSlot && getCupWeekDecoration(rescheduleDraft.selectedStartSlot.htWeek)
                ) && <p className={adminStyles.startSlotWarning}>⚠️ In {rescheduleDraft.daysUntilStart} days</p>}
            </div>
          )}

          {rescheduleDraft.canIncludeWeek15WeekendFriendly && (
            <label className={adminStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={includeWeek15WeekendFriendlyForReschedule}
                onChange={(event) => onIncludeWeek15WeekendFriendlyForRescheduleChange?.(event.target.checked)}
                disabled={!onIncludeWeek15WeekendFriendlyForRescheduleChange}
              />
              <span>also include week 15 friendly match (possible qualifiers)</span>
            </label>
          )}

          {hasSelectedRescheduleStart &&
            (rescheduleDraft.previousRounds.length > 0 || rescheduleDraft.rounds.length > 0) && (
              <div className={adminStyles.schedulePreview}>
                <h3>Calendar preview</h3>
                {rescheduleDraft.previousRounds.length > 0 && (
                  <>
                    <div className={adminStyles.previewSectionLabel}>Unchanged rounds</div>
                    {rescheduleDraft.previousRounds.map((round) => (
                      <div key={round.roundId} className={`${adminStyles.previewRow} ${adminStyles.previewRowMuted}`}>
                        <div className={`${adminStyles.previewToggle} ${adminStyles.previewToggleStatic}`}>
                          <strong>🗓 Round {round.roundNumber}</strong>
                          <span>
                            {round.displayDateLabel ? `• ${round.displayDateLabel}` : '• Date unavailable'}
                            {round.slot
                              ? ` • ${formatSeasonWeek(round.slot, round.slot.kind === 'weekend_friendly')}`
                              : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {rescheduleDraft.rounds.length > 0 && (
                  <div className={adminStyles.previewSectionLabel}>Regenerated rounds</div>
                )}
                {rescheduleDraft.rounds.map((round) => (
                  <div key={round.roundNumber} className={adminStyles.previewRow}>
                    <button
                      type="button"
                      className={adminStyles.previewToggle}
                      onClick={() =>
                        setExpandedRounds((current) => ({
                          ...current,
                          [round.roundNumber]: !current[round.roundNumber],
                        }))
                      }
                    >
                      <strong>Round {round.roundNumber}</strong>
                      <span>
                        • {round.displayDateLabel} •{' '}
                        {formatSeasonWeek(round.slot, round.slot.kind === 'weekend_friendly')}
                      </span>
                    </button>
                    {expandedRounds[round.roundNumber] && (
                      <div className={adminStyles.previewMatches}>
                        {round.matches.map((match) => (
                          <div key={match.matchId}>
                            {match.isBye ? (
                              <>
                                {match.homeTeamName === 'BYE' ? match.awayTeamName : match.homeTeamName}{' '}
                                <span>has a BYE</span>
                              </>
                            ) : (
                              <>
                                {match.homeTeamName}
                                <span> vs</span> {match.awayTeamName}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          {rescheduleDraft.valid && rescheduleDraft.rounds[0] && rescheduleLastRound && (
            <div className={adminStyles.scheduleNotice}>
              <h3>Just to check...</h3>
              <span>
                Move <strong>Round {rescheduleDraft.selectedFromRoundNumber}</strong> from{' '}
                <strong>{rescheduleDraft.currentRoundDateLabel || 'its current date'}</strong> to{' '}
                <strong>{formatLongDate(rescheduleDraft.rounds[0].displayDate)}</strong>. Any following rounds will
                follow automatically. Pairings remain unchanged, only dates are rescheduled. Previous rounds are
                unaffected.
              </span>
            </div>
          )}

          {hasSelectedRescheduleRound && !rescheduleDraft.valid && rescheduleDraft.reason && (
            <p className={adminStyles.smallNote}>{rescheduleDraft.reason}</p>
          )}

          {hasSelectedRescheduleStart && (
            <div className={adminStyles.scheduleAction}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={onReschedule}
                disabled={!rescheduleDraft.valid || isRescheduling || !onReschedule}
              >
                {isRescheduling ? 'Regenerating...' : 'Regenerate schedule'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={adminStyles.scheduleLockedState}>
          <p>Altering schedule for running tournaments is currently not possible. Contact app's author.</p>
        </div>
      )}
    </SectionCard>
  );
};
