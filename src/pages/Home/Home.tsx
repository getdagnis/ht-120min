import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { Trophy, ShieldCheck, Users, Calendar, Activity, ChevronRight } from 'lucide-react';
import styles from './Home.module.sass';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [activeTournaments, setActiveTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActiveTournaments();
  }, []);

  const fetchActiveTournaments = async () => {
    try {
      // 1. Fetch tournaments created in the last month
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
          rounds (
            id,
            matches (
              id,
              completed
            )
          )
        `,
        )
        .gte('created_at', oneMonthAgo.toISOString());

      if (tError) throw tError;

      if (tournaments) {
        // 2. Process data in JS to filter and sort by activity
        const processed = tournaments
          .map((t: any) => {
            const allMatches = t.rounds.flatMap((r: any) => r.matches);
            const totalMatches = allMatches.length;
            const completedMatches = allMatches.filter((m: any) => m.completed).length;
            const isClosed = totalMatches > 0 && totalMatches === completedMatches;

            return {
              ...t,
              totalMatches,
              completedMatches,
              isClosed,
              activityScore: completedMatches, // Activity defined as number of games played
            };
          })
          .filter((t) => !t.isClosed && t.totalMatches > 0) // Only active tournaments with a schedule
          .sort((a, b) => b.activityScore - a.activityScore); // More active on top

        setActiveTournaments(processed);
      }
    } catch (err) {
      console.error('Error fetching active tournaments:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.home}>
      <Card variant="hero" className={styles.heroCard}>
        <section className={styles.hero}>
          <Trophy size={80} className={styles.heroIcon} />
          <h1>HT-120min</h1>
          <img src="/hero1.png" alt="HT-120min" className={styles.heroImg} />
          <p className={styles.subtitle}>
            <strong>HT-120min</strong> is a small community tool for organizing friendly tournaments and recurring
            friendly matches in Hattrick. The idea started in the tiny Guam based HFI community - we are just 13 teams
            and were looking for a way to reliably organize regular non-international friendlies. It quickly grew into a
            more universal 120 min friendly tournament tool.
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

      <div className={styles.features}>
        <Card className={styles.feature}>
          <ShieldCheck size={40} />
          <h3>Simple Admin</h3>
          <p>
            No accounts needed. Manage everything with a public URL and a password that you can share or keep to
            yourself.
          </p>
        </Card>
        <Card className={styles.feature}>
          <Users size={40} />
          <h3>Round Robin</h3>
          <p>Automatic schedule generation for any number of teams.</p>
        </Card>
        <Card className={styles.feature}>
          <Trophy size={40} />
          <h3>Flexible Scoring</h3>
          <p>Choose between 120m training focus or classic competition.</p>
        </Card>
      </div>
    </div>
  );
};
