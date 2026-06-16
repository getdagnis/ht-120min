import React from 'react';
import { Trophy, BeerBottle, Flask } from 'phosphor-react';
import styles from './SupportersWall.module.sass';

interface Supporter {
  id: string;
  name: string;
  team: string;
  country: string;
  flag: string;
  joined: string;
  beers?: number;
  type: 'founding' | 'pioneer';
  firstTour?: string;
}

const SUPPORTERS: Supporter[] = [
  {
    id: '1',
    name: 'mr_bots',
    team: 'FC Testing United',
    country: 'Latvia',
    flag: '🇱🇻',
    joined: 'Season 92',
    beers: 3,
    type: 'founding',
  },
  {
    id: '2',
    name: 'Dagnis',
    team: 'Guåhan Goddesses',
    country: 'Guam',
    flag: '🇬🇺',
    joined: 'Season 92',
    beers: 2,
    type: 'founding',
  },
  {
    id: '3',
    name: 'EarlyBird',
    team: 'Pioneer XI',
    country: 'Sweden',
    flag: '🇸🇪',
    joined: 'Season 92',
    firstTour: 'First 120min Cup',
    type: 'pioneer',
  },
];

export const SupportersWall: React.FC = () => {
  const founding = SUPPORTERS.filter((s) => s.type === 'founding');
  const pioneers = SUPPORTERS.filter((s) => s.type === 'pioneer');

  return (
    <div className={styles.wallWrapper}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <Trophy size={28} className={styles.mainIcon} />
          <h2>Supporters Wall</h2>
        </div>
        <p className={styles.intro}>37 managers helped build HT-120min from the very beginning.</p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <BeerBottle size={20} weight="fill" />
          <h3>Founding Managers</h3>
        </div>
        <div className={styles.grid}>
          {founding.map((s) => (
            <div key={s.id} className={`${styles.supporterCard} ${styles.founding}`}>
              <div className={styles.cardFrame}>
                <div className={styles.badge}>
                  <Trophy size={14} weight="bold" />
                  Founding Manager
                </div>
                <div className={styles.name}>{s.name}</div>
                <div className={styles.team}>
                  {s.team} {s.flag}
                </div>
                <div className={styles.meta}>Joined {s.joined}</div>
                {s.beers && (
                  <div className={styles.beers}>
                    {Array.from({ length: s.beers }).map((_, i) => (
                      <span key={i}>🍺</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          <Flask size={20} weight="fill" />
          <h3>Pioneers</h3>
        </div>
        <div className={styles.grid}>
          {pioneers.map((s) => (
            <div key={s.id} className={`${styles.supporterCard} ${styles.pioneer}`}>
              <div className={styles.cardFrame}>
                <div className={styles.badge}>Pioneer</div>
                <div className={styles.name}>{s.name}</div>
                <div className={styles.team}>
                  {s.team} {s.flag}
                </div>
                <div className={styles.meta}>First: {s.firstTour}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
