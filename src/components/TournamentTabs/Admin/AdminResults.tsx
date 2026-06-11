import React from 'react';
import { SectionCard } from '../../Card/SectionCard';
import { Button } from '../../Button/Button';
import { FloppyDisk, Eraser, XCircle, PencilSimple } from 'phosphor-react';
import { TeamDisplay } from '../../TeamDisplay/TeamDisplay';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';

interface MatchWithTeams {
  id: string;
  round_id: string;
  home_team_id: string;
  away_team_id: string;
  home_goals: number | null;
  away_goals: number | null;
  completed: boolean;
  went_120: boolean;
  total_minutes: number;
  home_team: {
    name: string;
    ht_team_id: number;
    logo_url?: string;
    active?: boolean;
    manager_name?: string;
  } | null;
  away_team: {
    name: string;
    ht_team_id: number;
    logo_url?: string;
    active?: boolean;
    manager_name?: string;
  } | null;
}

interface AdminResultsProps {
  rounds: {
    id: string;
    round_number: number;
    matches: MatchWithTeams[];
  }[];
  editingMatch: string | null;
  setEditingMatch: (matchId: string | null) => void;
  updateMatch: (matchId: string, isScrap?: boolean) => Promise<void>;
  isResultsCollapsed: boolean;
  setIsResultsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  togglePanel: (key: string, state: boolean, setter: React.Dispatch<React.SetStateAction<boolean>>) => void;
  matchData: Record<string, Partial<MatchWithTeams>>;
  setMatchData: React.Dispatch<React.SetStateAction<Record<string, Partial<MatchWithTeams>>>>;
  currentRoundId?: string;
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
}) => {
  return (
    <SectionCard
      title="Results Entry"
      collapsible
      isCollapsed={isResultsCollapsed}
      onToggleCollapse={() => togglePanel('results', !isResultsCollapsed, setIsResultsCollapsed)}
    >
      <div className={adminStyles.matches}>
        {rounds.map((round) => (
          <div key={round.id} className={adminStyles.roundResults}>
            <h3 className={adminStyles.sectionTitle}>Round {round.round_number}</h3>
            {round.matches.map((match: MatchWithTeams) => {
              return (
                <div key={match.id} className={adminStyles.match}>
                  <div className={adminStyles.matchTeams}>
                    <TeamDisplay team={match.home_team} side="home" />
                    <span className={adminStyles.vs}>vs</span>
                    <TeamDisplay team={match.away_team} side="away" />
                  </div>

                  {editingMatch === match.id ? (
                    <div className={adminStyles.matchEdit}>
                      <div className={adminStyles.scoreInputs}>
                        <input
                          name={`score_home_${match.id}`}
                          type="number"
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
                          type="number"
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
                      <div className={adminStyles.editActions}>
                        <Button
                          size="xs"
                          onClick={() => updateMatch(match.id)}
                          variant="primary"
                          title="Save"
                          data-tooltip-id="admin-tooltip"
                          data-tooltip-content="Save result"
                        >
                          <FloppyDisk size={16} />
                        </Button>
                        <Button
                          size="xs"
                          variant="danger"
                          title={match.completed ? 'Restore original' : 'Clear result'}
                          onClick={() => {
                            if (
                              window.confirm(
                                match.completed ? 'Restore original result?' : 'Clear result for this match?',
                              )
                            ) {
                              updateMatch(match.id, true);
                            }
                          }}
                          data-tooltip-id="admin-tooltip"
                          data-tooltip-content={match.completed ? 'Restore original' : 'Clear result'}
                        >
                          <Eraser size={16} />
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => setEditingMatch(null)}
                          title="Cancel"
                          data-tooltip-id="admin-tooltip"
                          data-tooltip-content="Cancel"
                        >
                          <XCircle size={16} />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={adminStyles.matchResult}>
                      {match.completed ? (
                        <>
                          <div className={adminStyles.score}>
                            {match.home_goals} - {match.away_goals}
                            {match.went_120 && <span className={adminStyles.badge}>120'</span>}
                            {match.total_minutes > 0 && match.total_minutes !== (match.went_120 ? 120 : 90) && (
                              <span className={adminStyles.minsBadge}>{match.total_minutes}m</span>
                            )}
                          </div>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              setEditingMatch(match.id);
                              setMatchData({ ...matchData, [match.id]: match });
                            }}
                            title="Edit result"
                            data-tooltip-id="admin-tooltip"
                            data-tooltip-content="Edit result"
                          >
                            <PencilSimple size={16} />
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="xs"
                          variant={round.id === currentRoundId ? 'secondary' : 'outline'}
                          onClick={() => {
                            setEditingMatch(match.id);
                            setMatchData({
                              ...matchData,
                              [match.id]: { ...match, home_goals: null, away_goals: null },
                            });
                          }}
                        >
                          Enter
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </SectionCard>
  );
};
