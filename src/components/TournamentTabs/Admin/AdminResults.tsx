import React from 'react';
import { SectionCard } from '../../Card/SectionCard';
import { Button } from '../../Button/Button';
import { Check, ArrowClockwise, X, PencilSimple, LinkSimple } from 'phosphor-react';
import { getCountryFlagUrl, getLeagueFlagUrl } from '../../../utils/ht-data';
import { getHattrickWeekDetails } from '../../../utils/hattrick-calendar';
import { APPG_OUTCOMES, appgOutcomeLabel, validateAppgOutcome, type AppgOutcome } from '../../../utils/appg';
import { parseResultCsv, RESULT_CSV_TEMPLATE, type ResultCsvRow } from '../../../utils/result-csv';
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

export interface BulkMatchUpdate {
  home_goals?: number | null;
  away_goals?: number | null;
  went_120?: boolean;
  total_minutes?: number;
  completed?: boolean;
  penalty_shootout_home_goals?: number | null;
  penalty_shootout_away_goals?: number | null;
  appg_outcome?: AppgOutcome | null;
  appg_outcome_source?: 'organizer' | 'csv';
}

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
  importCsvRows?: (rows: ResultCsvRow[]) => Promise<void>;
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
  const leagueFlagUrl = getLeagueFlagUrl(team?.league_id);

  if (!team) {
    return (
      <div className={`${adminStyles.resultTeam} ${adminStyles[side]}`}>
        <span className={adminStyles.resultTeamFree}>Free to choose</span>
      </div>
    );
  }

  return (
    <div className={`${adminStyles.resultTeam} ${adminStyles[side]}`}>
      {leagueFlagUrl && <img src={leagueFlagUrl} alt="League" className={adminStyles.resultFlag} />}
      {countryFlagUrl && (
        <img
          src={countryFlagUrl}
          alt={team.country_name || 'Country'}
          title={team.country_name}
          className={adminStyles.resultFlag}
        />
      )}
      <a
        href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${team.ht_team_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className={adminStyles.resultTeamLink}
      >
        <span className={adminStyles.resultTeamName}>{team.name}</span>
        <span className={adminStyles.resultTeamId}>({team.ht_team_id})</span>
      </a>
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
      variant={hasResult ? 'zero' : roundId === currentRoundId ? 'secondary' : 'outline'}
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
    variant="outline"
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
  importCsvRows,
}) => {
  const [linkingMatchId, setLinkingMatchId] = React.useState<string | null>(null);
  const [linkInput, setLinkInput] = React.useState('');
  const [linkPreview, setLinkPreview] = React.useState<HtMatchLinkPreview | null>(null);
  const [linkError, setLinkError] = React.useState('');
  const [isCheckingLink, setIsCheckingLink] = React.useState(false);
  const [isSavingLink, setIsSavingLink] = React.useState(false);
  const [bulkMatchIds, setBulkMatchIds] = React.useState<string[]>([]);
  const [isSavingBulk, setIsSavingBulk] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const bulkMatches = React.useMemo(
    () => rounds.flatMap((round) => round.matches).filter((match) => bulkMatchIds.includes(match.id)),
    [bulkMatchIds, rounds],
  );

  const setBulkValue = (matchId: string, values: Partial<MatchWithTeams>) => {
    setMatchData((current) => ({
      ...current,
      [matchId]: {
        ...(current[matchId] || rounds.flatMap((round) => round.matches).find((match) => match.id === matchId)),
        ...values,
      },
    }));
  };

  const startBulkSimulation = (matchIds: string[]) => {
    setEditingMatch(null);
    setBulkMatchIds(matchIds);
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

  const cancelBulkSimulation = () => setBulkMatchIds([]);

  const saveBulkSimulation = async () => {
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
          if (scoringMode === 'appg') {
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
      setMatchData((current) => {
        const next = { ...current };
        bulkMatchIds.forEach((matchId) => delete next[matchId]);
        return next;
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not save the simulated results.');
    } finally {
      setIsSavingBulk(false);
    }
  };

  const downloadCsvTemplate = () => {
    const blob = new Blob([RESULT_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ht-120min-results-template.csv';
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
        variant="primary"
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
        variant="outline"
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
            <Button
              size="xs"
              variant="outline"
              onClick={() => startBulkSimulation(rounds.flatMap((round) => round.matches.map((match) => match.id)))}
            >
              Simulate season
            </Button>
            {importCsvRows && (
              <>
                <Button size="xs" variant="outline" onClick={downloadCsvTemplate}>
                  CSV template
                </Button>
                <Button size="xs" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Import CSV
                </Button>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvFile} hidden />
              </>
            )}
          </>
        )}
      </div>
      <div className={adminStyles.matches}>
        {rounds.map((round) => {
          const roundMeta = formatRoundMeta(round);

          return (
            <div key={round.id} className={adminStyles.roundResults}>
              <h3 className={adminStyles.sectionTitle}>
                Round {round.round_number}
                {roundMeta && <span className={adminStyles.roundMeta}>{roundMeta}</span>}
                {saveBulkMatches && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => startBulkSimulation(round.matches.map((match) => match.id))}
                  >
                    Simulate round
                  </Button>
                )}
              </h3>
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
                                  went_120: Number(event.target.value) > 90,
                                })
                              }
                            />
                            {scoringMode === 'appg' && (
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
                  <div key={match.id} className={adminStyles.match}>
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
                          {scoringMode === 'appg' && (
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
                              variant="primary"
                              title="Save"
                              data-tooltip-id="admin-tooltip"
                              data-tooltip-content="Save result"
                            >
                              <Check size={16} />
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
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
                              variant="outline"
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
                            <div className={adminStyles.resultTopRow}>
                              <div className={adminStyles.score}>
                                <span>
                                  {match.home_goals} - {match.away_goals}
                                </span>
                                <ResultMinutes minutes={match.total_minutes} went120={match.went_120} />
                              </div>
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
                        <div className={adminStyles.matchActions}>{renderMatchActions(match, hasResult, round.id)}</div>
                      </>
                    ) : (
                      <>
                        <div className={adminStyles.matchResult}>
                          {isMisarranged ? (
                            <>
                              <div className={adminStyles.resultTopRow}>
                                {hasResult && (
                                  <div className={adminStyles.score}>
                                    <span>
                                      {match.home_goals} - {match.away_goals}
                                    </span>
                                    <ResultMinutes minutes={match.total_minutes} went120={match.went_120} />
                                  </div>
                                )}
                              </div>
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
                        <div className={adminStyles.matchActions}>{renderMatchActions(match, hasResult, round.id)}</div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {bulkMatchIds.length > 0 && (
        <div className={adminStyles.bulkActions}>
          <Button size="xs" variant="primary" onClick={saveBulkSimulation} disabled={isSavingBulk}>
            <Check size={16} /> Save simulation
          </Button>
          <Button size="xs" variant="outline" onClick={cancelBulkSimulation}>
            <X size={16} /> Cancel
          </Button>
        </div>
      )}
    </SectionCard>
  );
};
