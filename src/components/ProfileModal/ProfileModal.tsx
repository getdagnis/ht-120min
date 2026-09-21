import React, { useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Modal } from '../Modal/Modal';
import { Avatar } from '../Avatar/Avatar';
import { ModalTeamCard } from '../ModalTeamCard/ModalTeamCard';
import type { UserProfile, ActiveTournament } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Trophy, CalendarBlank, Medal, ArrowUpRight } from 'phosphor-react';
import { getCanonicalCountryName, getCountryFlagUrl, getLeagueFlagUrl } from '../../utils/ht-data';
import styles from './ProfileModal.module.sass';

interface ProfileModalProps {
  activeTournaments: ActiveTournament[];
  isOpen: boolean;
  onClose: () => void;
  maxWidth?: string;
  profileId: number | null;
  ownProfile: UserProfile | null;
}

interface DBTeamWithTournament {
  id: string;
  name: string;
  ht_team_id: number;
  logo_url: string | null;
  country_id: number | null;
  country_name: string | null;
  league_id: number | null;
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
  country_id: number | null;
  country_name: string | null;
  league_id: number | null;
  tournament_name: string;
  tournament_slug: string;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, maxWidth, onClose, profileId, ownProfile }) => {
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const pathname = usePathname() || '/';
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!isOpen || !profileId) return;
    const load = async () => {
      if (ownProfile && ownProfile.hattrick_user_id === profileId) {
        setProfile(ownProfile);
        return;
      }
      const { data } = await supabase.from('profiles').select('*').eq('hattrick_user_id', profileId).maybeSingle();
      setProfile(data as UserProfile | null);
    };
    void load();
  }, [isOpen, profileId, ownProfile]);

  const handleClose = () => {
    if (searchParams.has('profileId')) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete('profileId');
      const query = nextParams.toString();
      router.replace(`${pathname}${query ? `?${query}` : ''}`);
    }

    onClose();
  };

  useEffect(() => {
    if (isOpen && profile) {
      const fetchTeams = async () => {
        setLoading(true);
        const { data } = await supabase
          .from('teams')
          .select('id, name, ht_team_id, logo_url, country_id, country_name, league_id, tournaments(name, slug)')
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
              country_id: t.country_id,
              country_name: t.country_name,
              league_id: t.league_id,
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
  const displayCountryName = getCanonicalCountryName(profile.country_name, profile.country_id);
  const displayLeagueId = profile.league_id;
  const countryFlagUrl = getCountryFlagUrl(profile.country_id, displayCountryName);
  const leagueFlagUrl = getLeagueFlagUrl(displayLeagueId);

  console.log('Profile Avatar Data:', profile?.avatar_json);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Manager Profile" maxWidth={maxWidth}>
      <div className={styles.profileContent}>
        <div className={styles.header}>
          <Avatar avatar={profile.avatar_json || null} variant="rect" className={styles.avatar} />
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
              {displayCountryName && (
                <div className={styles.metaItem}>
                  {leagueFlagUrl && <img src={leagueFlagUrl} alt="League" className={styles.flag} />}
                  {countryFlagUrl && <img src={countryFlagUrl} alt={displayCountryName} className={styles.flag} />}
                  <a
                    href={`https://www.hattrick.org/goto.ashx?path=/World/Leagues/League.aspx?LeagueID=${displayLeagueId ?? profile.country_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {displayCountryName} <ArrowUpRight size={14} />
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
                  <ModalTeamCard
                    key={team.id}
                    team={{
                      teamId: team.ht_team_id,
                      teamName: team.name,
                      logoUrl: team.logo_url,
                      countryId: team.country_id,
                      countryName: team.country_name,
                      leagueId: team.league_id,
                    }}
                    status={
                      <>Active in: <a href={`/t/${team.tournament_slug}`}>{team.tournament_name}</a></>
                    }
                  />
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
