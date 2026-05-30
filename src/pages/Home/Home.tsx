import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { Trophy, Users, Calendar, Activity, ChevronRight, DoorOpen } from 'lucide-react';
import styles from './Home.module.sass';

interface Tournament {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  is_private: boolean;
  rounds: {
    id: string;
    matches: {
      id: string;
      completed: boolean;
    }[];
  }[];
  teams: {
    id: string;
  }[];
  totalMatches?: number;
  completedMatches?: number;
  activityScore?: number;
  teamCount?: number;
}

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [activeTournaments, setActiveTournaments] = useState<Tournament[]>([]);
  const [openTournaments, setOpenTournaments] = useState<Tournament[]>([]);

  const fetchTournaments = useCallback(async () => {
    try {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const { data: tournaments, error: tError } = await supabase
        .from('tournaments')
        .select(
          `
          id, 
          name, 
          slug, 
          created_at,
          is_private,
          rounds (
            id,
            matches (
              id,
              completed
            )
          ),
          teams (
            id
          )
        `,
        )
        .eq('is_private', false)
        .gte('created_at', oneMonthAgo.toISOString());

      if (tError) throw tError;

      if (tournaments) {
        const active: Tournament[] = [];
        const open: Tournament[] = [];

        (tournaments as unknown as Tournament[]).forEach((t) => {
          const allMatches = t.rounds.flatMap((r) => r.matches);
          const totalMatches = allMatches.length;
          const completedMatches = allMatches.filter((m) => m.completed).length;
          const isClosed = totalMatches > 0 && totalMatches === completedMatches;
          const isGenerated = t.rounds.length > 0;

          if (isGenerated && !isClosed) {
            active.push({
              ...t,
              totalMatches,
              completedMatches,
              activityScore: completedMatches,
            });
          } else if (!isGenerated) {
            open.push({
              ...t,
              teamCount: t.teams.length,
            });
          }
        });

        setActiveTournaments(active.sort((a, b) => (b.activityScore ?? 0) - (a.activityScore ?? 0)));
        setOpenTournaments(open.sort((a, b) => (b.teamCount ?? 0) - (a.teamCount ?? 0)));
      }
    } catch (err) {
      console.error('Error fetching tournaments:', err);
    }
  }, []);

  useEffect(() => {
    fetchTournaments();
  }, [fetchTournaments]);

  return (
    <div className={styles.home}>
      <Card variant="hero" className={styles.heroCard}>
        <section className={styles.hero}>
          <h1 className={styles.visuallyHidden}>HT-120min</h1>
          <img src="/hero-logo.png" alt="HT-120min" className={styles.heroImg} />
          <p className={styles.subtitle}>
            <strong>HT-120min</strong> is a small community tool for organizing friendly tournaments and recurring
            friendly matches in Hattrick. The idea started in the tiny Guam based HFI community - we are just 13 teams
            and were looking for a way to reliably organize regular non-international friendlies. In no time it grew
            into an idea for a 120 min friendly tournament tool.
          </p>
          <Button size="lg" onClick={() => navigate('/create')} variant="secondary">
            Create Tournament
          </Button>
        </section>
      </Card>

      {activeTournaments.length > 0 && (
        <section className={styles.activeSection}>
          <div className={styles.sectionHeader}>
            <Activity className={styles.sectionIcon} size={24} />
            <h2>Active Tournaments</h2>
          </div>
          <div className={styles.tournamentGrid}>
            {activeTournaments.map((t) => (
              <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
                <Card variant="classic" className={styles.tournamentCard}>
                  <div className={styles.tInfo}>
                    <h3>{t.name}</h3>
                    <div className={styles.tMeta}>
                      <span title="Completed Matches">
                        <Trophy size={14} /> {t.completedMatches} / {t.totalMatches} matches
                      </span>
                      <span title="Creation Date">
                        <Calendar size={14} /> {new Date(t.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className={styles.tArrow} size={20} />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {openTournaments.length > 0 && (
        <section className={styles.activeSection}>
          <div className={styles.sectionHeader}>
            <DoorOpen className={styles.sectionIcon} size={24} />
            <h2>Open for Registration</h2>
          </div>
          <div className={styles.tournamentGrid}>
            {openTournaments.map((t) => (
              <Link key={t.id} to={`/t/${t.slug}`} className={styles.tournamentLink}>
                <Card variant="classic" className={styles.tournamentCard}>
                  <div className={styles.tInfo}>
                    <h3>{t.name}</h3>
                    <div className={styles.tMeta}>
                      <span title="Registered Teams">
                        <Users size={14} /> {t.teamCount} teams
                      </span>
                      <span title="Creation Date">
                        <Calendar size={14} /> {new Date(t.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className={styles.tArrow} size={20} />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className={styles.features}>
        <Card className={styles.feature}>
          <Trophy size={40} />
          <h3>120min scoring</h3>
          <p>
            120min friendlies are not about winning the games! Opting for a 120min tournament will award you for
            achieving just that!
          </p>
        </Card>
        <Card className={styles.feature}>
          <Users size={40} />
          <h3>Recurring Friendlies</h3>
          <p>
            Don't want to play a full-size tournament? You can also just use HT-120min to schedule and track recurring
            120min or regular friendlies.
          </p>
        </Card>
        <Card className={styles.feature}>
          <Users size={40} />
          <h3>Round Robin</h3>
          <p>Generate schedule automatically. Choose between single, double round robins or recurring schedule!</p>
        </Card>
        <Card className={styles.feature}>
          <Users size={40} />
          <h3>Simple Admin</h3>
          <p>
            No accounts needed. Manage everything with a public URL and a password that you can share or keep to
            yourself.
          </p>
        </Card>
      </div>
    </div>
  );
};
