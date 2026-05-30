import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import { Trophy, ShieldCheck, Users, Calendar, Activity, ChevronRight, DoorOpen } from 'lucide-react';
import styles from './Home.module.sass';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const [activeTournaments, setActiveTournaments] = useState<any[]>([]);
  const [openTournaments, setOpenTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    try {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const { data: tournaments, error: tError } = await supabase
        .from('tournaments')
        .select(`
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
        `)
        .eq('is_private', false)
        .gte('created_at', oneMonthAgo.toISOString());

      if (tError) throw tError;

      if (tournaments) {
        const active: any[] = [];
        const open: any[] = [];

        tournaments.forEach((t: any) => {
          const allMatches = t.rounds.flatMap((r: any) => r.matches);
          const totalMatches = allMatches.length;
          const completedMatches = allMatches.filter((m: any) => m.completed).length;
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

        setActiveTournaments(active.sort((a, b) => b.activityScore - a.activityScore));
        setOpenTournaments(open.sort((a, b) => b.teamCount - a.teamCount));
      }
    } catch (err) {
      console.error('Error fetching tournaments:', err);
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
            friendly matches in Hattrick. The idea started in the tiny Guam based HFI community - we are just 13 teams and
            were looking for a way to reliably organize regular non-international friendlies. Step-by-step it grew into a
            120 min friendly tournament tool.
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
          <p>Choose between 120min training focus or classic competition.</p>
        </Card>
      </div>
    </div>
  );
};
