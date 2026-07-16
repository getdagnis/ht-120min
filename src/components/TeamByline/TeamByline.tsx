import React from 'react';
import { Tooltip } from 'react-tooltip';
import { getCanonicalCountryName, getCountryFlagUrl, getLeagueFlagUrl, formatPresence } from '../../utils/ht-data';
import styles from './TeamByline.module.sass';

interface TeamBylineProps {
  countryName?: string | null;
  countryId?: number | null;
  leagueId?: number | null;
  teamId: number | null;
  managerName?: string | null;
  managerHtId?: number | null;
  mode: 'standings' | 'fixtures';
  isRight?: boolean;
  lastSeenAt?: string | null;
  matchSummary?: {
    yellowCards: number;
    redCards: number;
    injuries: number;
  } | null;
}

export const TeamByline: React.FC<TeamBylineProps> = ({
  countryName,
  countryId,
  leagueId,
  teamId,
  managerName,
  managerHtId,
  mode,
  isRight,
  lastSeenAt,
  matchSummary,
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

  const displayCountryName = getCanonicalCountryName(countryName, countryId);
  const countryFlagUrl = getCountryFlagUrl(countryId, displayCountryName);
  const leagueFlagUrl = getLeagueFlagUrl(leagueId);
  const presence = lastSeenAt !== undefined ? formatPresence(lastSeenAt) : null;
  const summary =
    matchSummary && (matchSummary.yellowCards > 0 || matchSummary.redCards > 0 || matchSummary.injuries > 0)
      ? matchSummary
      : null;
  const summaryTooltipParts = summary
    ? [
        summary.yellowCards ? `${summary.yellowCards} yellow card${summary.yellowCards === 1 ? '' : 's'}` : '',
        summary.redCards ? `${summary.redCards} red card${summary.redCards === 1 ? '' : 's'}` : '',
        summary.injuries ? `${summary.injuries} injur${summary.injuries === 1 ? 'y' : 'ies'}` : '',
      ].filter(Boolean)
    : [];
  const summaryTooltip = summaryTooltipParts.join(', ');

  const repeatIcons = (src: string, alt: string, count: number, tooltip: string) =>
    Array.from({ length: count }, (_, index) => (
      <img
        key={`${src}-${index}`}
        src={src}
        alt={alt}
        className={styles.summaryIcon}
        data-tooltip-id={`${tooltipIdBase}-summary`}
        data-tooltip-content={tooltip}
      />
    ));

  return (
    <div className={`${styles.teamExtraInfo} ${isRight ? styles.right : ''}`}>
      <div className={styles.metaRow}>
        {(countryFlagUrl || leagueFlagUrl) && (
          <>
            {leagueFlagUrl && <img src={leagueFlagUrl} alt="League" className={styles.flagIcon} />}
            {countryFlagUrl && <img src={countryFlagUrl} alt={displayCountryName || 'Country'} className={styles.flagIcon} />}
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
        <Tooltip id={`${tooltipIdBase}-id`} content="View on Hattrick" className="tooltip" />

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
            <Tooltip id={`${tooltipIdBase}-manager`} content="Visit on Hattrick" className="tooltip" />
          </>
        )}
        {presence && (
          <>
            <span className={styles.separator}>|</span>
            <span
              className={`${styles.presenceDot} ${styles[`presence_${presence.color}`]}`}
              data-tooltip-id={`${tooltipIdBase}-presence`}
              aria-label={presence.tooltip}
            >
              {presence.online ? '●' : presence.label}
            </span>
            <Tooltip id={`${tooltipIdBase}-presence`} content={presence.tooltip} className="tooltip" />
          </>
        )}
      </div>
      {mode === 'fixtures' && summary && (
        <div className={styles.summaryRow} data-tooltip-id={`${tooltipIdBase}-summary`} aria-label={summaryTooltip}>
          {repeatIcons('/svg/match-yellow.svg', 'Yellow card', summary.yellowCards, 'Yellow card')}
          {repeatIcons('/svg/match-card.svg', 'Red card', summary.redCards, 'Red card')}
          {repeatIcons('/svg/match-cross.svg', 'Injury', summary.injuries, 'Injury')}
          <Tooltip id={`${tooltipIdBase}-summary`} content={summaryTooltip} className="tooltip" />
        </div>
      )}
    </div>
  );
};
