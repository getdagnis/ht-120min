import { useEffect, useMemo, useState } from 'react';
import { Check, ClockCounterClockwise } from 'phosphor-react';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import { supabase } from '../../lib/supabase';
import type { UserProfile } from '../../hooks/useAuth';
import styles from './TeamOwnershipReclaim.module.sass';

interface TeamOwnershipReclaimProps {
  profile: UserProfile | null;
  onClaimed?: () => void;
}

interface ClaimableTeamRow {
  id: string;
  name: string;
  ht_team_id: number | null;
  active: boolean | null;
  is_placeholder: boolean | null;
  joined_via_oauth: boolean | null;
  hattrick_user_id: number | null;
  tournaments:
    | {
        name: string;
        slug: string;
        status: string | null;
        registration_type?: string | null;
      }
    | {
        name: string;
        slug: string;
        status: string | null;
        registration_type?: string | null;
      }[]
    | null;
}

function getTournament(row: ClaimableTeamRow) {
  return Array.isArray(row.tournaments) ? row.tournaments[0] : row.tournaments;
}

function getDismissKey(userId: number) {
  return `team_ownership_reclaim_ask_next_time_${userId}`;
}

export function TeamOwnershipReclaim({ profile, onClaimed }: TeamOwnershipReclaimProps) {
  const [teamRows, setTeamRows] = useState<ClaimableTeamRow[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const verifiedTeamIds = useMemo(() => {
    return Array.from(new Set((profile?.teams_json ?? []).map((team) => Number(team.teamId)).filter(Boolean)));
  }, [profile?.teams_json]);

  const hasEligibleProfile = Boolean(profile?.hattrick_user_id && verifiedTeamIds.length > 0);

  const claimableTeams = useMemo(() => {
    if (!hasEligibleProfile) {
      return [];
    }

    return teamRows.filter((team) => {
      const tournament = getTournament(team);
      return (
        team.ht_team_id &&
        !team.is_placeholder &&
        tournament?.registration_type !== 'sandbox' &&
        tournament?.status !== 'archived' &&
        (!team.joined_via_oauth || !team.hattrick_user_id)
      );
    });
  }, [hasEligibleProfile, teamRows]);

  useEffect(() => {
    if (!hasEligibleProfile) {
      return;
    }

    let cancelled = false;

    async function fetchClaimableTeams() {
      setIsFetching(true);
      try {
        const { data, error } = await supabase
          .from('teams')
          .select(
            `
            id,
            name,
            ht_team_id,
            active,
            is_placeholder,
            joined_via_oauth,
            hattrick_user_id,
            tournaments (
              name,
              slug,
              status,
              registration_type
            )
          `,
          )
          .in('ht_team_id', verifiedTeamIds)
          .eq('active', true);

        if (!cancelled && !error) {
          setTeamRows((data as ClaimableTeamRow[] | null) ?? []);
        }
      } finally {
        if (!cancelled) setIsFetching(false);
      }
    }

    void fetchClaimableTeams();

    return () => {
      cancelled = true;
    };
  }, [hasEligibleProfile, verifiedTeamIds]);

  const isLoading = isFetching && hasEligibleProfile;
  const isRememberedDismissal = profile?.hattrick_user_id
    ? sessionStorage.getItem(getDismissKey(profile.hattrick_user_id)) === 'true'
    : false;
  const isOpen = !isDismissed && !isRememberedDismissal && !isLoading && claimableTeams.length > 0;

  const askNextTime = () => {
    if (profile?.hattrick_user_id) {
      sessionStorage.setItem(getDismissKey(profile.hattrick_user_id), 'true');
    }
    setIsDismissed(true);
  };

  const claimTeams = async () => {
    const teamIds = Array.from(new Set(claimableTeams.map((team) => team.ht_team_id).filter(Boolean)));
    if (teamIds.length === 0) return;

    setIsClaiming(true);
    try {
      const response = await fetch('/api/auth/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim_teams', teamIds }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(result?.error || 'Unable to reclaim team ownership.');
      }

      setTeamRows([]);
      onClaimed?.();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to reclaim team ownership.');
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={askNextTime} title="Some of your teams are already registered" maxWidth="720px">
      <div className={styles.content}>
        <p className={styles.intro}>
          Some of your teams are already registered with HT-120min. Do you want to reclaim full ownership over these
          teams on Hattrick?
        </p>

        <ul className={styles.teamList}>
          {claimableTeams.map((team) => {
            const tournament = getTournament(team);
            return (
              <li key={team.id} className={styles.teamItem}>
                <div>
                  <strong>{team.name}</strong>
                  <span>ID: {team.ht_team_id}</span>
                </div>
                {tournament && (
                  <a href={`/t/${tournament.slug}`} target="_blank" rel="noreferrer">
                    {tournament.name}
                  </a>
                )}
              </li>
            );
          })}
        </ul>

        <div className={styles.actions}>
          <Button variant="primary" size="md" onClick={claimTeams} disabled={isClaiming}>
            <Check size={18} weight="bold" />
            Yes
          </Button>
          <Button variant="outlineWhite" size="md" onClick={askNextTime} disabled={isClaiming}>
            <ClockCounterClockwise size={18} weight="bold" />
            Ask next time
          </Button>
        </div>
      </div>
    </Modal>
  );
}
