'use client';

import Link from 'next/link';
import { TournamentCard } from '../../../../../components/Card/TournamentCard';
import { ReusableWidget } from '../../../../../components/ReusableWidget/ReusableWidget';
import { collectionGroup, type PublicCollection } from '../../../../../utils/tournament-collections';
import type { HomeTournament } from '../../../../../server/api/_lib/home-snapshot-builder';
import { toLocalePath } from '../../../../../next/locale-path';
import styles from './CollectionPage.module.sass';

const groups = [
  ['registration-open', 'Registration open'],
  ['in-progress', 'In progress'],
  ['upcoming', 'Upcoming'],
  ['completed', 'Completed'],
] as const;

export function CollectionView({ collection, locale }: { collection: PublicCollection<HomeTournament>; locale: string }) {
  const members = [...collection.members].sort((a, b) =>
    a.displayOrder - b.displayOrder || a.tournament.slug.localeCompare(b.tournament.slug));
  const totalTeams = members.reduce((sum, member) => sum + member.tournament.teamCount, 0);
  const totalMatches = members.reduce((sum, member) => sum + member.tournament.completedMatches, 0);
  return <main className={styles.container}>
    {collection.bannerUrl && <img className={styles.banner} src={collection.bannerUrl} alt={collection.title} />}
    <h1 className={collection.bannerUrl ? styles.visuallyHidden : undefined}>{collection.title}</h1>
    <div className={styles.grid}>
      <div className={styles.mainColumn}>
        {members.length === 0 && <p className={styles.empty}>No public tournaments are available in this collection yet.</p>}
        {groups.map(([group, label]) => {
          const selected = members.filter((member) => collectionGroup(member.tournament) === group);
          if (!selected.length) return null;
          return <section key={group} className={styles.section}>
            <h2>{label}</h2>
            <div className={styles.cards}>{selected.map(({ tournament }) =>
              <TournamentCard key={tournament.id} id={tournament.id}
                imageUrl={tournament.image_url} countryLimit={tournament.country_limit}
                countryLimitFormat={tournament.country_limit_format}
                scoringMode={tournament.scoring_mode} leagueCategory={tournament.league_category}>
                <Link className={styles.cardLink} href={toLocalePath(locale, `/t/${tournament.slug}`)}>
                  <strong>{tournament.name}</strong>
                  <span>Season {tournament.season} · {tournament.teamCount} teams</span>
                </Link>
              </TournamentCard>)}</div>
          </section>;
        })}
      </div>
      <aside className={styles.sidebar}>
        <ReusableWidget title="About this collection" icon={<span aria-hidden="true">🏆</span>}>
          <p>{collection.description}</p>
        </ReusableWidget>
        <ReusableWidget title="At a glance" icon={<span aria-hidden="true">✓</span>}>
          <ul className={styles.totals}>
            <li>{members.length} tournaments</li>
            <li>{totalTeams} current teams</li>
            <li>{totalMatches} completed matches</li>
          </ul>
        </ReusableWidget>
      </aside>
    </div>
  </main>;
}
