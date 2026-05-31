import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { Lineicons } from '@lineiconshq/react-lineicons';
import {
  Trophy1Outlined,
  CalendarDaysOutlined,
  BeatOutlined,
  ChevronLeftOutlined,
  StarFatOutlined,
  FilePencilOutlined,
} from '@lineiconshq/free-icons';
import { TeamsIcon } from '../../components/Icons/TeamsIcon';
import styles from './Home.module.sass';

interface Tournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_private: boolean;
  thumbnail_index?: number;
  rounds: {
    id: string;
    matches: {
      id: string;
      completed: boolean;
      home_goals: number | null;
      away_goals: number | null;
      went_120: boolean;
      home_team_id: string;
      away_team_id: string;
    }[];
  }[];
  teams: {
    id: string;
    name: string;
    ht_team_id: number;
  }[];
  totalMatches?: number;
  completedMatches?: number;
  activityScore?: number;
  teamCount?: number;
}

interface TopTeam {
  name: string;
  ht_team_id: number;
  achievements120min: number;
}

interface TopTournament {
  name: string;
  slug: string;
  completedMatches: number;
}

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [activeTournaments, setActiveTournaments] = useState<Tournament[]>([]);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);
  const [topTeams, setTopTeams] = useState<TopTeam[]>([]);
  const [topActiveTournaments, setTopActiveTournaments] = useState<TopTournament[]>([]);

  const fetchTournaments = useCallback(async () => {
    try {
      const { data: tournaments, error: tError } = await supabase
        .from('tournaments')
        .select(
          `
          id, 
          name, 
          slug, 
          created_at,
          is_private,
          thumbnail_index,
          rounds (
            id,
            matches (
              id,
              completed,
              home_goals,
              away_goals,
              went_120,
              home_team_id,
              away_team_id
            )
          ),
          teams (
            id,
            name,
            ht_team_id
          )
        `,
        )
        .eq('is_private', false);

      if (tError) throw tError;

      if (tournaments) {
        const active: Tournament[] = [];
        const open: Tournament[] = [];
        const team120Stats: Record<number, { name: string; count: number }> = {};
        const tournamentsData = tournaments as unknown as Tournament[];

        tournamentsData.forEach((t) => {
          const allMatches = t.rounds.flatMap((r) => r.matches);
          const totalMatches = allMatches.length;
          const completedMatches = allMatches.filter((m) => m.completed).length;
          const isClosed = totalMatches > 0 && totalMatches === completedMatches;
          const isGenerated = t.rounds.length > 0;

          allMatches.forEach((m) => {
            if (m.completed && m.went_120) {
              const homeTeam = t.teams.find((team) => team.id === m.home_team_id);
              const awayTeam = t.teams.find((team) => team.id === m.away_team_id);

              if (homeTeam && homeTeam.ht_team_id) {
                if (!team120Stats[homeTeam.ht_team_id])
                  team120Stats[homeTeam.ht_team_id] = { name: homeTeam.name, count: 0 };
                team120Stats[homeTeam.ht_team_id].count++;
              }
              if (awayTeam && awayTeam.ht_team_id) {
                if (!team120Stats[awayTeam.ht_team_id])
                  team120Stats[awayTeam.ht_team_id] = { name: awayTeam.name, count: 0 };
                team120Stats[awayTeam.ht_team_id].count++;
              }
            }
          });

          if (isGenerated && !isClosed) {
            active.push({ ...t, totalMatches, completedMatches, activityScore: completedMatches });
          } else if (!isGenerated) {
            open.push({ ...t, teamCount: t.teams.length });
          }
        });

        setActiveTournaments(active.sort((a, b) => (b.activityScore ?? 0) - (a.activityScore ?? 0)));
        setOpenTournaments(open.sort((a, b) => (b.teamCount ?? 0) - (a.teamCount ?? 0)));

        const topTeamsList = Object.entries(team120Stats)
          .map(([id, data]) => ({ ht_team_id: parseInt(id), name: data.name, achievements120min: data.count }))
          .sort((a, b) => b.achievements120min - a.achievements120min)
          .slice(0, 10);
        setTopTeams(topTeamsList);

        const topActive = active
          .map((t) => ({ name: t.name, slug: t.slug, completedMatches: t.completedMatches ?? 0 }))
          .sort((a, b) => b.completedMatches - a.completedMatches)
          .slice(0, 10);
        setTopActiveTournaments(topActive);
      }
    } catch (err) {
      console.error('Error fetching tournaments:', err);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTournaments();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTournaments]);

  return (
    <div className={styles.home}>
      <div className={styles.container}>
        <Card variant="hero" className={styles.heroCard}>
          <section className={styles.hero}>
            <h1 className={styles.hiddenH1}>HT-120min</h1>
            <img src="/hero-logo-2.png" alt="HT-120min" className={styles.heroImg} />
            <p className={styles.subtitle}>
              Organize 120 min or classic Hattrick friendlies and tournaments using nothing but fireworks🎆. No excel
              tables. No paper hustle. No awkward conferences silence. You can now be 100% friendly with your HT pals.
              At least for the first 90 minutes.
            </p>
            <Button size="lg" onClick={() => navigate('/create')} variant="secondary">
              <Lineicons icon={Trophy1Outlined} size={18} /> Fancy a tournament?
            </Button>
          </section>
        </Card>

        <MottoWidget />

        <div className={styles.mainGrid}>
          <div className={styles.leftColumn}>
            {activeTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <Lineicons icon={BeatOutlined} className={styles.sectionIcon} size={24} />
                  <h2>Tournaments Having a Blast</h2>
                </div>
                <div className={styles.tournamentGrid}>
                  {activeTournaments.map((t) => (
                    <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
                      <Card variant="classic" className={styles.tournamentCard} thumbnailIndex={t.thumbnail_index}>
                        <div className={styles.tInfo}>
                          <div className={styles.tTitleRow}>
                            <h3 className={styles.tName}>{t.name}</h3>
                            <Lineicons icon={ChevronLeftOutlined} className={styles.tArrow} size={18} />
                          </div>
                          <div className={styles.tMeta}>
                            <span title="Completed Matches">
                              <Lineicons icon={Trophy1Outlined} size={14} /> {t.completedMatches} / {t.totalMatches}{' '}
                              matches
                            </span>
                            <span title="Creation Date">
                              <Lineicons icon={CalendarDaysOutlined} size={14} />{' '}
                              {new Date(t.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className={styles.tTeams}>
                            {t.teams.slice(0, 6).map((team) => (
                              <span key={team.id} className={styles.teamChip}>
                                {team.name}
                              </span>
                            ))}
                            {t.teams.length > 6 && (
                              <span className={styles.teamChipMore}>+{t.teams.length - 6} more</span>
                            )}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {openTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <Lineicons icon={FilePencilOutlined} className={styles.sectionIcon} size={24} />
                  <h2>Open for Registration</h2>
                </div>
                <div className={styles.tournamentGrid}>
                  {openTournaments.map((t) => (
                    <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
                      <Card variant="classic" className={styles.tournamentCard} thumbnailIndex={t.thumbnail_index}>
                        <div className={styles.tInfo}>
                          <div className={styles.tTitleRow}>
                            <h3 className={styles.tName}>{t.name}</h3>
                            <Lineicons icon={ChevronLeftOutlined} className={styles.tArrow} size={18} />
                          </div>
                          <div className={styles.tMeta}>
                            <span title="Registered Teams">
                              <TeamsIcon size={14} /> {t.teamCount} teams
                            </span>
                            <span title="Creation Date">
                              <Lineicons icon={CalendarDaysOutlined} size={14} />{' '}
                              {new Date(t.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className={styles.tTeams}>
                            {t.teams.slice(0, 6).map((team) => (
                              <span key={team.id} className={styles.teamChip}>
                                {team.name}
                              </span>
                            ))}
                            {t.teams.length > 6 && (
                              <span className={styles.teamChipMore}>+{t.teams.length - 6} more</span>
                            )}
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className={styles.rightColumn}>
            <div className={styles.sectionHeader}>
              <Lineicons icon={StarFatOutlined} className={styles.sectionIcon} size={24} />
              <h2>Monthly Best</h2>
            </div>
            {topTeams.length > 0 && (
              <Card title="Top 10 Teams (120m)" variant="classic" className={styles.statsCard}>
                <ol className={styles.statsList}>
                  {topTeams.map((team, idx) => (
                    <li key={team.ht_team_id}>
                      <div className={styles.statItem}>
                        <span className={styles.rank}>{idx + 1}.</span>
                        <span className={styles.name}>{team.name}</span>
                        <span className={styles.value}>{team.achievements120min}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            {topActiveTournaments.length > 0 && (
              <Card title="Most Active" variant="classic" className={styles.statsCard}>
                <ul className={styles.statsList}>
                  {topActiveTournaments.map((t) => (
                    <li key={t.slug}>
                      <div className={styles.statItem}>
                        <Link to={`/t/${t.slug}`} className={styles.name}>
                          {t.name}
                        </Link>
                        <span className={styles.value}>{t.completedMatches}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </aside>
        </div>

        <div className={styles.features}>
          <Card className={styles.feature}>
            <Lineicons icon={Trophy1Outlined} size={40} />
            <h3>120min scoring</h3>
            <p>
              120min friendlies are not about winning the games! Opting for a 120min tournament will award you for
              achieving just that!
            </p>
          </Card>
          <Card className={styles.feature}>
            <Lineicons icon={BeatOutlined} size={40} />
            <h3>Recurring Friendlies</h3>
            <p>
              Don't want to play a full-size tournament? You can also just use HT-120min to schedule and track recurring
              120min or regular friendlies.
            </p>
          </Card>
          <Card className={styles.feature}>
            <Lineicons icon={BeatOutlined} size={40} />
            <h3>Round Robin</h3>
            <p>Generate schedule automatically. Choose between single, double round robins or recurring schedule!</p>
          </Card>
          <Card className={styles.feature}>
            <TeamsIcon size={40} />
            <h3>Simple Admin</h3>
            <p>
              No accounts needed. Manage everything with a public URL and a password that you can share or keep to
              yourself.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
};
