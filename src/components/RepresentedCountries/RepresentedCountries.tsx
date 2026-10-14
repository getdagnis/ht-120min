import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { GlobeHemisphereWest } from 'phosphor-react';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import { getCountryActiveTeamCount } from '../../../shared/country-active-team-counts';
import { HATTRICK_WORLD_DETAILS, getCountryWorldDetails } from '../../../shared/worlddetails';
import { getCountryFlagUrl, getCanonicalCountryName } from '../../utils/ht-data';
import { isCurrentParticipantTeam, type CurrentParticipantTeamState } from '../../utils/team-state';
import styles from './RepresentedCountries.module.sass';

interface Participant extends CurrentParticipantTeamState {
  country_id?: number | null;
  country_name?: string;
  hattrick_user_id?: number;
}

function summarizeRepresentedCountries(teams: Participant[]) {
  const participants = teams.filter(isCurrentParticipantTeam);
  const countries = new Map<string, { label: string; count: number; flag: string | null; leagueId: number | null }>();
  const managers = new Map<number, number>();
  let smallCountryTeams = 0;
  for (const team of participants) {
    const managerId = Number(team.hattrick_user_id);
    if (Number.isSafeInteger(managerId) && managerId > 0) managers.set(managerId, (managers.get(managerId) || 0) + 1);
    const canonicalName = getCanonicalCountryName(team.country_name, team.country_id);
    const country = getCountryWorldDetails(team.country_id)
      ?? Object.values(HATTRICK_WORLD_DETAILS).find((entry) => entry.countryId !== null && entry.fullName === canonicalName);
    const activeTeamCount = getCountryActiveTeamCount(country?.countryId ?? team.country_id);
    if (activeTeamCount !== null && activeTeamCount <= 430) smallCountryTeams++;
    const localName = country?.countryName || team.country_name?.trim();
    if (!localName) continue;
    const englishName = country?.countryNameEn;
    const label = englishName && englishName !== localName ? `${localName} (${englishName})` : localName;
    const key = country ? String(country.countryId) : localName;
    const previous = countries.get(key);
    countries.set(key, {
      label, count: (previous?.count || 0) + 1,
      flag: getCountryFlagUrl(country?.countryId ?? team.country_id, team.country_name),
      leagueId: country?.leagueId ?? null,
    });
  }
  const rows = [...countries.values()];
  return {
    rows,
    teams: participants.length,
    largeCountryTeams: participants.length - smallCountryTeams,
    smallCountryTeams,
    managers: managers.size,
    countries: rows.length,
    singleTeamCountries: rows.filter((row) => row.count === 1).length,
    multiTeamManagers: [...managers.values()].filter((count) => count > 1).length,
  };
}

export function RepresentedCountries({ teams }: { teams: Participant[] }) {
  const t = useTranslations('PublicUI.RepresentedCountries');
  const [sort, setSort] = useState<{ column: 'name' | 'count'; ascending: boolean }>({ column: 'name', ascending: true });
  const summary = summarizeRepresentedCountries(teams);
  const rows = [...summary.rows].sort((a, b) => {
    const comparison = sort.column === 'name' ? a.label.localeCompare(b.label, 'en') : a.count - b.count;
    return (sort.ascending ? comparison : -comparison) || a.label.localeCompare(b.label, 'en');
  });
  const toggleSort = (column: 'name' | 'count') => setSort((current) => ({
    column,
    ascending: current.column === column ? !current.ascending : column === 'name',
  }));
  return (
    <ReusableWidget className={styles.widget} title={`${t('title')} (${summary.countries})`} icon={<GlobeHemisphereWest size={20} weight="bold" />}>
      <table className={styles.countryTable}>
        <thead>
          <tr>
            {(['name', 'count'] as const).map((column) => (
              <th key={column} scope="col" aria-sort={sort.column === column ? (sort.ascending ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => toggleSort(column)}>
                  {t(column === 'name' ? 'countryName' : 'teams')}
                  {sort.column === column && <span aria-hidden="true">{sort.ascending ? ' ↓' : ' ↑'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
        {rows.map((country) => (
          <tr key={country.label}>
            <td>
              <span className={styles.country}>
                {country.flag && <img src={country.flag} alt="" className={styles.flag} />}
                {country.leagueId ? (
                  <a href={`https://www.hattrick.org/goto.ashx?path=/World/Leagues/League.aspx?LeagueID=${country.leagueId}`} target="_blank" rel="noopener noreferrer">
                    {country.label}
                  </a>
                ) : country.label}
              </span>
            </td><td>{country.count}</td>
          </tr>
        ))}
        </tbody>
      </table>
      <dl className={`${styles.list} ${styles.summary}`}>
        {(['teams', 'managers', 'countries', 'singleTeamCountries', 'multiTeamManagers', 'largeCountryTeams', 'smallCountryTeams'] as const).map((key) => (
          <div key={key} className={styles.row}>
            <dt>{t(key)}</dt><dd>{summary[key]}</dd>
          </div>
        ))}
      </dl>
    </ReusableWidget>
  );
}
