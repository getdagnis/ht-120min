import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Trophy, ShieldCheck, Users } from 'lucide-react';
import styles from './Home.module.scss';

export const Home: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className={styles.home}>
      <section className={styles.hero}>
        <Trophy size={80} className={styles.heroIcon} />
        <h1>Hattrick Friendly Tournaments</h1>
        <p className={styles.subtitle}>
          Organize your training tournaments with ease. Support for 120m achievements and standard victory points.
        </p>
        <Button size="lg" onClick={() => navigate('/create')}>
          Create Tournament
        </Button>
      </section>

      <div className={styles.features}>
        <div className={styles.feature}>
          <ShieldCheck size={40} />
          <h3>Simple Admin</h3>
          <p>No accounts needed. Manage everything with a public URL and a password.</p>
        </div>
        <div className={styles.feature}>
          <Users size={40} />
          <h3>Round Robin</h3>
          <p>Automatic schedule generation for any number of teams.</p>
        </div>
        <div className={styles.feature}>
          <Trophy size={40} />
          <h3>Flexible Scoring</h3>
          <p>Choose between 120m training focus or classic competition.</p>
        </div>
      </div>
    </div>
  );
};
