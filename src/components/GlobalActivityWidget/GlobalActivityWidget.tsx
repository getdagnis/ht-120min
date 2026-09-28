'use client';

import React, { useEffect, useState } from 'react';
import { Activity } from 'phosphor-react';
import { supabase } from '../../lib/supabase';
import { toLocalePath } from '../../next/locale-path';
import { formatTournamentName } from '../../utils/tournament-names';
import type { HomeActivityEntry } from '../../app/_data/public-data';
import styles from './GlobalActivityWidget.module.sass';

interface GlobalActivityWidgetProps {
  initialEntries: HomeActivityEntry[];
  locale: string;
}

interface RoundReportInsert {
  id: string;
  tournament_id: string;
  season_number: number | null;
  round_number: number | null;
  created_at: string;
  is_round_report?: boolean;
}

interface PublicTournamentRow {
  id: string;
  name: string;
  slug: string;
  country_limit: string | number | null;
  league_category: string | null;
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function formatActivityDay(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString('lv-LV', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function activityDayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function openManagerProfile(event: React.MouseEvent<HTMLAnchorElement>, managerHtId: number) {
  event.preventDefault();
  const params = new URLSearchParams(window.location.search);
  params.set('profileId', managerHtId.toString());
  window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
  window.dispatchEvent(new Event('popstate'));
}

function activityCopy(entry: HomeActivityEntry, locale: string) {
  const tournamentHref = toLocalePath(locale, `/t/${entry.tournament_slug}`);
  const newsHref = toLocalePath(locale, `/t/${entry.tournament_slug}?tab=news`);
  const tournament = <a href={tournamentHref}>{entry.tournament_display_name}</a>;

  if (entry.type === 'join') {
    const manager = entry.manager_name ? (
      entry.manager_ht_id ? (
        <a
          href={`${toLocalePath(locale, '/')}?profileId=${entry.manager_ht_id}`}
          onClick={(event) => openManagerProfile(event, entry.manager_ht_id!)}
        >
          {entry.manager_name}
        </a>
      ) : (
        entry.manager_name
      )
    ) : (
      'A new team'
    );
    const team = entry.team_name ? (
      entry.team_ht_id ? (
        <a
          href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${entry.team_ht_id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {entry.team_name}
        </a>
      ) : (
        entry.team_name
      )
    ) : null;

    return (
      <>
        {team || manager}
        {/* {entry.team_flag ? ` ${entry.team_flag}` : ''} */}
        {team && manager ? ' led by ' : ''}
        {team ? manager : null}
        {entry.manager_flag ? ` ${entry.manager_flag}` : ''} {team ? 'have' : 'joined'} {team ? 'joined ' : ''}
        {tournament}
      </>
    );
  }
  if (entry.type === 'season-start')
    return (
      <>
        {tournament} has just started Season {entry.season_number || 1}.
      </>
    );
  if (entry.type === 'round-start')
    return (
      <>
        {tournament} Round {entry.round_number} matches are being played.
      </>
    );
  if (entry.type === 'round-finish')
    return (
      <>
        {tournament} Round {entry.round_number} matches have finished.
      </>
    );
  return (
    <>
      {tournament} Round {entry.round_number} <a href={newsHref}>press report has been published.</a>
    </>
  );
}

export const GlobalActivityWidget: React.FC<GlobalActivityWidgetProps> = ({ initialEntries, locale }) => {
  const [entries, setEntries] = useState(initialEntries);

  useEffect(() => {
    const channel = supabase
      .channel('global-tournament-activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'news_posts', filter: 'is_round_report=eq.true' },
        async (payload) => {
          const report = payload.new as RoundReportInsert;
          if (
            !report.id ||
            !report.is_round_report ||
            !report.round_number ||
            Date.parse(report.created_at) < Date.now() - WINDOW_MS
          )
            return;

          const { data: tournament } = await supabase
            .from('tournaments')
            .select('id, name, slug, country_limit, league_category, is_private, is_test, is_archived, status, season')
            .eq('id', report.tournament_id)
            .maybeSingle();
          const publicTournament = tournament as
            | (PublicTournamentRow & {
                is_private?: boolean;
                is_test?: boolean;
                is_archived?: boolean;
                status?: string;
                season?: number;
              })
            | null;
          if (
            !publicTournament ||
            publicTournament.is_private ||
            publicTournament.is_test ||
            publicTournament.is_archived ||
            publicTournament.status === 'stopped' ||
            publicTournament.status === 'archived'
          )
            return;
          if (
            report.season_number !== null &&
            publicTournament.season !== undefined &&
            report.season_number !== publicTournament.season
          )
            return;

          setEntries((current) => {
            const next: HomeActivityEntry = {
              id: `round-report:${report.id}`,
              type: 'round-report',
              occurred_at: report.created_at,
              tournament_id: report.tournament_id,
              tournament_slug: publicTournament.slug,
              tournament_name: publicTournament.name,
              tournament_display_name: formatTournamentName(publicTournament.name, {
                countryLimit: publicTournament.country_limit,
                includeCountryFlag: true,
              }),
              round_number: report.round_number || undefined,
              report_id: report.id,
            };
            return [next, ...current.filter((entry) => entry.id !== next.id)]
              .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
              .slice(0, 7);
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  if (entries.length === 0) return null;

  const groupedEntries = entries.reduce<Array<{ key: string; date: string; entries: HomeActivityEntry[] }>>(
    (groups, entry) => {
      const key = activityDayKey(entry.occurred_at);
      const existingGroup = groups[groups.length - 1];
      if (existingGroup?.key === key) {
        existingGroup.entries.push(entry);
      } else {
        groups.push({ key, date: entry.occurred_at, entries: [entry] });
      }
      return groups;
    },
    [],
  );

  return (
    <section className={styles.widget} aria-labelledby="global-activity-title">
      <h2 id="global-activity-title" className={styles.header}>
        <Activity size={20} weight="bold" aria-hidden="true" />
        <span>HT-120min latest activity</span>
      </h2>
      <ul className={styles.entries}>
        {groupedEntries.map((group) => (
          <React.Fragment key={group.key}>
            <li className={styles.dateGroup}>
              <time dateTime={group.date}>{formatActivityDay(group.date)}</time>
            </li>
            {group.entries.map((entry) => (
              <li key={entry.id} className={styles.entry}>
                <p>{activityCopy(entry, locale)}</p>
              </li>
            ))}
          </React.Fragment>
        ))}
      </ul>
    </section>
  );
};
