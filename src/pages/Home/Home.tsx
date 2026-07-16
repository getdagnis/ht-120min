import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { HeroCard } from '../../components/Card/HeroCard';
import { TournamentCard } from '../../components/Card/TournamentCard';
import { SectionCard } from '../../components/Card/SectionCard';
import { FaqRenderer } from '../../components/Faq/FaqRenderer';
import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
import { SidebarWidget } from '../../components/SidebarWidget/SidebarWidget';
import { TinderWidget } from '../../components/TinderWidget/TinderWidget';
import { SupportersWall } from '../../components/SupportersWall/SupportersWall';
import { WelcomeModal } from '../../components/WelcomeModal/WelcomeModal';
import { Link as ScrollTo, Element } from 'react-scroll';
import { sortOpenTournaments } from '../../utils/open-tournaments';
import { getMatchDateForRound } from '../../utils/match-schedule';
import { getTournamentNextMatchDate } from '../../utils/tournament-next-match';
import { sortFeaturedFirst } from '../../utils/tournament-sorting';
import { getPublishedFaqSections } from '../../constants/faq-essential';
import { dismissWelcome, hasDismissedWelcome, HOME_WELCOME_KEY } from '../../utils/welcome-modals';
import {
  Trophy,
  CalendarBlank,
  Heartbeat,
  CaretLeft,
  ArrowRight,
  Star,
  Clock,
  FolderOpen,
  ChatText,
} from 'phosphor-react';
import { TeamsIcon } from '../../components/Icons/TeamsIcon';
import styles from './Home.module.sass';

const FORUM_LINK = 'https://www.hattrick.org/goto.ashx?path=/Forum/Overview.aspx?v=0&f=1558036';
const SHOW_FAQ = true;

interface DBTeamMatch {
  id: string;
  completed: boolean;
  home_goals: number | null;
  away_goals: number | null;
  went_120: boolean;
  status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished';
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_for?: string | null;
  home_team: { country_name: string } | null;
}

interface DBRound {
  id: string;
  created_at: string;
  round_number: number;
  matches: DBTeamMatch[] | null;
}

interface DBTournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  schedule_start_slot?: string | null;
  is_featured?: boolean | null;
  is_private: boolean;
  is_test?: boolean | null;
  status?: string | null;
  is_archived?: boolean | null;
  season: number;
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
  max_teams: number | null;
  validatedTeamCount: number;
  totalRounds: number;
  completedRounds: number;
  totalMatches: number;
  completedMatches: number;
  activityScore: number;
  teamCount: number;
  nextMatchDate: Date | null;
  plannedStartDate: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  is_featured: boolean;
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

const ForumWidget = () => (
  <SidebarWidget
    title="Join HT-120min forum on HT!"
    icon={<ChatText size={20} weight="bold" />}
    footer={
      <a href={FORUM_LINK} target="_blank" rel="noreferrer">
        Join HT-120min forum <ArrowRight size={12} weight="bold" />
      </a>
    }
  >
    <p>Found a bug, have an idea for a new feature or just want to say something?</p>
  </SidebarWidget>
);

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);
  const [featuredTournaments, setFeaturedTournaments] = useState<Tournament[]>([]);
  const [activeTournaments, setActiveTournaments] = useState<Tournament[]>([]);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);
  const [topTeams, setTopTeams] = useState<TopTeam[]>([]);
  const [topActiveTournaments, setTopActiveTournaments] = useState<TopTournament[]>([]);
  const faqContent = useMemo(() => getPublishedFaqSections(), []);

  const showFaq = faqContent.length > 0 && SHOW_FAQ;

  useEffect(() => {
    const id = setTimeout(() => {
      if (!hasDismissedWelcome(HOME_WELCOME_KEY)) {
        setShowWelcome(true);
      }
    }, 0);

    return () => clearTimeout(id);
  }, []);

  const closeWelcome = () => {
    dismissWelcome(HOME_WELCOME_KEY);
    setShowWelcome(false);
  };

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
          schedule_start_slot,
          is_featured,
          is_private,
          is_test,
          status,
          is_archived,
          season,
          thumbnail_index,
          image_url,
          country_limit,
          scoring_mode,
          league_category,
          max_teams,
          rounds (
            id,
            created_at,
            round_number,
            matches (
              id,
              completed,
              status,
              home_team_id,
              away_team_id,
              scheduled_for,
              home_team:teams!matches_home_team_id_fkey(country_name),
              away_team:teams!matches_away_team_id_fkey(country_name)
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

        const featured: Tournament[] = [];
        const active: Tournament[] = [];
        const open: Tournament[] = [];
        const team120Stats: Record<number, { name: string; count: number }> = {};
        const tournamentsData = tournaments as unknown as DBTournament[];

        tournamentsData
          .filter((t) => !t.is_test && t.status !== 'stopped' && t.status !== 'archived' && !t.is_archived)
          .forEach((t: DBTournament) => {
            // Count validated teams
            const validatedTeamCount = t.teams.filter((team) => team.joined_via_oauth).length;

            const totalRounds = t.rounds?.length ?? 0;
            const completedRounds =
              t.rounds?.filter((round) => {
                const matches = round.matches ?? [];
                return matches.length > 0 && matches.every((m) => m.completed || m.status === 'misarranged');
              }).length ?? 0;
            const allMatches = t.rounds?.flatMap((r) => r.matches ?? []) ?? [];
            const totalMatches = allMatches.length;
            // Count finished or misarranged as completed
            const completedMatches = allMatches.filter((m) => m.completed || m.status === 'misarranged').length;
            const isClosed = totalMatches > 0 && totalMatches === completedMatches;
            const isGenerated = (t.rounds?.length ?? 0) > 0;
            const nextMatchDate = isGenerated && !isClosed ? getTournamentNextMatchDate(t.rounds, warnings) : null;
            const allMatchDates = (t.rounds ?? []).flatMap((round) =>
              (round.matches ?? []).map((match) => getMatchDateForRound(round, match, match.home_team?.country_name)),
            );
            const completedMatchDates = (t.rounds ?? []).flatMap((round) =>
              (round.matches ?? [])
                .filter((match) => match.completed || match.status === 'misarranged')
                .map((match) => getMatchDateForRound(round, match, match.home_team?.country_name)),
            );
            const plannedStartDate = t.schedule_start_slot ? new Date(t.schedule_start_slot) : null;
            const startedAt =
              allMatchDates.sort((a, b) => a.getTime() - b.getTime())[0] ?? plannedStartDate ?? new Date(t.created_at);
            const finishedAt =
              completedMatchDates.sort((a, b) => a.getTime() - b.getTime()).at(-1) ?? null;

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
              totalRounds,
              completedRounds,
              totalMatches,
              completedMatches,
              activityScore: completedMatches,
              teamCount: t.teams.length,
              nextMatchDate,
              plannedStartDate,
              startedAt,
              finishedAt,
              validatedTeamCount,
              is_featured: Boolean(t.is_featured),
            };

            if (tournamentObj.is_featured) {
              featured.push(tournamentObj as Tournament);
            } else if (isGenerated && !isClosed && t.status !== 'finished') {
              active.push(tournamentObj as Tournament);
            } else if (!isGenerated && t.status !== 'finished') {
              open.push(tournamentObj as Tournament);
            }
          });

        setFeaturedTournaments(
          sortFeaturedFirst(featured, (a, b) => {
            const statusWeight = (tournament: Tournament) => {
              if (tournament.status === 'finished' || tournament.totalMatches === tournament.completedMatches) return 3;
              if ((tournament.rounds?.length ?? 0) > 0) return 1;
              return 2;
            };
            const weightDelta = statusWeight(a) - statusWeight(b);
            if (weightDelta !== 0) return weightDelta;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          }),
        );

        // Sort by validated count first, then next match date
        setActiveTournaments(
          sortFeaturedFirst(active, (a, b) => {
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

  const getTournamentStateLabel = (tournament: Tournament) => {
    const seasonLabel = `season ${tournament.season}`;
    const isGenerated = (tournament.rounds?.length ?? 0) > 0;
    const isFinished =
      tournament.status === 'finished' ||
      (tournament.totalMatches > 0 && tournament.totalMatches === tournament.completedMatches);

    if (isFinished) return `${seasonLabel} finished`;
    if (tournament.status === 'paused') return `${seasonLabel} paused`;
    if (isGenerated) return `${seasonLabel} ongoing`;
    return `waiting participants for ${seasonLabel}`;
  };

  const getTournamentDateLabel = (tournament: Tournament) => {
    const formatDate = (date: Date | null) =>
      date
        ? new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }).format(date)
        : null;

    const isFinished =
      tournament.status === 'finished' ||
      (tournament.totalMatches > 0 && tournament.totalMatches === tournament.completedMatches);

    if (tournament.status === 'waiting') {
      return `Season ${tournament.season}: ${formatDate(tournament.plannedStartDate || tournament.startedAt || null) ?? formatDate(new Date(tournament.created_at))}`;
    }

    if (isFinished) {
      return `Finished: ${formatDate(tournament.finishedAt || tournament.startedAt || tournament.plannedStartDate || new Date(tournament.created_at))}`;
    }

    if ((tournament.rounds?.length ?? 0) > 0 || tournament.status === 'active' || tournament.status === 'paused' || tournament.status === 'stopped') {
      return `Started: ${formatDate(tournament.startedAt || tournament.plannedStartDate || new Date(tournament.created_at))}`;
    }

    return `Planned: ${formatDate(tournament.plannedStartDate || new Date(tournament.created_at))}`;
  };

  const renderTournamentCard = (t: Tournament, options: { join?: boolean } = {}) => (
    <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
      <TournamentCard
        id={t.id}
        className={styles.tournamentCard}
        thumbnailIndex={t.thumbnail_index}
        imageUrl={t.image_url}
        countryLimit={t.country_limit}
        scoringMode={t.scoring_mode}
        leagueCategory={t.league_category}
        maxTeams={t.max_teams}
        teamCount={t.teamCount}
        joinHref={options.join ? `/t/${t.slug}` : undefined}
      >
        <div className={styles.tInfo}>
          <div className={styles.tTitleRow}>
            <div className={styles.tHeading}>
              <h3 className={styles.tName}>{t.name}</h3>
              <span className={styles.tState}>{getTournamentStateLabel(t)}</span>
            </div>
            <CaretLeft size={18} weight="regular" className={styles.tArrow} />
          </div>
          <div className={styles.tMeta}>
            {(t.rounds?.length ?? 0) > 0 ? (
              <span title="Completed Matches">
                <Trophy size={14} weight="regular" /> {t.completedRounds} / {t.totalRounds} rounds
              </span>
            ) : (
              <span title="Registered Teams">
                <TeamsIcon size={14} /> {t.teamCount} teams
              </span>
            )}
            <span title="Tournament date">
              <CalendarBlank size={14} weight="regular" /> {getTournamentDateLabel(t)}
            </span>
          </div>
          <div className={styles.tTeams}>
            {t.teams.slice(0, 6).map((team) => (
              <span key={team.id} className={styles.teamChip}>
                {team.name}
              </span>
            ))}
            {t.teams.length > 6 && <span className={styles.teamChipMore}>+{t.teams.length - 6} more</span>}
          </div>
        </div>
      </TournamentCard>
    </Link>
  );

  return (
    <div className={styles.home}>
      <WelcomeModal
        isOpen={showWelcome}
        onClose={closeWelcome}
        imageSrc="/w16-planning-1.png"
        imageAlt="Hattrick managers preparing for a new tournament season"
        title="Plan next season’s friendlies now"
        buttonLabel="Join us!"
      >
        <p>The cups are still running, but this is the best time to prepare what comes after them.</p>
        <ul>
          <li>
            <strong>Create a test tournament</strong> and experience it from the inside.
          </li>
          <li>Try schedules, standings and simulated matches without consequences.</li>
          <li>Invite a few managers when you are ready to make it real.</li>
        </ul>

        <p>
          Need people or ideas? Visit our{' '}
          <a href={FORUM_LINK} target="_blank" rel="noreferrer">
            Hattrick forum
          </a>
          .
        </p>

        <p>When the cups end, your next competition could already be waiting.</p>
      </WelcomeModal>

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
            {featuredTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <Star size={24} weight="regular" className={styles.sectionIcon} />
                  <h2>Featured Tournaments</h2>
                </div>
                <div className={styles.tournamentGrid}>{featuredTournaments.map((t) => renderTournamentCard(t))}</div>
              </section>
            )}

            {activeTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <Heartbeat size={24} weight="regular" className={styles.sectionIcon} />
                  <h2>Ongoing Tournaments</h2>
                </div>
                <div className={styles.tournamentGrid}>{activeTournaments.map((t) => renderTournamentCard(t))}</div>
              </section>
            )}

            <Element name="opentours" />

            {openTournaments.length > 0 && (
              <section className={styles.activeSection}>
                <div className={styles.sectionHeader}>
                  <FolderOpen size={24} className={styles.sectionIcon} />
                  <h2>Waiting Participants</h2>
                </div>

                <div className={styles.tournamentGrid}>
                  {openTournaments.map((t) => renderTournamentCard(t, { join: true }))}
                </div>
              </section>
            )}

            {showFaq && <FaqRenderer sections={faqContent} className={styles.faqRenderer} />}
          </div>

          <aside className={styles.rightColumn}>
            <div className={styles.tinderSlot}>
              <TinderWidget className={styles.marketplaceWrapper} />
            </div>
            <ForumWidget />
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
