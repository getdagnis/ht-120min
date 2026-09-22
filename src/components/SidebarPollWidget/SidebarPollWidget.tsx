'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartBar, ArrowRight, User } from 'phosphor-react';

import { supabase } from '../../lib/supabase';
import {
  buildSeasonPollResults,
  getSeasonPollCloseDate,
  getSeasonPollVoteTotal,
  isSeasonPollClosed,
  type PollRound,
  type PollTeamOption,
  type PollVote,
} from '../../utils/season-poll';
import { Button } from '../Button/Button';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import styles from './SidebarPollWidget.module.sass';

interface SidebarPollWidgetProps {
  seasonId?: string;
  seasonStatus?: 'planned' | 'ongoing' | 'finished';
  teams: PollTeamOption[];
  rounds: PollRound[];
  is120minMode: boolean;
  myHtUserId: number | null;
}

interface SeasonPollVoteRow extends PollVote {
  id: string;
  season_id: string;
  voter_ht_user_id: number;
}

async function fetchSeasonPollVotes(seasonId: string) {
  return supabase
    .from('tournament_season_poll_votes')
    .select('id, season_id, team_id, voter_ht_user_id')
    .eq('season_id', seasonId);
}

export const SidebarPollWidget: React.FC<SidebarPollWidgetProps> = ({
  seasonId,
  seasonStatus,
  teams,
  rounds,
  is120minMode,
  myHtUserId,
}) => {
  const closeDate = useMemo(() => getSeasonPollCloseDate(rounds), [rounds]);
  const [votes, setVotes] = useState<SeasonPollVoteRow[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVotes = useCallback(async () => {
    if (!seasonId) return;
    const { data, error: loadError } = await fetchSeasonPollVotes(seasonId);

    if (loadError) {
      setError('Could not load poll results.');
      return;
    }

    setVotes((data || []) as SeasonPollVoteRow[]);
  }, [seasonId]);

  useEffect(() => {
    if (!seasonId) return;
    let isCurrent = true;

    void fetchSeasonPollVotes(seasonId).then(({ data, error: loadError }) => {
      if (!isCurrent) return;
      if (loadError) {
        setError('Could not load poll results.');
        return;
      }
      setVotes((data || []) as SeasonPollVoteRow[]);
    });

    return () => {
      isCurrent = false;
    };
  }, [seasonId]);

  if (!seasonId || seasonStatus !== 'ongoing' || !closeDate || !teams.length) return null;

  const isClosed = isSeasonPollClosed(closeDate);
  const existingVote = myHtUserId ? votes.find((vote) => vote.voter_ht_user_id === myHtUserId) : undefined;
  const showResults = Boolean(isClosed || existingVote);
  const results = buildSeasonPollResults(teams, votes);
  const totalVotes = getSeasonPollVoteTotal(votes);
  const closeDateLabel = closeDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const question = is120minMode
    ? 'Which team is most likely to win this tournament based on 120 min games achieved?'
    : 'Which team is most likely to win this tournament based on regular 90 min point system?';

  const handleLogin = () => {
    document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname + window.location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!seasonId || !myHtUserId || !selectedTeamId || existingVote || isClosed) return;

    setIsSubmitting(true);
    setError(null);
    const { error: insertError } = await supabase.from('tournament_season_poll_votes').insert({
      season_id: seasonId,
      team_id: selectedTeamId,
      voter_ht_user_id: myHtUserId,
    });
    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.code === '23505' ? 'You have already voted in this poll.' : 'Could not submit your vote.');
      if (insertError.code === '23505') await loadVotes();
      return;
    }

    await loadVotes();
  };

  return (
    <ReusableWidget title="Season poll" icon={<ChartBar size={20} weight="bold" />} className={styles.widget}>
      <p className={styles.question}>{question}</p>
      {showResults ? (
        <div className={styles.results} aria-live="polite">
          <strong>Current results ({totalVotes} votes)</strong>
          <ol className={styles.resultList}>
            {results.map((team) => (
              <li key={team.id} className={styles.resultItem}>
                <span>{team.name}</span>
                <span className={styles.voteCount}>
                  {team.votes}
                  {team.id === existingVote?.team_id && ' (voted)'}
                </span>
              </li>
            ))}
          </ol>
          {isClosed && <span className={styles.closedNotice}>Voting is closed.</span>}
        </div>
      ) : myHtUserId ? (
        <form onSubmit={handleSubmit} className={styles.form}>
          <fieldset disabled={isSubmitting} className={styles.options}>
            <legend className={styles.legend}>Choose one team</legend>
            {teams.map((team) => (
              <label key={team.id} className={styles.option}>
                <input
                  type="radio"
                  name={`season-poll-${seasonId}`}
                  value={team.id}
                  checked={selectedTeamId === team.id}
                  onChange={() => setSelectedTeamId(team.id)}
                />
                <span>{team.name}</span>
              </label>
            ))}
          </fieldset>
          <Button type="submit" size="sm" disabled={!selectedTeamId || isSubmitting} fullWidth>
            {isSubmitting ? 'Submitting…' : 'Vote'}
          </Button>
        </form>
      ) : (
        <div className={styles.login}>
          <span>Log in to vote.</span>
          <Button size="sm" onClick={handleLogin} variant="primary" type="button">
            <User size={18} weight="bold" />
            <span>Login to vote</span>
            <ArrowRight size={18} className="hideOnTable" />
          </Button>
        </div>
      )}
      <span className={styles.closeDateNotice}>Ends: {closeDateLabel}</span>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </ReusableWidget>
  );
};
