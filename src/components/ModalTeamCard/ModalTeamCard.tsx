import React from 'react';
import { CaretRight } from 'phosphor-react';
import { getCanonicalCountryName } from '../../utils/ht-data';
import { getCountryWorldDetails, getLeagueWorldDetails } from '../../../shared/worlddetails';
import styles from './ModalTeamCard.module.sass';

const DEFAULT_TEAM_LOGO = '/default-logo.png';

export interface ModalTeamCardTeam {
  teamId: number;
  teamName: string;
  logoUrl?: string | null;
  countryId?: number | null;
  countryName?: string | null;
  leagueId?: number | null;
  leagueName?: string | null;
}

interface ModalTeamCardProps {
  team: ModalTeamCardTeam;
  status: React.ReactNode;
  statusDanger?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
}

/** A single team presentation for dark modal surfaces, including Tinder. */
export const ModalTeamCard: React.FC<ModalTeamCardProps> = ({
  team,
  status,
  statusDanger = false,
  onSelect,
  disabled = false,
  className = '',
}) => {
  const league = getLeagueWorldDetails(team.leagueId);
  const country = getCountryWorldDetails(team.countryId);
  const leagueName = league?.leagueName ?? team.leagueName ?? 'Unknown league';
  const countryName = getCanonicalCountryName(team.countryName, team.countryId) ?? team.countryName ?? 'Unknown country';
  const leagueEmoji = league?.emoji ?? '⚽';
  const countryEmoji = country?.emoji ?? '🏳️';
  const leagueAndCountryMatch =
    (league?.countryId !== null && league?.countryId !== undefined && league.countryId === team.countryId) ||
    leagueName.trim().toLocaleLowerCase() === countryName.trim().toLocaleLowerCase();
  const content = (
    <>
      <img
        src={team.logoUrl || DEFAULT_TEAM_LOGO}
        alt=""
        className={styles.logo}
        onError={(event) => {
          event.currentTarget.onerror = null;
          event.currentTarget.src = DEFAULT_TEAM_LOGO;
        }}
      />
      <div className={styles.content}>
        <strong className={styles.name}>{team.teamName}</strong>
        <span className={styles.byline}>
          {leagueEmoji} {leagueName}
          {!leagueAndCountryMatch && <> <span className={styles.separator}>|</span> {countryEmoji} {countryName}</>}
          <span className={styles.separator}>|</span> ID: {team.teamId}
        </span>
        <div className={`${styles.status} ${statusDanger ? styles.statusDanger : ''}`}>{status}</div>
      </div>
      {onSelect && <CaretRight size={28} weight="bold" className={styles.caret} aria-hidden="true" />}
    </>
  );

  const tone = disabled ? styles.disabled : onSelect ? styles.eligible : '';
  const classNames = [styles.card, tone, className].filter(Boolean).join(' ');

  if (onSelect) {
    return (
      <button type="button" className={classNames} onClick={onSelect} disabled={disabled}>
        {content}
      </button>
    );
  }

  return <article className={classNames}>{content}</article>;
};
