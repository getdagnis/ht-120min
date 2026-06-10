import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Modal } from '../Modal/Modal';
import { Avatar } from '../Avatar/Avatar';
import type { UserProfile, ActiveTournament } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Trophy, CalendarBlank, Medal, ArrowUpRight } from 'phosphor-react';
import styles from './ProfileModal.module.sass';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  activeTournaments: ActiveTournament[];
}

interface DBTeamWithTournament {
  id: string;
  name: string;
  ht_team_id: number;
  logo_url: string | null;
  tournaments: {
    name: string;
    slug: string;
  } | null;
}

interface TeamInfo {
  id: string;
  name: string;
  ht_team_id: number;
  logo_url: string | null;
  tournament_name: string;
  tournament_slug: string;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose, profile }) => {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const handleClose = () => {
    if (searchParams.has('profileId')) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('profileId');
      setSearchParams(nextParams, { replace: true });
    }

    onClose();
  };

  useEffect(() => {
    if (isOpen && profile) {
      const fetchTeams = async () => {
        setLoading(true);
        const { data } = await supabase
          .from('teams')
          .select('id, name, ht_team_id, logo_url, tournaments(name, slug)')
          .eq('hattrick_user_id', profile.hattrick_user_id)
          .eq('active', true);

        if (data) {
          const rawTeams = data as unknown as DBTeamWithTournament[];
          setTeams(
            rawTeams.map((t) => ({
              id: t.id,
              name: t.name,
              ht_team_id: t.ht_team_id,
              logo_url: t.logo_url,
              tournament_name: t.tournaments?.name || 'Unknown',
              tournament_slug: t.tournaments?.slug || '',
            })),
          );
        }
        setLoading(false);
      };
      void fetchTeams();
    }
  }, [isOpen, profile]);

  if (!profile) return null;

  const joinDate = new Date(profile.created_at).toLocaleDateString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // TODO: remove
  console.log('🏜💀👾 profile', profile);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Manager Profile">
      <div className={styles.profileContent}>
        <div className={styles.header}>
          <Avatar
            backgroundImage={profile.avatar_json?.backgroundImage}
            layers={profile.avatar_json?.layers}
            className={styles.avatar}
          />
          <div className={styles.mainInfo}>
            <a
              href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${profile.hattrick_user_id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <h2>
                {profile.manager_name} <ArrowUpRight size={14} />
              </h2>
            </a>
            <div className={styles.meta}>
              <div className={styles.metaItem}>
                <CalendarBlank size={18} />
                <span>Joined {joinDate}</span>
              </div>
              {profile.country_name && (
                <div className={styles.metaItem}>
                  {profile.country_id && (
                    <img
                      // some strange artefact with latvia (now id 53) reported as 48 by API with slightly wrong flag
                      src={`https://www.hattrick.org/Img/flags/${profile.country_id == 48 ? 53 : profile.country_id}.png`}
                      alt={profile.country_name}
                      className={styles.flag}
                    />
                  )}
                  <a
                    href={`https://www.hattrick.org/goto.ashx?path=/World/Leagues/League.aspx?LeagueID=${profile.country_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {profile.country_name} <ArrowUpRight size={14} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className={styles.body}>
          <section className={styles.section}>
            <h3>
              <Trophy size={20} /> Registered Teams
            </h3>
            <div className={styles.teamList}>
              {loading ? (
                <p>Loading teams...</p>
              ) : teams.length > 0 ? (
                teams.map((team) => (
                  <div key={team.id} className={styles.teamItem}>
                    <div className={styles.teamInfo}>
                      {team.logo_url && <img src={team.logo_url} alt="" className={styles.teamLogo} />}
                      <div className={styles.teamName}>
                        <a
                          href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamId=${team.ht_team_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {team.name} <span className={styles.htId}>({team.ht_team_id})</span>
                        </a>
                        <span className={styles.htTournament}>
                          Active in: <a href={`/t/${team.tournament_slug}`}>{team.tournament_name}</a>
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p>No active teams registered yet.</p>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h3>
              <Medal size={20} /> Achievements
            </h3>
            <div className={styles.achievements}>
              <div className={styles.achievementItem}>
                <div className={styles.medalIcon}>🥇</div>
                <div className={styles.achievementInfo}>
                  <strong>Registered on HT-120min</strong>
                  <span>on {joinDate}</span>
                </div>
              </div>
              {teams.length > 0 && (
                <div className={styles.achievementItem}>
                  <div className={styles.medalIcon}>🏆</div>
                  <div className={styles.achievementInfo}>
                    <strong>Took part in first tournament</strong>
                    <span>{teams[teams.length - 1].tournament_name}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </Modal>
  );
};
