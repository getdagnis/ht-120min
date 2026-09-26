'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarBlank, Medal, Trophy, UsersThree } from 'phosphor-react';
import { useLocale } from '../../i18n/LocaleProvider';
import { toLocalePath } from '../../next/locale-path';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { Avatar } from '../../components/Avatar/Avatar';
import { Button } from '../../components/Button/Button';
import { ModalTeamCard } from '../../components/ModalTeamCard/ModalTeamCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { getCanonicalCountryName, getCountryFlagUrl, getLeagueFlagUrl } from '../../utils/ht-data';
import { getLeagueWorldDetails } from '../../../shared/worlddetails';
import styles from './ProfilePage.module.sass';

interface ProfileTeam {
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

const formatJoinDate = (value: string) =>
  new Date(value).toLocaleDateString('lv-LV', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

const ProfileTournamentList = ({
  tournaments,
  emptyMessage,
}: {
  tournaments: { id: string; name: string; slug: string; status?: string | null }[];
  emptyMessage: string;
}) => {
  const { locale } = useLocale();

  if (tournaments.length === 0) return <p className={styles.emptyMessage}>{emptyMessage}</p>;

  return (
    <div className={styles.tournamentList}>
      {tournaments.map((tournament) => (
        <Link
          key={tournament.id}
          href={toLocalePath(locale, `/t/${tournament.slug}`)}
          className={styles.tournamentRow}
        >
          <span className={styles.tournamentName}>{tournament.name}</span>
          {tournament.status && <span className={styles.tournamentStatus}>{tournament.status}</span>}
        </Link>
      ))}
    </div>
  );
};

export const ProfilePage: React.FC = () => {
  const { locale } = useLocale();
  const { profile, activeTournaments, finishedTournaments, organizerTournaments, authReady, loading } = useAuth();
  const [teams, setTeams] = useState<ProfileTeam[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);

  useEffect(() => {
    if (!profile?.hattrick_user_id) return;

    let cancelled = false;
    void supabase
      .from('teams')
      .select('id, name, ht_team_id, logo_url, country_id, country_name, league_id, tournaments(name, slug)')
      .eq('hattrick_user_id', profile.hattrick_user_id)
      .eq('active', true)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as unknown as DBTeamWithTournament[] | null) || [];
        setTeams(
          rows.map((team) => ({
            id: team.id,
            name: team.name,
            ht_team_id: team.ht_team_id,
            logo_url: team.logo_url,
            country_id: team.country_id,
            country_name: team.country_name,
            league_id: team.league_id,
            tournament_name: team.tournaments?.name || 'Unknown tournament',
            tournament_slug: team.tournaments?.slug || '',
          })),
        );
        setTeamsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [profile?.hattrick_user_id]);

  if (!authReady || loading) {
    return (
      <main className={styles.page}>
        <SectionCard title="My Profile">
          <p>Loading profile...</p>
        </SectionCard>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className={styles.page}>
        <SectionCard title="My Profile">
          <div className={styles.loginState}>
            <p>Sign in with Hattrick to view your profile and tournament history.</p>
            <Button
              size="sm"
              onClick={() => {
                document.cookie = `auth_return_url=${encodeURIComponent(window.location.pathname)}; path=/; max-age=300`;
                window.location.href = '/api/auth/init';
              }}
            >
              Sign in with Hattrick
            </Button>
          </div>
        </SectionCard>
      </main>
    );
  }

  const countryName = getCanonicalCountryName(profile.country_name, profile.country_id);
  const countryFlagUrl = getCountryFlagUrl(profile.country_id, countryName);
  const league = getLeagueWorldDetails(profile.league_id);
  const leagueFlagUrl = getLeagueFlagUrl(profile.league_id);
  const summaryItems = [
    { label: 'Teams', value: teams.length, icon: <UsersThree size={18} weight="bold" /> },
    { label: 'Playing', value: activeTournaments.length, icon: <Trophy size={18} weight="bold" /> },
    { label: 'Organizing', value: organizerTournaments.length, icon: <Medal size={18} weight="bold" /> },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>HT-120min member area</p>
          <h1>My Profile</h1>
        </div>
        <span className={styles.pageHint}>Your teams, tournaments, and history</span>
      </header>

      <div className={styles.profileGrid}>
        <aside className={styles.sidebar}>
          <section className={styles.identityCard}>
            <Avatar avatar={profile.avatar_json || null} variant="rect" className={styles.avatar} />
            <h2>{profile.manager_name}</h2>
            <a
              className={styles.externalLink}
              href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${profile.hattrick_user_id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Hattrick manager profile <ArrowUpRight size={14} />
            </a>

            <div className={styles.profileMeta}>
              <div>
                <CalendarBlank size={17} weight="bold" />
                <span>Joined {formatJoinDate(profile.created_at)}</span>
              </div>
              {countryName && (
                <div>
                  {countryFlagUrl && <img src={countryFlagUrl} alt="" className={styles.flag} />}
                  <span>{countryName}</span>
                </div>
              )}
              {league && (
                <div>
                  {leagueFlagUrl && <img src={leagueFlagUrl} alt="" className={styles.flag} />}
                  <span>{league.leagueName}</span>
                </div>
              )}
            </div>

            <div className={styles.summaryGrid}>
              {summaryItems.map((item) => (
                <div key={item.label} className={styles.summaryItem}>
                  {item.icon}
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <div className={styles.mainColumn}>
          <SectionCard title="Registered teams">
            {!teamsLoaded ? (
              <p className={styles.emptyMessage}>Loading teams...</p>
            ) : teams.length > 0 ? (
              <div className={styles.teamList}>
                {teams.map((team) => (
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
                      team.tournament_slug ? (
                        <Link href={toLocalePath(locale, `/t/${team.tournament_slug}`)}>
                          Active in: {team.tournament_name}
                        </Link>
                      ) : (
                        team.tournament_name
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <p className={styles.emptyMessage}>No active teams registered yet.</p>
            )}
          </SectionCard>

          <SectionCard title="Participating tournaments">
            <div className={styles.tournamentGroup}>
              <h3>Active</h3>
              <ProfileTournamentList tournaments={activeTournaments} emptyMessage="No active tournaments." />
            </div>
            <div className={styles.tournamentGroup}>
              <h3>Finished / history</h3>
              <ProfileTournamentList tournaments={finishedTournaments} emptyMessage="No finished tournaments yet." />
            </div>
          </SectionCard>

          <SectionCard title="Organized / managed tournaments">
            <div id="organized-tournaments" className={styles.anchorTarget} />
            <ProfileTournamentList
              tournaments={organizerTournaments}
              emptyMessage="No organized tournaments yet."
            />
          </SectionCard>

          <SectionCard title="Achievements">
            <div className={styles.achievementList}>
              <div className={styles.achievementItem}>
                <span className={styles.achievementIcon}>🥇</span>
                <div>
                  <strong>HT-120min member</strong>
                  <span>Joined {formatJoinDate(profile.created_at)}</span>
                </div>
              </div>
              {teams.length > 0 && (
                <div className={styles.achievementItem}>
                  <span className={styles.achievementIcon}>🏆</span>
                  <div>
                    <strong>Tournament participant</strong>
                    <span>{teams.length} active registered team{teams.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>
    </main>
  );
};
