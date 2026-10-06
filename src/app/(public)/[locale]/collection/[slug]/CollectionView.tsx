'use client';

import Link from 'next/link';
import { TournamentCard } from '../../../../../components/Card/TournamentCard';
import { TournamentCardContent } from '../../../../../components/Card/TournamentCardContent';
import { ReusableWidget } from '../../../../../components/ReusableWidget/ReusableWidget';
import { collectionPageGroups, compareCollectionMemberActivity, type PublicCollection } from '../../../../../utils/tournament-collections';
import type { HomeTournament } from '../../../../../server/api/_lib/home-snapshot-builder';
import { toLocalePath } from '../../../../../next/locale-path';
import styles from './CollectionPage.module.sass';

const groups = [
  ['featured', 'Featured tournaments'],
  ['in-progress', 'In progress'],
  ['registration-open', 'Registration open'],
  ['upcoming', 'Upcoming'],
  ['inactive', 'Inactive'],
  ['completed', 'Completed'],
] as const;

export function CollectionView({ collection, locale }: { collection: PublicCollection<HomeTournament>; locale: string }) {
  const members = [...collection.members].sort((a, b) =>
    compareCollectionMemberActivity(a, b));
  const totalTeams = members.reduce((sum, member) => sum + member.tournament.teamCount, 0);
  const totalMatches = members.reduce((sum, member) => sum + member.tournament.completedMatches, 0);
  return <main className={styles.container}>
    {collection.bannerUrl && <img className={styles.banner} src={collection.bannerUrl} alt={collection.title} />}
    <h1 className={collection.bannerUrl ? styles.visuallyHidden : undefined}>{collection.title}</h1>
    <div className={styles.grid}>
      <div className={styles.mainColumn}>
        {members.length === 0 && <p className={styles.empty}>No public tournaments are available in this collection yet.</p>}
        {groups.map(([group, label]) => {
          const selected = members.filter((member) => collectionPageGroups(member).includes(group));
          if (!selected.length) return null;
          return <section key={group} className={styles.section}>
            <h2>{label}</h2>
            <div className={styles.cards}>{selected.map(({ tournament }) =>
              <Link key={tournament.id} className={styles.cardLink} href={toLocalePath(locale, `/t/${tournament.slug}`)}>
                <TournamentCard id={tournament.id}
                  imageUrl={tournament.image_url} countryLimit={tournament.country_limit}
                  countryLimitFormat={tournament.country_limit_format}
                  scoringMode={tournament.scoring_mode} leagueCategory={tournament.league_category}>
                  <TournamentCardContent tournament={tournament} />
                </TournamentCard>
              </Link>)}</div>
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
