import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trophy, BeerBottle, ArrowClockwise, ArrowsOut } from 'phosphor-react';
import { supabase } from '../../lib/supabase';
import { getFlagUrl } from '../../utils/ht-data';
import { Button } from '../Button/Button';
import styles from './SupportersWall.module.sass';

export interface Supporter {
  id: string;
  name: string;
  team: string;
  country: string;
  flag: string;
  flagUrl?: string | null;
  type: 'founding' | 'pioneer';
  message: React.ReactNode;
  beers?: number;
}

const pioneerCupS1 = {
  '3220516': {
    label: 'Queens of the Pacific Cup 🇬🇺',
    href: '/t/queens-of-the-pacific-cup',
  },
  '3220504': {
    label: 'Queens of the Pacific Cup 🇬🇺',
    href: '/t/queens-of-the-pacific-cup',
  },
  '3220508': {
    label: 'Queens of the Pacific Cup 🇬🇺',
    href: '/t/queens-of-the-pacific-cup',
  },
  '3220514': {
    label: 'Queens of the Pacific Cup 🇬🇺',
    href: '/t/queens-of-the-pacific-cup',
  },
  '3220511': {
    label: 'Queens of the Pacific Cup 🇬🇺',
    href: '/t/queens-of-the-pacific-cup',
  },
  '6319513': {
    label: 'Oops, I Did Extra Time Again',
    href: '/t/oops-i-did-extra-time-again',
  },
  '6282071': {
    label: 'Oops, I Did Extra Time Again',
    href: '/t/oops-i-did-extra-time-again',
  },
  '13458196': {
    label: 'Oops, I Did Extra Time Again',
    href: '/t/oops-i-did-extra-time-again',
  },
} as const;

const MESSAGES = {
  founding: ['Supported HT-120min when it matters most — in the beginning! 🍺💪'],
};

const SUPPORTER_SEEDS = [
  // Existing pioneers
  {
    id: '3220516',
    name: 'CCalm',
    team: 'Tamuning Amazons',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
  },
  {
    id: '3220504',
    name: 'NinoMed',
    team: "'Nduje Amaranto",
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
  },
  {
    id: '3220508',
    name: 'DavidLafata',
    team: 'The princesses of Zermatt',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
  },
  {
    id: '3220514',
    name: 'Spiderland',
    team: 'Challenger Deep FC',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
  },
  {
    id: '3220511',
    name: 'GM-Peter_D',
    team: 'Tottenham Amazons',
    country: 'Guam',
    flag: '🇬🇺',
    type: 'pioneer',
  },

  // Incoming pioneers
  {
    id: '6319513',
    name: 'jisa39',
    team: 'DB lookup',
    country: 'Unknown',
    flag: '🏳️',
    type: 'pioneer',
  },
  {
    id: '6282071',
    name: 'tobi_tob',
    team: 'DB lookup',
    country: 'Unknown',
    flag: '🏳️',
    type: 'pioneer',
  },
  {
    id: '13458196',
    name: 'Unsure',
    team: 'DB lookup',
    country: 'Unknown',
    flag: '🏳️',
    type: 'pioneer',
  },

  // Founding Supporters
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
] as const;

type SupporterLookup = {
  manager_name?: string | null;
  country_name?: string | null;
  country_id?: number | null;
  team_name?: string | null;
};

interface SupportersWallProps {
  variant?: 'compact' | 'full';
}

export const SupportersWall: React.FC<SupportersWallProps> = ({ variant = 'compact' }) => {
  const navigate = useNavigate();
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [lookupById, setLookupById] = useState<Record<string, SupporterLookup>>({});

  useEffect(() => {
    const supportIds = SUPPORTER_SEEDS.map((supporter) => Number(supporter.id)).filter((id) => Number.isFinite(id));
    if (supportIds.length === 0) return;

    const loadSupporters = async () => {
      const [{ data: profilesData }, { data: teamsData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('hattrick_user_id, manager_name, country_name, country_id')
          .in('hattrick_user_id', supportIds),
        supabase.from('teams').select('hattrick_user_id, name').in('hattrick_user_id', supportIds).eq('active', true),
      ]);

      const profileMap = Object.fromEntries(
        (profilesData || []).map((profile) => [
          String(profile.hattrick_user_id),
          {
            manager_name: profile.manager_name,
            country_name: profile.country_name,
            country_id: profile.country_id,
          },
        ]),
      );
      const teamMap = Object.fromEntries(
        (teamsData || []).map((team) => [String(team.hattrick_user_id), { team_name: team.name }]),
      );

      setLookupById(
        SUPPORTER_SEEDS.reduce<Record<string, SupporterLookup>>((acc, supporter) => {
          acc[supporter.id] = {
            ...profileMap[supporter.id],
            ...teamMap[supporter.id],
          };
          return acc;
        }, {}),
      );
    };

    void loadSupporters();
  }, []);

  const renderPioneerMessage = (supporterId: string) => {
    const cup = pioneerCupS1[supporterId as keyof typeof pioneerCupS1];
    if (!cup) return MESSAGES.founding[0];

    return (
      <>
        An honorary pioneer member of HT-120min and participant of{' '}
        <Link to={cup.href} className={styles.cupLink}>
          {cup.label}
        </Link>{' '}
        in Season 1.
      </>
    );
  };

  const displayedSupporters = useMemo(() => {
    const resolvedSupporters = SUPPORTER_SEEDS.map((supporter) => {
      const lookup = lookupById[supporter.id];
      const isPioneer = supporter.type === 'pioneer';

      return {
        ...supporter,
        name: lookup?.manager_name || supporter.name,
        team: lookup?.team_name || supporter.team,
        country: lookup?.country_name || supporter.country,
        flag: lookup?.country_name ? '' : supporter.flag,
        flagUrl: lookup?.country_name ? getFlagUrl(lookup.country_name, lookup.country_id) : null,
        message: isPioneer ? renderPioneerMessage(supporter.id) : supporter.message,
      };
    });

    if (variant === 'full') return resolvedSupporters;

    void shuffleSeed;
    const shuffle = (array: Supporter[]) => [...array].sort(() => Math.random() - 0.5);

    const founding = shuffle(resolvedSupporters.filter((s) => s.type === 'founding')).slice(0, 3);
    const pioneers = shuffle(resolvedSupporters.filter((s) => s.type === 'pioneer')).slice(0, 3);

    return [...founding, ...pioneers];
  }, [lookupById, variant, shuffleSeed]);

  return (
    <div className={`${styles.wallWrapper} ${variant === 'full' ? styles.fullPage : ''}`}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h2>User Hall of Fame</h2>
        </div>
        <p className={styles.intro}>
          Thank you for helping build the project by being an early part of it! When PRO accounts are introduced all
          those on this wall will enjoy a permanent discount!
        </p>
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
                {s.team} {s.flagUrl ? <img src={s.flagUrl} alt="" className={styles.flag} /> : <span>{s.flag}</span>}
              </div>
              <p className={styles.thankYou}>“{s.message}”</p>
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
            <ArrowClockwise size={18} /> Shuffle
          </Button>
          <Button variant="outlineWhite" size="sm" onClick={() => navigate('/supporters')} className={styles.actionBtn}>
            <ArrowsOut size={18} /> Show All
          </Button>
        </div>
      )}
    </div>
  );
};
