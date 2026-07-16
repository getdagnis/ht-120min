import React, { useCallback, useMemo, useState } from 'react';
import { TournamentHistory, type TournamentSeasonComment } from '../../components/TournamentHistory/TournamentHistory';
import { buildSeasonHistorySnapshot, type SeasonHistoryMatch } from '../../utils/season-history';
import type { Team } from '../../utils/standings';
import styles from './TournamentHistoryDummy.module.sass';

const teams: Team[] = [
  ['guahan', 'Guåhan Goddesses', 3220518, 1001],
  ['nduje', "'Nduje Amaranto", 3220504, 1002],
  ['challenger', 'Challenger Deep FC', 3220514, 1003],
  ['tamuning', 'Tamuning Amazons', 3220516, 1004],
  ['tottenham', 'Tottenham Amazons', 3220511, 1005],
  ['princesses', 'The princesses of Zermatt', 3220508, 1006],
].map(([id, name, teamId, userId]) => ({
  id: String(id),
  name: String(name),
  ht_team_id: Number(teamId),
  hattrick_user_id: Number(userId),
  active: true,
  replacement_for_team_id: null,
  joined_via_oauth: true,
  country_name: 'Guam',
  country_id: 73,
  league_id: 73,
  logo_url: '/default-logo.png',
  manager_name: `Manager ${userId}`,
}));

const pairings: Array<[string, string, number, number, number]> = [
  ['guahan', 'nduje', 3, 3, 121],
  ['challenger', 'tamuning', 2, 1, 120],
  ['tottenham', 'princesses', 1, 0, 90],
  ['guahan', 'challenger', 2, 1, 120],
  ['nduje', 'tottenham', 4, 2, 122],
  ['tamuning', 'princesses', 2, 0, 90],
  ['guahan', 'tamuning', 1, 0, 120],
  ['challenger', 'tottenham', 2, 2, 123],
  ['nduje', 'princesses', 3, 1, 120],
  ['guahan', 'tottenham', 2, 0, 90],
  ['tamuning', 'nduje', 1, 2, 120],
  ['challenger', 'princesses', 1, 0, 120],
  ['guahan', 'princesses', 2, 0, 134],
  ['tottenham', 'tamuning', 1, 1, 120],
  ['nduje', 'challenger', 2, 1, 120],
];

const matches: SeasonHistoryMatch[] = pairings.map(([home, away, homeGoals, awayGoals, minutes], index) => ({
  id: `match-${index + 1}`,
  roundNumber: Math.floor(index / 3) + 1,
  scheduledFor: new Date(Date.UTC(2026, 1, 12 + Math.floor(index / 3) * 7)).toISOString(),
  home_team_id: home,
  away_team_id: away,
  home_goals: homeGoals,
  away_goals: awayGoals,
  completed: true,
  went_120: minutes >= 120,
  total_minutes: minutes,
  home_yellow_cards: index % 3,
  away_yellow_cards: index % 4 === 0 ? 1 : 0,
  home_red_cards: 0,
  away_red_cards: index === 8 ? 1 : 0,
  home_injuries: index % 5 === 0 ? 1 : 0,
  away_injuries: index % 7 === 0 ? 1 : 0,
}));

const snapshot = buildSeasonHistorySnapshot(teams, matches, '120min');

const initialComments: TournamentSeasonComment[] = [
  {
    id: 'comment-1',
    season_id: 'dummy-season-1',
    team_id: 'nduje',
    team_name: "'Nduje Amaranto",
    manager_name: 'Manager 1002',
    comment: 'We came for the extra minutes and stayed for the rivalries.',
    created_at: '2026-06-03T12:00:00.000Z',
  },
];

export const TournamentHistoryDummy: React.FC = () => {
  const [comments, setComments] = useState(initialComments);
  const seasons = useMemo(
    () => [
      {
        id: 'dummy-season-1',
        seasonNumber: 1,
        status: 'finished' as const,
        plannedStartSlot: '2026-02-12T20:00:00.000Z',
        startedAt: '2026-02-12T20:00:00.000Z',
        finishedAt: '2026-06-03T20:00:00.000Z',
        snapshot,
      },
      {
        id: 'dummy-season-2',
        seasonNumber: 2,
        status: 'planned' as const,
        plannedStartSlot: '2026-08-11T20:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        snapshot: null,
      },
    ],
    [],
  );
  const loadComments = useCallback(async () => comments, [comments]);
  const submitComment = useCallback(async (seasonId: string, teamId: string, comment: string) => {
    const team = teams.find((item) => item.id === teamId)!;
    const saved: TournamentSeasonComment = {
      id: `comment-${Date.now()}`,
      season_id: seasonId,
      team_id: teamId,
      team_name: team.name,
      manager_name: team.manager_name || null,
      comment,
      created_at: new Date().toISOString(),
    };
    setComments((current) => [...current, saved]);
    return saved;
  }, []);

  return (
    <div className={styles.page}>
      <header>
        <h1>Queens of the Pacific Cup</h1>
        <p>Season 1 · Finished</p>
      </header>
      <TournamentHistory
        seasons={seasons}
        currentHtUserId={1001}
        selectedSeasonNumber={1}
        loadComments={loadComments}
        submitComment={submitComment}
      />
    </div>
  );
};
