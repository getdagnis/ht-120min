import React from 'react';
import { SectionCard } from '../../Card/SectionCard';
import { Button } from '../../Button/Button';
import { Check, ArrowClockwise, ArrowUpRight, X, PencilSimple, LinkSimple, Trash } from 'phosphor-react';
import { getCountryFlagUrl } from '../../../utils/ht-data';
import { getHattrickWeekDetails } from '../../../utils/hattrick-calendar';
import { APPG_OUTCOMES, appgOutcomeLabel, validateAppgOutcome, type AppgOutcome } from '../../../utils/appg';
import {
  parseResultCsv,
  RESULT_CSV_CLEAN_TEMPLATE,
  RESULT_CSV_TEMPLATE,
  type ResultCsvRow,
} from '../../../utils/result-csv';
import { createSandboxResultUpdates, type BulkMatchUpdate } from '../../../utils/sandbox-results';
import { isAppg120ScoringMode } from '../../../../shared/scoring-profile';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';

interface ResultTeam {
  name: string;
  ht_team_id: number;
  logo_url?: string;
  country_name?: string;
  country_id?: number | null;
  league_id?: number | null;
  active?: boolean;
  manager_name?: string;
}

interface MatchWithTeams {
  id: string;
  round_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  status?: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  ht_match_id?: number | null;
  scheduled_for?: string | null;
  appg_outcome?: AppgOutcome | null;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  match_date?: Date | null;
  home_team: ResultTeam | null;
  away_team: ResultTeam | null;
}

export type { BulkMatchUpdate } from '../../../utils/sandbox-results';

interface AdminResultsProps {
  rounds: {
    id: string;
    round_number: number;
    matches: MatchWithTeams[];
  }[];
  editingMatch: string | null;
  setEditingMatch: (matchId: string | null) => void;
  updateMatch: (matchId: string) => Promise<void>;
  isResultsCollapsed: boolean;
  setIsResultsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  togglePanel: (key: string, state: boolean, setter: React.Dispatch<React.SetStateAction<boolean>>) => void;
  matchData: Record<string, Partial<MatchWithTeams>>;
  setMatchData: React.Dispatch<React.SetStateAction<Record<string, Partial<MatchWithTeams>>>>;
  currentRoundId?: string;
  previewHtMatchLink: (matchId: string, htMatchId: string) => Promise<HtMatchLinkPreview>;
  saveHtMatchLink: (matchId: string, htMatchId: string) => Promise<void>;
  scoringMode?: string;
  saveBulkMatches?: (updates: Record<string, BulkMatchUpdate>) => Promise<void>;
  clearSeasonResults?: () => Promise<void>;
  clearSeasonFixtures?: () => Promise<void>;
  importCsvRows?: (rows: ResultCsvRow[]) => Promise<void>;
  isSandbox?: boolean;
  canRemoveFixtures?: boolean;
  onRemoveFixture?: (matchId: string) => Promise<void>;
}

interface HtMatchLinkPreview {
  ht_match_id: number;
  actual_home_team_name: string | null;
  actual_away_team_name: string | null;
  home_goals: number;
  away_goals: number;
  status: 'arranged' | 'ongoing' | 'finished';
  matched_both_tournament_teams: boolean;
}

const AdminResultTeam: React.FC<{ team: ResultTeam | null; side: 'home' | 'away' }> = ({ team, side }) => {
  const countryFlagUrl = getCountryFlagUrl(team?.country_id, team?.country_name);

  if (!team) {
    return (
      <div className={`${adminStyles.resultTeam} ${adminStyles[side]}`}>
        <span className={adminStyles.resultTeamFree}>Free to choose</span>
      </div>
    );
  }

  return (
    <div className={`${adminStyles.resultTeam} ${adminStyles[side]}`}>
      {countryFlagUrl && (
        <img
          src={countryFlagUrl}
          alt={team.country_name || 'Country'}
          title={team.country_name}
          className={adminStyles.resultFlag}
        />
      )}

      <div className={adminStyles.teamAndId}>
        {' '}
        <span className={adminStyles.resultTeamName}>{team.name}</span>
        <a
          href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className={adminStyles.resultTeamLink}
        >
          <span className={adminStyles.resultTeamId}>({team.ht_team_id})</span>
        </a>
      </div>
    </div>
  );
};

const ResultMinutes: React.FC<{ minutes: number; went120: boolean }> = ({ minutes, went120 }) => {
  if (!went120 || minutes <= 0) return null;

  return <span className={adminStyles.badge}>{minutes}m</span>;
};

const ResultEditButton: React.FC<{
  match: MatchWithTeams;
  hasResult?: boolean;
  roundId: string;
  currentRoundId?: string;
  matchData: Record<string, Partial<MatchWithTeams>>;
  setEditingMatch: (matchId: string | null) => void;
  setMatchData: React.Dispatch<React.SetStateAction<Record<string, Partial<MatchWithTeams>>>>;
}> = ({ match, hasResult = false, roundId, currentRoundId, matchData, setEditingMatch, setMatchData }) => {
  return (
    <Button
      size="xs"
      variant={hasResult ? 'action' : roundId === currentRoundId ? 'secondaryAction' : 'action'}
      onClick={() => {
        setEditingMatch(match.id);
        setMatchData({
          ...matchData,
          [match.id]: hasResult ? match : { ...match, home_goals: null, away_goals: null },
        });
      }}
      title={hasResult ? 'Edit result' : 'Enter result'}
      data-tooltip-id="admin-tooltip"
      data-tooltip-content={hasResult ? 'Edit result' : 'Enter result'}
    >
      <PencilSimple size={16} />
    </Button>
  );
};

const ResultLinkButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    size="xs"
    variant="action"
    onClick={onClick}
    title="Link Hattrick match"
    data-tooltip-id="admin-tooltip"
    data-tooltip-content="Link Hattrick match by ID (with at least one of the teams)"
  >
    <LinkSimple size={16} />
  </Button>
);

function getRoundDisplayDate(round: AdminResultsProps['rounds'][number]) {
  const match = round.matches.find((item) => item.scheduled_for || item.match_date) ?? null;
  if (!match) return null;
  return match.scheduled_for ? new Date(match.scheduled_for) : (match.match_date ?? null);
}

function formatRoundMeta(round: AdminResultsProps['rounds'][number]) {
  const roundDate = getRoundDisplayDate(round);
  if (!roundDate) return null;

  const week = getHattrickWeekDetails(roundDate);
  const dateLabel = roundDate.toLocaleDateString('lv-LV', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `W${week.htWeek} • ${dateLabel}`;
}

export const AdminResults: React.FC<AdminResultsProps> = ({
  rounds,
  editingMatch,
  setEditingMatch,
  updateMatch,
  isResultsCollapsed,
  setIsResultsCollapsed,
  togglePanel,
  matchData,
  setMatchData,
  currentRoundId,
  previewHtMatchLink,
  saveHtMatchLink,
  scoringMode = '120min',
  saveBulkMatches,
  clearSeasonResults,
  clearSeasonFixtures,
  importCsvRows,
  isSandbox = false,
  canRemoveFixtures = false,
  onRemoveFixture,
}) => {
  const [linkingMatchId, setLinkingMatchId] = React.useState<string | null>(null);
  const [linkInput, setLinkInput] = React.useState('');
  const [linkPreview, setLinkPreview] = React.useState<HtMatchLinkPreview | null>(null);
  const [linkError, setLinkError] = React.useState('');
  const [isCheckingLink, setIsCheckingLink] = React.useState(false);
  const [isSavingLink, setIsSavingLink] = React.useState(false);
  const [bulkMatchIds, setBulkMatchIds] = React.useState<string[]>([]);
  const [isSavingBulk, setIsSavingBulk] = React.useState(false);
  const [isRandomFilling, setIsRandomFilling] = React.useState(false);
  const [isClearingResults, setIsClearingResults] = React.useState(false);
  const [isClearingFixtures, setIsClearingFixtures] = React.useState(false);
  const [bulkEditScope, setBulkEditScope] = React.useState<'season' | 'round' | null>(null);
  const [removingMatchId, setRemovingMatchId] = React.useState<string | null>(null);
  const [resultNotice, setResultNotice] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const bulkMatches = React.useMemo(
    () => rounds.flatMap((round) => round.matches).filter((match) => bulkMatchIds.includes(match.id)),
    [bulkMatchIds, rounds],
  );
  const visibleRounds = React.useMemo(() => rounds.filter((round) => round.matches.length > 0), [rounds]);

  const setBulkValue = (matchId: string, values: Partial<MatchWithTeams>) => {
    setMatchData((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] || rounds.flatMap((round) => round.matches).find((match) => match.id === matchId)),
        ...values,
      },
    }));
  };

  const startBulkEditing = (matchIds: string[], scope: 'season' | 'round') => {
    setEditingMatch(null);
    setBulkMatchIds(matchIds);
    setBulkEditScope(scope);
    setMatchData((current) => {
      const next = { ...current };
      for (const matchId of matchIds) {
        if (!next[matchId]) {
          const match = rounds.flatMap((round) => round.matches).find((item) => item.id === matchId);
          if (match) next[matchId] = { ...match };
        }
      }
      return next;
    });
  };

  const cancelBulkEditing = () => {
    setBulkMatchIds([]);
    setBulkEditScope(null);
  };

  const saveBulkResults = async () => {
    if (!saveBulkMatches) return;
    setIsSavingBulk(true);
    try {
      const updates: Record<string, BulkMatchUpdate> = Object.fromEntries(
        bulkMatches.map((match) => {
          const draft = matchData[match.id] || match;
          const isBye = !match.home_team_id || !match.away_team_id;
          const normalizedDraft = isBye
            ? { ...draft, home_goals: draft.home_goals ?? 0, away_goals: draft.away_goals ?? 0 }
            : draft;
          if (isAppg120ScoringMode(scoringMode)) {
            const validationError = validateAppgOutcome({
              home_goals: normalizedDraft.home_goals ?? null,
              away_goals: normalizedDraft.away_goals ?? null,
              went_120: normalizedDraft.went_120 ?? false,
              total_minutes: normalizedDraft.total_minutes ?? 90,
              penalty_shootout_home_goals: normalizedDraft.penalty_shootout_home_goals ?? null,
              penalty_shootout_away_goals: normalizedDraft.penalty_shootout_away_goals ?? null,
              appg_outcome: normalizedDraft.appg_outcome ?? null,
            });
            if (validationError) {
              throw new Error(
                `${match.home_team?.name || 'BYE'} vs ${match.away_team?.name || 'BYE'}: ${validationError}`,
              );
            }
          }
          return [match.id, normalizedDraft];
        }),
      );
      await saveBulkMatches(updates);
      setBulkMatchIds([]);
      setBulkEditScope(null);
      setMatchData((current) => {
        const next = { ...current };
        bulkMatchIds.forEach((matchId) => delete next[matchId]);
        return next;
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not save results.');
    } finally {
      setIsSavingBulk(false);
    }
  };

  const randomFillMatches = async (matches: MatchWithTeams[]) => {
    if (!saveBulkMatches) return;
    const updates = createSandboxResultUpdates(matches, scoringMode);
    const updatedCount = Object.keys(updates).length;
    if (updatedCount === 0) {
      setResultNotice('No two-team fixtures are available to random-fill.');
      return;
    }

    setIsRandomFilling(true);
    try {
      await saveBulkMatches(updates);
      setResultNotice(`${updatedCount} fixture${updatedCount === 1 ? '' : 's'} random-filled.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not random-fill results.');
    } finally {
      setIsRandomFilling(false);
    }
  };

  const handleClearSeasonResults = async () => {
    if (!clearSeasonResults) return;
    const confirmed = window.confirm(
      'Clear every result in this season?\n\nThis removes all manually entered, imported and random-filled scores, minutes, penalty data and APPG classifications. Fixtures and linked Hattrick match IDs stay in place.',
    );
    if (!confirmed) return;

    setIsClearingResults(true);
    try {
      await clearSeasonResults();
      setBulkMatchIds([]);
      setBulkEditScope(null);
      setMatchData({});
      setResultNotice('All season results were cleared.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not clear season results.');
    } finally {
      setIsClearingResults(false);
    }
  };

  const handleClearSeasonFixtures = async () => {
    if (!clearSeasonFixtures) return;
    const confirmed = window.confirm(
      'Clear every fixture in this season?\n\nThis permanently removes all matches and their parent rounds. Teams and tournament settings stay in place.',
    );
    if (!confirmed) return;

    setIsClearingFixtures(true);
    try {
      await clearSeasonFixtures();
      setBulkMatchIds([]);
      setBulkEditScope(null);
      setMatchData({});
      setEditingMatch(null);
      setResultNotice('All season fixtures were cleared.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not clear season fixtures.');
    } finally {
      setIsClearingFixtures(false);
    }
  };

  const downloadCsvTemplate = (template: string, filename: string) => {
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !importCsvRows) return;
    try {
      await importCsvRows(parseResultCsv(await file.text()));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not import that CSV.');
    }
  };

  React.useEffect(() => {
    if (!linkingMatchId) return;
    const htMatchId = linkInput.replace(/\D/g, '');
    if (htMatchId.length < 5) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsCheckingLink(true);
      try {
        const preview = await previewHtMatchLink(linkingMatchId, htMatchId);
        if (!cancelled) setLinkPreview(preview);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not link that match.';
        if (!cancelled) setLinkError(message);
      } finally {
        if (!cancelled) setIsCheckingLink(false);
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [linkInput, linkingMatchId, previewHtMatchLink]);

  const startLinking = (match: MatchWithTeams) => {
    setEditingMatch(null);
    setLinkingMatchId(match.id);
    setLinkInput(match.ht_match_id ? String(match.ht_match_id) : '');
    setLinkPreview(null);
    setLinkError('');
  };

  const cancelLinking = () => {
    setLinkingMatchId(null);
    setLinkInput('');
    setLinkPreview(null);
    setLinkError('');
    setIsCheckingLink(false);
  };

  const handleSaveLink = async () => {
    if (!linkingMatchId || !linkPreview) return;
    setIsSavingLink(true);
    try {
      await saveHtMatchLink(linkingMatchId, String(linkPreview.ht_match_id));
      cancelLinking();
      setResultNotice('Match linked. Fixtures updated.');
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Could not link that match.');
    } finally {
      setIsSavingLink(false);
    }
  };

  const renderLinkEditor = () => (
    <div className={adminStyles.linkActions}>
      <input
        type="text"
        inputMode="numeric"
        maxLength={10}
        value={linkInput}
        onChange={(event) => {
          setLinkPreview(null);
          setLinkError('');
          setIsCheckingLink(false);
          setLinkInput(event.target.value.replace(/\D/g, ''));
        }}
        placeholder="Match ID"
        className={adminStyles.matchIdInput}
      />
      <Button
        size="xs"
        onClick={handleSaveLink}
        variant="primaryDanger"
        disabled={!linkPreview || isSavingLink}
        title="Save linked match"
        data-tooltip-id="admin-tooltip"
        data-tooltip-content={
          linkPreview
            ? `${linkPreview.actual_home_team_name || 'Home'} vs ${linkPreview.actual_away_team_name || 'Away'}`
            : isCheckingLink
              ? 'Checking match...'
              : linkError || 'Enter a valid Match ID'
        }
      >
        <Check size={16} />
      </Button>
      <Button
        size="xs"
        variant="action"
        onClick={cancelLinking}
        title="Cancel"
        data-tooltip-id="admin-tooltip"
        data-tooltip-content="Cancel"
      >
        <X size={16} />
      </Button>
    </div>
  );

  const renderMatchActions = (match: MatchWithTeams, hasResult: boolean, roundId: string) => (
    <div className={adminStyles.editActions}>
      {linkingMatchId === match.id ? (
        renderLinkEditor()
      ) : (
        <>
          <ResultLinkButton onClick={() => startLinking(match)} />
          <ResultEditButton
            match={match}
            hasResult={hasResult}
            roundId={roundId}
            currentRoundId={currentRoundId}
            matchData={matchData}
            setEditingMatch={setEditingMatch}
            setMatchData={setMatchData}
          />
          {canRemoveFixtures && onRemoveFixture && (
            <Button
              size="xs"
              variant="primaryDanger"
              onClick={async () => {
                setRemovingMatchId(match.id);
                try {
                  await onRemoveFixture(match.id);
                } finally {
                  setRemovingMatchId(null);
                }
              }}
              disabled={removingMatchId === match.id}
              title="Remove fixture"
              data-tooltip-id="admin-tooltip"
              data-tooltip-content="Remove fixture"
            >
              <Trash size={16} />
            </Button>
          )}
        </>
      )}
    </div>
  );

  return (
    <SectionCard
      title="Results Entry"
      collapsible
      isCollapsed={isResultsCollapsed}
      onToggleCollapse={() => togglePanel('results', !isResultsCollapsed, setIsResultsCollapsed)}
    >
      <div className={adminStyles.bulkResultToolbar}>
        {saveBulkMatches && (
          <>
            {isSandbox ? (
              <Button
                size="xs"
                variant="action"
                onClick={() => void randomFillMatches(rounds.flatMap((round) => round.matches))}
                disabled={isRandomFilling}
                title="Random-fill season"
                data-tooltip-id="admin-tooltip"
                data-tooltip-content="Generate and save random test results for every two-team fixture in this season."
              >
                <ArrowClockwise size={16} /> {isRandomFilling ? 'Random-filling...' : 'Random-fill season'}
              </Button>
            ) : (
              <Button
                size="xs"
                variant="secondaryAction"
                onClick={() =>
                  startBulkEditing(
                    rounds.flatMap((round) => round.matches.map((match) => match.id)),
                    'season',
                  )
                }
                title="Bulk edit season"
                data-tooltip-id="admin-tooltip"
                data-tooltip-content="Open one editor for every fixture in the current season."
              >
                Bulk Edit Season
              </Button>
            )}
            {importCsvRows && (
              <>
                <Button
                  size="xs"
                  variant="action"
                  onClick={() => downloadCsvTemplate(RESULT_CSV_CLEAN_TEMPLATE, 'ht-120min-results.csv')}
                  title="Download clean CSV"
                  data-tooltip-id="admin-tooltip"
                  data-tooltip-content="Download an empty CSV template for importing teams and match results."
                >
                  Download clean CSV
                </Button>
                <Button
                  size="xs"
                  variant="action"
                  onClick={() => downloadCsvTemplate(RESULT_CSV_TEMPLATE, 'ht-120min-results-example.csv')}
                  title="Download example CSV"
                  data-tooltip-id="admin-tooltip"
                  data-tooltip-content="Download an example CSV showing the supported team and result format."
                >
                  Download example CSV
                </Button>
                <Button
                  size="xs"
                  variant="action"
                  onClick={() => fileInputRef.current?.click()}
                  title="Import results CSV"
                  data-tooltip-id="admin-tooltip"
                  data-tooltip-content="Import teams and match results from an HT-120min CSV file."
                >
                  Import results CSV
                </Button>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFile} hidden />
              </>
            )}
          </>
        )}
      </div>
      {isAppg120ScoringMode(scoringMode) && importCsvRows && (
        <p className={adminStyles.appgCsvHelp}>
          ET3 = extra-time winner, open-play winning goal. ET2 = extra-time winner, SE/other winning goal. PS1 =
          penalties. RT0 = regulation result worth 0. OPW = regulation open-play winner gets -1. Missing or ambiguous
          event evidence remains needs_review.
        </p>
      )}
      {resultNotice && (
        <p className={adminStyles.resultNotice} role="status">
          {resultNotice}
        </p>
      )}
      <div className={adminStyles.matches}>
        {visibleRounds.map((round) => {
          const roundMeta = formatRoundMeta(round);

          return (
            <div key={round.id} className={adminStyles.roundResults}>
              <div className={adminStyles.sectionTitle}>
                <div className={adminStyles.sectionTitle}>
                  <h3>Round {round.round_number} </h3>
                  {roundMeta && <span className={adminStyles.roundMeta}>{roundMeta}</span>}
                </div>
                {saveBulkMatches &&
                  round.matches.length > 0 &&
                  (isSandbox ? (
                    <Button
                      size="xs"
                      variant="action"
                      onClick={() => void randomFillMatches(round.matches)}
                      disabled={isRandomFilling}
                      title="Random-fill round"
                      data-tooltip-id="admin-tooltip"
                      data-tooltip-content="Generate and save random test results for every two-team fixture in this round."
                    >
                      <ArrowClockwise size={16} /> Random-fill round
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="secondaryAction"
                      onClick={() =>
                        startBulkEditing(
                          round.matches.map((match) => match.id),
                          'round',
                        )
                      }
                      title="Bulk edit round"
                      data-tooltip-id="admin-tooltip"
                      data-tooltip-content="Open one editor for every fixture in this round."
                    >
                      Bulk Edit Round
                    </Button>
                  ))}
              </div>
              {bulkMatchIds.length > 0 &&
                bulkMatches.some((match) => round.matches.some((item) => item.id === match.id)) && (
                  <div className={adminStyles.bulkEditor}>
                    {bulkMatches
                      .filter((match) => round.matches.some((item) => item.id === match.id))
                      .map((match) => {
                        const draft = matchData[match.id] || match;
                        return (
                          <div key={match.id} className={adminStyles.bulkRow}>
                            <span className={adminStyles.bulkTeams}>
                              {match.home_team?.name || 'BYE'} vs {match.away_team?.name || 'BYE'}
                            </span>
                            <input
                              type="number"
                              aria-label="Home goals"
                              value={draft.home_goals ?? ''}
                              onChange={(event) =>
                                setBulkValue(match.id, {
                                  home_goals: event.target.value === '' ? null : Number(event.target.value),
                                })
                              }
                            />
                            <span>-</span>
                            <input
                              type="number"
                              aria-label="Away goals"
                              value={draft.away_goals ?? ''}
                              onChange={(event) =>
                                setBulkValue(match.id, {
                                  away_goals: event.target.value === '' ? null : Number(event.target.value),
                                })
                              }
                            />
                            <input
                              type="number"
                              aria-label="Total minutes"
                              value={draft.total_minutes ?? 90}
                              onChange={(event) =>
                                setBulkValue(match.id, {
                                  total_minutes: Number(event.target.value) || 90,
                                  went_120: Number(event.target.value) >= 120,
                                })
                              }
                            />
                            {isAppg120ScoringMode(scoringMode) && (
                              <>
                                <select
                                  aria-label="APPG outcome"
                                  value={draft.appg_outcome || 'needs_review'}
                                  onChange={(event) =>
                                    setBulkValue(match.id, { appg_outcome: event.target.value as AppgOutcome })
                                  }
                                >
                                  {APPG_OUTCOMES.map((outcome) => (
                                    <option key={outcome} value={outcome}>
                                      {appgOutcomeLabel(outcome)}
                                    </option>
                                  ))}
                                </select>
                                {draft.appg_outcome === 'PS1' && (
                                  <>
                                    <input
                                      type="number"
                                      aria-label="Penalty shootout home goals"
                                      placeholder="PS H"
                                      value={draft.penalty_shootout_home_goals ?? ''}
                                      onChange={(event) =>
                                        setBulkValue(match.id, {
                                          penalty_shootout_home_goals:
                                            event.target.value === '' ? null : Number(event.target.value),
                                        })
                                      }
                                    />
                                    <input
                                      type="number"
                                      aria-label="Penalty shootout away goals"
                                      placeholder="PS A"
                                      value={draft.penalty_shootout_away_goals ?? ''}
                                      onChange={(event) =>
                                        setBulkValue(match.id, {
                                          penalty_shootout_away_goals:
                                            event.target.value === '' ? null : Number(event.target.value),
                                        })
                                      }
                                    />
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              {round.matches.map((match: MatchWithTeams) => {
                const isBye = !match.home_team_id || !match.away_team_id;
                const byeTeam = match.home_team || match.away_team;
                const isMisarranged = match.status === 'misarranged';
                const hasResult = match.completed && match.home_goals !== null && match.away_goals !== null;
                return (
                  <React.Fragment key={match.id}>
                    {isAppg120ScoringMode(scoringMode) && match.appg_outcome === 'needs_review' && (
                      <div className={adminStyles.needsReviewRow}>
                        {match.ht_match_id ? (
                          <a
                            href={`https://www.hattrick.org/goto.ashx?path=/Club/Matches/Match.aspx?matchID=${match.ht_match_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={adminStyles.needsReviewLink}
                            aria-label={`Open Hattrick match ${match.ht_match_id}`}
                            title="Open Hattrick match"
                            data-tooltip-id="admin-tooltip"
                            data-tooltip-content="Open linked Hattrick match"
                          >
                            NEEDS REVIEW <ArrowUpRight size={14} weight="bold" />
                          </a>
                        ) : (
                          'NEEDS REVIEW'
                        )}
                      </div>
                    )}
                    <div className={`${adminStyles.match} ${match.ht_match_id ? adminStyles.hasMatchLink : ''}`}>
                      {match.ht_match_id && (
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/Club/Matches/Match.aspx?matchID=${match.ht_match_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={adminStyles.matchLink}
                          aria-label={`Open Hattrick match ${match.ht_match_id}`}
                          title="Open Hattrick match"
                          data-tooltip-id="admin-tooltip"
                          data-tooltip-content="Open linked Hattrick match"
                        >
                          <ArrowUpRight size={18} weight="bold" />
                        </a>
                      )}
                      <div className={adminStyles.matchTeams}>
                        <AdminResultTeam team={match.home_team} side="home" />
                        <span className={adminStyles.vs}>vs</span>
                        <AdminResultTeam team={match.away_team} side="away" />
                      </div>

                      {editingMatch === match.id ? (
                        <>
                          <div className={adminStyles.matchEdit}>
                            <div className={adminStyles.scoreActionRow}>
                              <div className={adminStyles.scoreInputs}>
                                <input
                                  name={`score_home_${match.id}`}
                                  type="text"
                                  pattern="[0-9]+"
                                  placeholder="H"
                                  value={matchData[match.id]?.home_goals ?? match.home_goals ?? ''}
                                  onChange={(e) =>
                                    setMatchData({
                                      ...matchData,
                                      [match.id]: {
                                        ...(matchData[match.id] || match),
                                        home_goals: e.target.value === '' ? null : Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                                <span className={adminStyles.divider}>-</span>
                                <input
                                  name={`score_away_${match.id}`}
                                  type="text"
                                  pattern="[0-9]+"
                                  placeholder="A"
                                  value={matchData[match.id]?.away_goals ?? match.away_goals ?? ''}
                                  onChange={(e) =>
                                    setMatchData({
                                      ...matchData,
                                      [match.id]: {
                                        ...(matchData[match.id] || match),
                                        away_goals: e.target.value === '' ? null : Number(e.target.value),
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <label className={adminStyles.went120}>
                              <input
                                title="120min game achieved"
                                type="checkbox"
                                checked={matchData[match.id]?.went_120 ?? match.went_120 ?? false}
                                onChange={(e) =>
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: {
                                      ...(matchData[match.id] || match),
                                      went_120: e.target.checked,
                                      total_minutes: e.target.checked
                                        ? 120
                                        : (matchData[match.id]?.total_minutes ?? match.total_minutes ?? 90),
                                    },
                                  })
                                }
                              />
                              120min
                            </label>
                            <div className={adminStyles.minutesInput}>
                              <input
                                type="number"
                                value={matchData[match.id]?.total_minutes ?? match.total_minutes ?? 90}
                                onChange={(e) =>
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: {
                                      ...(matchData[match.id] || match),
                                      total_minutes: e.target.value === '' ? 90 : Number(e.target.value),
                                    },
                                  })
                                }
                                placeholder="90"
                              />
                              <span title="Total match minutes" className={adminStyles.minsLabel}>
                                mins
                              </span>
                            </div>
                            {isAppg120ScoringMode(scoringMode) && (
                              <>
                                <select
                                  aria-label="APPG outcome"
                                  value={matchData[match.id]?.appg_outcome || 'needs_review'}
                                  onChange={(event) =>
                                    setMatchData({
                                      ...matchData,
                                      [match.id]: {
                                        ...(matchData[match.id] || match),
                                        appg_outcome: event.target.value as AppgOutcome,
                                      },
                                    })
                                  }
                                >
                                  {APPG_OUTCOMES.map((outcome) => (
                                    <option key={outcome} value={outcome}>
                                      {appgOutcomeLabel(outcome)}
                                    </option>
                                  ))}
                                </select>
                                {matchData[match.id]?.appg_outcome === 'PS1' && (
                                  <>
                                    <input
                                      type="number"
                                      aria-label="Penalty shootout home goals"
                                      placeholder="PS H"
                                      value={matchData[match.id]?.penalty_shootout_home_goals ?? ''}
                                      onChange={(event) =>
                                        setMatchData({
                                          ...matchData,
                                          [match.id]: {
                                            ...(matchData[match.id] || match),
                                            penalty_shootout_home_goals:
                                              event.target.value === '' ? null : Number(event.target.value),
                                          },
                                        })
                                      }
                                    />
                                    <input
                                      type="number"
                                      aria-label="Penalty shootout away goals"
                                      placeholder="PS A"
                                      value={matchData[match.id]?.penalty_shootout_away_goals ?? ''}
                                      onChange={(event) =>
                                        setMatchData({
                                          ...matchData,
                                          [match.id]: {
                                            ...(matchData[match.id] || match),
                                            penalty_shootout_away_goals:
                                              event.target.value === '' ? null : Number(event.target.value),
                                          },
                                        })
                                      }
                                    />
                                  </>
                                )}
                              </>
                            )}
                          </div>
                          <div className={adminStyles.matchActions}>
                            <div className={adminStyles.editActions}>
                              <Button
                                size="xs"
                                onClick={() => updateMatch(match.id)}
                                variant="primaryDanger"
                                title="Save"
                                data-tooltip-id="admin-tooltip"
                                data-tooltip-content="Save result"
                              >
                                <Check size={16} />
                              </Button>
                              <Button
                                size="xs"
                                variant="action"
                                title={match.completed ? 'Reset unsaved changes' : 'Clear form'}
                                onClick={() => {
                                  setMatchData({
                                    ...matchData,
                                    [match.id]: match.completed
                                      ? match
                                      : {
                                          ...match,
                                          home_goals: null,
                                          away_goals: null,
                                          went_120: false,
                                          total_minutes: 90,
                                        },
                                  });
                                }}
                                data-tooltip-id="admin-tooltip"
                                data-tooltip-content={match.completed ? 'Reset unsaved changes' : 'Clear form'}
                              >
                                <ArrowClockwise size={16} />
                              </Button>
                              <Button
                                size="xs"
                                variant="action"
                                onClick={() => setEditingMatch(null)}
                                title="Cancel"
                                data-tooltip-id="admin-tooltip"
                                data-tooltip-content="Cancel"
                              >
                                <X size={16} />
                              </Button>
                            </div>
                          </div>
                        </>
                      ) : isBye ? (
                        <>
                          <div className={adminStyles.matchResult}>
                            {hasResult && (
                              <div className={adminStyles.score}>
                                <span>
                                  {match.home_goals} - {match.away_goals}
                                </span>
                                <ResultMinutes minutes={match.total_minutes} went120={match.went_120} />
                              </div>
                            )}
                            <span
                              className={adminStyles.byeInfo}
                              data-tooltip-id="admin-tooltip"
                              data-tooltip-content={`${byeTeam?.name || 'Team'} has a BYE. Record any outside-friendly result manually later.`}
                            >
                              BYE
                            </span>
                          </div>
                          <div className={adminStyles.matchActions}>
                            {renderMatchActions(match, hasResult, round.id)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={adminStyles.matchResult}>
                            {isMisarranged ? (
                              <>
                                {hasResult && (
                                  <div className={adminStyles.score}>
                                    <span>
                                      {match.home_goals} - {match.away_goals}
                                    </span>
                                    <ResultMinutes minutes={match.total_minutes} went120={match.went_120} />
                                  </div>
                                )}
                                <span className={adminStyles.misarrangedResult}>misarranged</span>
                              </>
                            ) : match.completed ? (
                              <div className={adminStyles.resultTopRow}>
                                <div className={adminStyles.score}>
                                  <span>
                                    {match.home_goals} - {match.away_goals}
                                  </span>
                                  <ResultMinutes minutes={match.total_minutes} went120={match.went_120} />
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div className={adminStyles.matchActions}>
                            {renderMatchActions(match, hasResult, round.id)}
                          </div>
                        </>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
      {bulkMatchIds.length > 0 && (
        <div className={adminStyles.bulkActions}>
          {bulkEditScope === 'season' &&
            clearSeasonResults &&
            rounds.some((round) => round.matches.some((match) => match.completed)) && (
              <Button
                size="xs"
                variant="action"
                onClick={handleClearSeasonResults}
                disabled={isClearingResults || isClearingFixtures}
                title="Clear all season results"
                data-tooltip-id="admin-tooltip"
                data-tooltip-content="Remove all saved scores and result data while keeping fixtures and linked Hattrick match IDs."
              >
                <X size={16} /> {isClearingResults ? 'Clearing results...' : 'Clear all scores'}
              </Button>
            )}
          {bulkEditScope === 'season' && clearSeasonFixtures && rounds.length > 0 && (
            <Button
              size="xs"
              variant="action"
              onClick={handleClearSeasonFixtures}
              disabled={isClearingResults || isClearingFixtures}
              title="Clear season fixtures"
              data-tooltip-id="admin-tooltip"
              data-tooltip-content="Permanently remove every fixture and round in this season."
            >
              <X size={16} /> {isClearingFixtures ? 'Clearing fixtures...' : 'Remove all matches'}
            </Button>
          )}
          <Button
            size="xs"
            variant="action"
            onClick={cancelBulkEditing}
            title="Close bulk editor"
            data-tooltip-id="admin-tooltip"
            data-tooltip-content="Close the bulk editor without saving."
          >
            <X size={16} /> Cancel
          </Button>
          <Button
            size="xs"
            variant="primaryDanger"
            onClick={saveBulkResults}
            disabled={isSavingBulk}
            title="Save bulk results"
            data-tooltip-id="admin-tooltip"
            data-tooltip-content="Save every result currently open in the bulk editor."
          >
            <Check size={16} /> Save bulk edits
          </Button>
        </div>
      )}
    </SectionCard>
  );
};
