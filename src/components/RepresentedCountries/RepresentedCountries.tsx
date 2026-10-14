import { useTranslations } from 'next-intl';
import { GlobeHemisphereWest } from 'phosphor-react';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import { HATTRICK_WORLD_DETAILS, getCountryWorldDetails } from '../../../shared/worlddetails';
import { getCountryFlagUrl, getCanonicalCountryName } from '../../utils/ht-data';
import { isCurrentParticipantTeam, type CurrentParticipantTeamState } from '../../utils/team-state';
import styles from './RepresentedCountries.module.sass';

interface Participant extends CurrentParticipantTeamState {
  country_id?: number | null;
  country_name?: string;
  hattrick_user_id?: number;
}

export function summarizeRepresentedCountries(teams: Participant[]) {
  const participants = teams.filter(isCurrentParticipantTeam);
  const countries = new Map<string, { label: string; count: number; flag: string | null; leagueId: number | null }>();
  const managers = new Map<number, number>();
  for (const team of participants) {
    const managerId = Number(team.hattrick_user_id);
    if (Number.isSafeInteger(managerId) && managerId > 0) managers.set(managerId, (managers.get(managerId) || 0) + 1);
    const canonicalName = getCanonicalCountryName(team.country_name, team.country_id);
    const country = getCountryWorldDetails(team.country_id)
      ?? Object.values(HATTRICK_WORLD_DETAILS).find((entry) => entry.countryId !== null && entry.fullName === canonicalName);
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
  const rows = [...countries.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
  return {
    rows,
    teams: participants.length,
    managers: managers.size,
    countries: rows.length,
    singleTeamCountries: rows.filter((row) => row.count === 1).length,
    multiTeamManagers: [...managers.values()].filter((count) => count > 1).length,
  };
}

export function RepresentedCountries({ teams }: { teams: Participant[] }) {
  const t = useTranslations('PublicUI.RepresentedCountries');
  const summary = summarizeRepresentedCountries(teams);
  return (
    <ReusableWidget className={styles.widget} title={`${t('title')} (${summary.countries})`} icon={<GlobeHemisphereWest size={20} weight="bold" />}>
      <dl className={styles.list}>
        {summary.rows.map((country) => (
          <div key={country.label} className={styles.row}>
            <dt>
              <span className={styles.country}>
                {country.flag && <img src={country.flag} alt="" className={styles.flag} />}
                {country.leagueId ? (
                  <a href={`https://www.hattrick.org/goto.ashx?path=/World/Leagues/League.aspx?LeagueID=${country.leagueId}`} target="_blank" rel="noopener noreferrer">
                    {country.label}
                  </a>
                ) : country.label}
              </span>
            </dt><dd>{country.count}</dd>
          </div>
        ))}
      </dl>
      <dl className={`${styles.list} ${styles.summary}`}>
        {(['teams', 'managers', 'countries', 'singleTeamCountries', 'multiTeamManagers'] as const).map((key) => (
          <div key={key} className={styles.row}>
            <dt>{t(key)}</dt><dd>{summary[key]}</dd>
          </div>
        ))}
      </dl>
    </ReusableWidget>
  );
}
