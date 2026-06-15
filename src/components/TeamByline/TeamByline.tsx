import React from 'react';
import { Tooltip } from 'react-tooltip';
import { getFlagUrl } from '../../utils/ht-data';
import styles from './TeamByline.module.sass';

interface TeamBylineProps {
  countryName?: string | null;
  countryId?: number | null;
  teamId: number | null;
  managerName?: string | null;
  managerHtId?: number | null;
  mode: 'standings' | 'fixtures';
  isRight?: boolean;
}

export const TeamByline: React.FC<TeamBylineProps> = ({
  countryName,
  countryId,
  teamId,
  managerName,
  managerHtId,
  mode,
  isRight,
}) => {
  // Use a unique ID for tooltips to avoid collisions
  const tooltipIdBase = `byline-${teamId}-${managerHtId}-${mode}-${isRight ? 'r' : 'l'}`;

  const openProfile = (e: React.MouseEvent) => {
    e.preventDefault();
    if (managerHtId) {
      const params = new URLSearchParams(window.location.search);
      params.set('profileId', managerHtId.toString());
      window.history.pushState({}, '', `?${params.toString()}`);
      window.dispatchEvent(new Event('popstate'));
    }
  };

  console.log('🏜💀👾 getFlagUrl(countryName)', getFlagUrl(countryName || undefined));
  console.log('🏜💀👾 countryName', countryName);

  return (
    <div className={`${styles.teamExtraInfo} ${isRight ? styles.right : ''}`}>
      {countryName && (
        <>
          <a
            href={`https://www.hattrick.org/goto.ashx?path=/World/Leagues/League.aspx?LeagueID=${countryId || ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.flagLink}
            data-tooltip-id={`${tooltipIdBase}-flag`}
          >
            <img src={getFlagUrl(countryName || undefined) || ''} alt={countryName} className={styles.flagIcon} />
          </a>
          <Tooltip id={`${tooltipIdBase}-flag`} content={countryName} />
          <span className={styles.separator}>|</span>
        </>
      )}

      <a
        href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.idLink}
        data-tooltip-id={`${tooltipIdBase}-id`}
      >
        ID: {teamId}
      </a>
      <Tooltip id={`${tooltipIdBase}-id`} content="View on Hattrick" />

      <span className={styles.separator}>|</span>

      {mode === 'standings' ? (
        <>
          <button onClick={openProfile} className={styles.managerNameLink} data-tooltip-id={`${tooltipIdBase}-manager`}>
            {managerName || ''}
          </button>
          <Tooltip id={`${tooltipIdBase}-manager`} content="View Profile" className="tooltip" />
        </>
      ) : (
        <>
          <a
            href={`https://www.hattrick.org/goto.ashx?path=/Club/Manager/?UserID=${managerHtId || ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.managerLink}
            data-tooltip-id={`${tooltipIdBase}-manager`}
          >
            {managerName || 'UNKNOWN'}
          </a>
          <Tooltip id={`${tooltipIdBase}-manager`} content="Visit on Hattrick" />
        </>
      )}
    </div>
  );
};
