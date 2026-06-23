import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, BeerBottle, ArrowClockwise, ArrowsOut } from 'phosphor-react';
import { Button } from '../Button/Button';
import styles from './SupportersWall.module.sass';

export interface Supporter {
  id: string;
  name: string;
  team: string;
  country: string;
  flag: string;
  type: 'founding' | 'pioneer';
  message: string;
  beers?: number;
}

const MESSAGES = {
  founding: ['Supported HT-120min when it matters most — in the beginning! 🍺💪'],
  pioneer: ['Thank you for helping build the project by being an early part of it!'],
};

const DATA: Supporter[] = [
  // Pioneers (Actual data provided)
  {
    id: '3220516',
    name: 'CCalm',
    team: 'Tamuning Amazons',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[0],
  },
  {
    id: '3220504',
    name: 'NinoMed',
    team: "'Nduje Amaranto",
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[0],
  },
  {
    id: '3220508',
    name: 'DavidLafata',
    team: 'The princesses of Zermatt',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[0],
  },
  {
    id: '3220514',
    name: 'Spiderland',
    team: 'Challenger Deep FC',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[0],
  },
  {
    id: '3220511',
    name: 'GM-Peter_D',
    team: 'Tottenham Amazons',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[0],
  },

  // Founding Supporters (Dummy data)
  {
    id: 'f1',
    name: 'AntiFragole',
    team: 'SC Strikers Unlimited',
    country: 'Italy',
    flag: '🇮🇹',
    type: 'founding',
    message: MESSAGES.founding[0],
    beers: 2,
  },
];

interface SupportersWallProps {
  variant?: 'compact' | 'full';
}

export const SupportersWall: React.FC<SupportersWallProps> = ({ variant = 'compact' }) => {
  const navigate = useNavigate();
  const [shuffleSeed, setShuffleSeed] = useState(0);

  const displayedSupporters = useMemo(() => {
    if (variant === 'full') return DATA;

    void shuffleSeed;
    const shuffle = (array: Supporter[]) => [...array].sort(() => Math.random() - 0.5);

    const founding = shuffle(DATA.filter((s) => s.type === 'founding')).slice(0, 3);
    const pioneers = shuffle(DATA.filter((s) => s.type === 'pioneer')).slice(0, 3);

    return [...founding, ...pioneers];
  }, [variant, shuffleSeed]);

  return (
    <div className={`${styles.wallWrapper} ${variant === 'full' ? styles.fullPage : ''}`}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <Trophy size={28} className={styles.mainIcon} />
          <h2>Supporters Wall</h2>
        </div>
        <p className={styles.intro}>Big thanks to the {DATA.length} managers so far who have helped build HT-120min!</p>
      </div>

      <div className={styles.grid}>
        {displayedSupporters.map((s, idx) => (
          <div
            key={`${s.id}-${shuffleSeed}`}
            className={`${styles.supporterCard} ${styles[s.type]} ${variant === 'full' ? styles.largeCard : ''}`}
            style={{ animationDelay: `${idx * 0.1}s` }}
          >
            <div className={styles.badge}>
              {s.type === 'founding' ? <Trophy size={14} weight="bold" /> : <BeerBottle size={14} weight="bold" />}
              {s.type === 'founding' ? 'Early Supporter' : 'Pioneer User'}
            </div>
            <div className={styles.cardFrame}>
              <div className={styles.name}>{s.name}</div>
              <div className={styles.team}>
                {s.team} {s.flag}
              </div>
              <p className={styles.thankYou}>"{s.message}"</p>
            </div>
          </div>
        ))}
      </div>

      {variant === 'compact' && (
        <div className={styles.actions}>
          <Button
            variant="outlineWhite"
            size="sm"
            onClick={() => setShuffleSeed((s) => s + 1)}
            className={styles.actionBtn}
          >
            <ArrowClockwise size={18} /> Refresh
          </Button>
          <Button variant="outlineWhite" size="sm" onClick={() => navigate('/supporters')} className={styles.actionBtn}>
            <ArrowsOut size={18} /> Show All
          </Button>
        </div>
      )}
    </div>
  );
};
