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
  founding: [
    'Thank you for supporting the project when it mattered the most - at the beginning.',
    'Your contribution helped turn this coffee-fueled idea into a real Hattrick tool.',
    'A true believer in the 120-minute dream. Cheers to you!',
    'One of the very few who saw the potential before anyone else did.',
  ],
  pioneer: [
    'Thank you for being a brave tester of the first ever HT-120min tournament.',
    "An early manager who wasn't afraid of a few bugs to build something great.",
    'Pioneered the 120-minute movement. You were here since day one.',
    'Helped test and refine the tools that managers now use every day.',
  ],
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
    id: '3220518',
    name: 'mr_bots',
    team: 'Guåhan Goddesses',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[1],
  },
  {
    id: '3220504',
    name: 'NinoMed',
    team: "'Nduje Amaranto",
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[2],
  },
  {
    id: '3220508',
    name: 'DavidLafata',
    team: 'The princesses of Zermatt',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
    message: MESSAGES.pioneer[3],
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
    message: MESSAGES.pioneer[1],
  },

  // Founding Supporters (Dummy data)
  {
    id: 'f1',
    name: 'HattrickMaster',
    team: 'The Champions',
    country: 'Sweden',
    flag: '🇸🇪',
    type: 'founding',
    message: MESSAGES.founding[0],
    beers: 3,
  },
  {
    id: 'f2',
    name: 'GoalScorer',
    team: 'Striker United',
    country: 'Italy',
    flag: '🇮🇹',
    type: 'founding',
    message: MESSAGES.founding[1],
    beers: 2,
  },
  {
    id: 'f3',
    name: 'MidfieldGeneral',
    team: 'Tactical Masters',
    country: 'Germany',
    flag: '🇩🇪',
    type: 'founding',
    message: MESSAGES.founding[2],
    beers: 5,
  },
  {
    id: 'f4',
    name: 'DefenseWall',
    team: 'The Fortress',
    country: 'England',
    flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    type: 'founding',
    message: MESSAGES.founding[3],
    beers: 1,
  },
  {
    id: 'f5',
    name: 'CupWinner',
    team: 'Silverware FC',
    country: 'Spain',
    flag: '🇪🇸',
    type: 'founding',
    message: MESSAGES.founding[0],
    beers: 4,
  },
  {
    id: 'f6',
    name: 'Tactician',
    team: 'Brainstorm XI',
    country: 'France',
    flag: '🇫🇷',
    type: 'founding',
    message: MESSAGES.founding[1],
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
        <p className={styles.intro}>{DATA.length} managers helped build HT-120min from the very beginning.</p>
      </div>

      <div className={styles.grid}>
        {displayedSupporters.map((s, idx) => (
          <div
            key={`${s.id}-${idx}`}
            className={`${styles.supporterCard} ${styles[s.type]} ${variant === 'full' ? styles.largeCard : ''}`}
          >
            <div className={styles.badge}>
              {s.type === 'founding' ? <Trophy size={14} weight="bold" /> : <BeerBottle size={14} weight="bold" />}
              {s.type === 'founding' ? 'Founding Manager' : 'Pioneer'}
            </div>
            <div className={styles.cardFrame}>
              <div className={styles.name}>{s.name}</div>
              <div className={styles.team}>
                {s.team} {s.flag}
              </div>
              <p className={styles.thankYou}>"{s.message}"</p>
              {s.beers && (
                <div className={styles.beers}>
                  {Array.from({ length: s.beers }).map((_, i) => (
                    <span key={i} title="Beers contributed">
                      🍺
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {variant === 'compact' && (
        <div className={styles.actions}>
          <Button variant="zero" size="sm" onClick={() => setShuffleSeed((s) => s + 1)} className={styles.actionBtn}>
            <ArrowClockwise size={18} /> Refresh
          </Button>
          <Button variant="zero" size="sm" onClick={() => navigate('/supporters')} className={styles.actionBtn}>
            <ArrowsOut size={18} /> Show All
          </Button>
        </div>
      )}
    </div>
  );
};
