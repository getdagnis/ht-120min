import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { HeroCard } from '../../components/Card/HeroCard';
import { TournamentCard } from '../../components/Card/TournamentCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { TinderWidget } from '../../components/TinderWidget/TinderWidget';
import { SupportersWall } from '../../components/SupportersWall/SupportersWall';
import { Link as ScrollTo, Element } from 'react-scroll';
import { calculateMatchDate } from '../../utils/ht-data';
import { sortOpenTournaments } from '../../utils/open-tournaments';
import { Trophy, CalendarBlank, Heartbeat, CaretLeft, ArrowRight, Star, Clock, FolderOpen } from 'phosphor-react';
import { TeamsIcon } from '../../components/Icons/TeamsIcon';
import styles from './Home.module.sass';

interface DBTeamMatch {
  id: string;
  completed: boolean;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  home_team_id: string;
  away_team_id: string;
  home_team: { country_name: string } | null;
}

interface DBRound {
  id: string;
  round_number: number;
  matches: DBTeamMatch[] | null;
}

interface DBTournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_private: boolean;
  thumbnail_index?: number;
  image_url?: string;
  rounds: DBRound[] | null;
  teams: {
    id: string;
    name: string;
    ht_team_id: number;
    joined_via_oauth: boolean;
  }[];
}

interface DBWarning {
  round_id: string;
  team_id: string;
}

interface Tournament extends DBTournament {
  scoring_mode: string | null | undefined;
  league_category: string | null | undefined;
  country_limit: string | null;
  validatedTeamCount: number;
  totalMatches: number;
  completedMatches: number;
  activityScore: number;
  teamCount: number;
  nextMatchDate: Date | null;
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
      // Fetch tournaments with validated team counts
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
          image_url,
          country_limit,
          scoring_mode,
          league_category,
          rounds (
            id,
            round_number,
            matches (
              id,
              completed,
              status,
              home_team_id,
              home_team:teams!matches_home_team_id_fkey(country_name)
            )
          ),
          teams (
            id,
            name,
            ht_team_id,
            joined_via_oauth
          )
        `,
        )
        .eq('is_private', false);

      if (tError) throw tError;

      if (tournaments) {
        const { data: warningsRaw } = await supabase
          .from('fixture_warnings')
          .select('round_id, team_id')
          .eq('active', true);
        const warnings = warningsRaw as unknown as DBWarning[] | null;

        const active: Tournament[] = [];
        const open: Tournament[] = [];
        const team120Stats: Record<number, { name: string; count: number }> = {};
        const tournamentsData = tournaments as unknown as DBTournament[];

        tournamentsData.forEach((t: DBTournament) => {
          // Count validated teams
          const validatedTeamCount = t.teams.filter((team) => team.joined_via_oauth).length;

          const allMatches = t.rounds?.flatMap((r) => r.matches ?? []) ?? [];
          const totalMatches = allMatches.length;
          // Count finished or misarranged as completed
          const completedMatches = allMatches.filter((m) => m.completed || m.status === 'misarranged').length;
          const isClosed = totalMatches > 0 && totalMatches === completedMatches;
          const isGenerated = (t.rounds?.length ?? 0) > 0;

          // Calculate next match date
          let nextMatchDate: Date | null = null;
          if (isGenerated && !isClosed && t.rounds) {
            const sortedRounds = [...t.rounds].sort((a, b) => a.round_number - b.round_number);
            for (const round of sortedRounds) {
              const uncompletedMatches = round.matches?.filter((m) => !m.completed) ?? [];
              const validMatches = uncompletedMatches.filter(
                (m) => !warnings?.some((w) => w.round_id === round.id && w.team_id === m.home_team_id),
              );
              if (validMatches.length > 0) {
                nextMatchDate = calculateMatchDate(
                  t.created_at,
                  round.round_number,
                  validMatches[0].home_team?.country_name,
                );
                break;
              }
            }
          }

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

          const tournamentObj = {
            ...t,
            totalMatches,
            completedMatches,
            activityScore: completedMatches,
            teamCount: t.teams.length,
            nextMatchDate,
            validatedTeamCount,
          };

          if (isGenerated && !isClosed) {
            active.push(tournamentObj as Tournament);
          } else if (!isGenerated) {
            open.push(tournamentObj as Tournament);
          }
        });

        // Sort by validated count first, then next match date
        setActiveTournaments(
          active.sort((a, b) => {
            if (b.validatedTeamCount !== a.validatedTeamCount) {
              return b.validatedTeamCount - a.validatedTeamCount;
            }
            if (!a.nextMatchDate && !b.nextMatchDate) return 0;
            if (!a.nextMatchDate) return 1;
            if (!b.nextMatchDate) return -1;
            return a.nextMatchDate.getTime() - b.nextMatchDate.getTime();
          }),
        );

        // Sort by fill % when capped, otherwise by registered team count
        setOpenTournaments(sortOpenTournaments(open));

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
    } catch (err: unknown) {
      console.error('Error fetching tournaments:', err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchTournaments();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTournaments]);

  console.log('🏜💀👾 activeTournaments', activeTournaments);

  return (
    <div className={styles.home}>
      <div className={styles.container}>
        <div className={styles.heroBand}>
          <HeroCard className={styles.heroCard}>
            <section className={styles.hero}>
              <h1 className={styles.hiddenH1}>HT-120min</h1>
              <img src="/hero-logo-2.png" alt="HT-120min" className={styles.heroImg} />
              <p className={styles.subtitle}>
                Organize 120 min tournaments and recurring friendlies with ease by getting together with other
                like-minded Hattrick managers.
              </p>
              <div className={styles.ctaBtns}>
                <Button size="lg" onClick={() => navigate('/create')} variant="secondaryYellow">
                  <Trophy size={22} weight="regular" /> Create Tournament
                </Button>
                <ScrollTo to="opentours" smooth={true} duration={600} offset={-80}>
                  <Button size="lg" variant="secondaryHero">
                    <ArrowRight size={22} weight="regular" /> Join Tournament
                  </Button>
                </ScrollTo>
              </div>
            </section>
          </HeroCard>
        </div>
        <MottoWidget />
        <div className={styles.mainGrid}>
          <div className={styles.leftColumn}>
            {activeTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <Heartbeat size={24} weight="regular" className={styles.sectionIcon} />
                  <h2>Featured Tournaments</h2>
                </div>
                <div className={styles.tournamentGrid}>
                  {activeTournaments.map((t) => (
                    <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
                      <TournamentCard
                        id={t.id}
                        className={styles.tournamentCard}
                        thumbnailIndex={t.thumbnail_index}
                        imageUrl={t.image_url}
                        countryLimit={t.country_limit}
                        scoringMode={t.scoring_mode}
                        leagueCategory={t.league_category}
                      >
                        <div className={styles.tInfo}>
                          <div className={styles.tTitleRow}>
                            <h3 className={styles.tName}>{t.name}</h3>
                            <CaretLeft size={18} weight="regular" className={styles.tArrow} />
                          </div>
                          <div className={styles.tMeta}>
                            <span title="Completed Matches">
                              <Trophy size={14} weight="regular" /> {t.completedMatches} / {t.totalMatches} matches
                            </span>
                            {t.nextMatchDate && (
                              <span title="Next Match" className={styles.nextMatch}>
                                <Clock size={14} weight="regular" /> Next:{' '}
                                {t.nextMatchDate.toLocaleDateString('lv-LV', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            )}
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
                      </TournamentCard>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <Element name="opentours" />

            {openTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <FolderOpen size={24} className={styles.sectionIcon} />
                  <h2>Open Tournaments</h2>
                </div>

                <div className={styles.tournamentGrid}>
                  {openTournaments.map((t) => (
                    <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
                      <TournamentCard
                        id={t.id}
                        className={styles.tournamentCard}
                        thumbnailIndex={t.thumbnail_index}
                        imageUrl={t.image_url}
                        countryLimit={t.country_limit}
                        scoringMode={t.scoring_mode}
                        leagueCategory={t.league_category}
                      >
                        <div className={styles.tInfo}>
                          <div className={styles.tTitleRow}>
                            <h3 className={styles.tName}>{t.name}</h3>
                            <CaretLeft size={18} weight="regular" className={styles.tArrow} />
                          </div>
                          <div className={styles.tMeta}>
                            <span title="Registered Teams">
                              <TeamsIcon size={14} /> {t.teamCount} teams
                            </span>
                            <span title="Creation Date">
                              <CalendarBlank size={14} weight="regular" /> {new Date(t.created_at).toLocaleDateString()}
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
                      </TournamentCard>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className={styles.rightColumn}>
            <div className={styles.tinderSlot}>
              <TinderWidget className={styles.marketplaceWrapper} />
            </div>
            <div className={styles.sidebarRest}>
              <SupportersWall />
              <div className={styles.sectionHeader}>
                <Star size={24} weight="regular" className={styles.sectionIcon} />
                <h2>Monthly Best</h2>
              </div>
              {topTeams.length > 0 && (
                <SectionCard title="Top 10 Teams (120m)" className={styles.statsCard}>
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
                </SectionCard>
              )}

              {topActiveTournaments.length > 0 && (
                <SectionCard title="Most Active" className={styles.statsCard}>
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
                </SectionCard>
              )}
            </div>
          </aside>
        </div>
        <h2 className={styles.featuresH2}>The perfect tool for friendly tournaments</h2>
        <div className={styles.features}>
          <Card className={styles.feature}>
            <div className={styles.featureImg1} />
            <h3>Run tournaments, not spreadsheets</h3>
            <p>
              Create or join leagues, cups and recurring competitions in minutes. HT-120min handles schedules, fixtures
              and administration so you can focus on your community.
            </p>
          </Card>
          <Card className={styles.feature}>
            <div className={styles.featureImg2} />
            <h3>Never chase managers again</h3>
            <p>
              Automatic scheduling, challenge tracking, live standings and match updates eliminate most of the
              repetitive work that makes tournament administration painful.
            </p>
          </Card>
          <Card className={styles.feature}>
            <div className={styles.featureImg3} />
            <h3>Build rivalries, not just fixtures</h3>
            <p>
              Achievements, club profiles, records and community leaderboards turn friendly matches into long-term
              stories managers actually care about.
            </p>
          </Card>
        </div>{' '}
        <div className={styles.ctaBtns}>
          <Button size="lg" onClick={() => navigate('/create')} variant="secondaryYellow">
            <Trophy size={22} weight="regular" /> Create Tournament
          </Button>
          <ScrollTo to="opentours" smooth={true} duration={600} offset={-80}>
            <Button size="lg" variant="secondaryHero">
              <ArrowRight size={22} weight="regular" /> Join Tournament
            </Button>
          </ScrollTo>
        </div>
      </div>
    </div>
  );
};
