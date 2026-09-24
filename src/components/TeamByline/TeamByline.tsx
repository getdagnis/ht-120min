import React from 'react';
import { Tooltip } from '../Tooltip/Tooltip';
import { getCanonicalCountryName, getCountryFlagUrl, getLeagueFlagUrl, formatPresence } from '../../utils/ht-data';
import {
  getCardEventLabel,
  getInjuryEventLabel,
  getCanonicalEventDescription,
  type MatchSideEventDetails,
} from '../../../shared/match-events';
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
    eventDetails?: MatchSideEventDetails | null;
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
  const eventDetails = matchSummary?.eventDetails ?? null;
  const detailedCards = eventDetails?.cards ?? [];
  const detailedInjuries = eventDetails?.injuries ?? [];
  const detailedGoals = (eventDetails?.goals ?? []).filter((goal) => goal.category !== 'penalty_shootout');
  const hasDetailedEvents = detailedCards.length > 0 || detailedInjuries.length > 0;
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

  const formatEventTooltip = (minute: number | null, label: string) => (minute === null ? label : `${minute}' - ${label}`);
  const eventMinute = (minute: number | null) => (minute === null ? '' : ` (${minute}')`);
  const playerLabel = (playerName: string | null | undefined) => playerName || 'Player';
  const shortPlayerLabel = (playerName: string | null | undefined) => {
    const name = playerLabel(playerName);
    if (name === 'Player') return name;
    const parts = name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts[0]?.[0]}. ${parts[parts.length - 1]}` : name;
  };
  const goalDescription = (goal: NonNullable<MatchSideEventDetails['goals']>[number]) => {
    let description = goal.description || getCanonicalEventDescription(goal.eventTypeId);
    if (goal.category === 'regular') {
      const location = goal.eventTypeId % 10;
      const side = location === 1 ? 'Centre Attack' : location === 2 ? 'Left Attack' : location === 3 ? 'Right Attack' : null;
      description = side ? `${side} regular goal` : `${description} regular goal`;
    }
    return goal.minute === null ? description : `${goal.minute}' - ${description}`;
  };
  const groupedGoals = detailedGoals.reduce<Array<{ key: string; playerName: string | null; minutes: number[]; descriptions: string[] }>>((groups, goal) => {
    const key = String(goal.playerId ?? goal.playerName ?? 'unknown');
    const group = groups.find((item) => item.key === key);
    if (group) {
      if (goal.minute !== null) group.minutes.push(goal.minute);
      group.descriptions.push(goalDescription(goal));
    } else {
      groups.push({
        key,
        playerName: goal.playerName ?? null,
        minutes: goal.minute === null ? [] : [goal.minute],
        descriptions: [goalDescription(goal)],
      });
    }
    return groups;
  }, []);
  const groupedCards = detailedCards.reduce<Array<{ key: string; playerName: string | null; cards: typeof detailedCards }>>((groups, card) => {
    const key = String(card.playerId ?? card.playerName ?? `unknown-${card.minute ?? 'time'}`);
    const group = groups.find((item) => item.key === key);
    if (group) group.cards.push(card);
    else groups.push({ key, playerName: card.playerName ?? null, cards: [card] });
    return groups;
  }, []);

  const detailedEventIcons = hasDetailedEvents ? (
    <>
      {groupedCards.map((group) => {
        const hasSecondYellowRed = group.cards.some((item) => item.type === 'second_yellow_red');
        const hasStraightRed = group.cards.some((item) => item.type === 'straight_red');
        const tooltip = group.cards.map((item) => formatEventTooltip(item.minute, getCardEventLabel(item))).join(', ');
        const minutes = group.cards
          .map((item) => item.minute)
          .filter((minute): minute is number => minute !== null)
          .map((minute) => `${minute}'`)
          .join(', ');

        if (hasSecondYellowRed) {
          return (
            <span key={group.key} className={styles.eventItem} data-tooltip-id={`${tooltipIdBase}-summary`} data-tooltip-content={tooltip}>
              <span className={styles.secondYellowRed} aria-hidden="true">
                <img src="/svg/match-yellow.svg" alt="" className={styles.summaryIcon} />
                <img src="/svg/match-card.svg" alt="" className={`${styles.summaryIcon} ${styles.redOverlay}`} />
              </span>
              <span className={styles.eventLabel}>{shortPlayerLabel(group.playerName)}{minutes ? ` (${minutes})` : ''}</span>
            </span>
          );
        }

        return (
          <span
            key={group.key}
            className={styles.eventItem}
            data-tooltip-id={`${tooltipIdBase}-summary`}
            data-tooltip-content={tooltip}
          >
            <img src={hasStraightRed ? '/svg/match-card.svg' : '/svg/match-yellow.svg'} alt="" className={styles.summaryIcon} />
            <span className={styles.eventLabel}>{shortPlayerLabel(group.playerName)}{minutes ? ` (${minutes})` : ''}</span>
          </span>
        );
      })}
      {detailedInjuries.map((injury, index) => (
        <span
          key={`injury-${injury.playerId ?? 'unknown'}-${injury.minute ?? index}-${index}`}
          className={styles.eventItem}
          data-tooltip-id={`${tooltipIdBase}-summary`}
          data-tooltip-content={formatEventTooltip(injury.minute, getInjuryEventLabel(injury))}
        >
          <img src={injury.severity === 'plaster' ? '/svg/plaster.svg' : '/svg/match-cross.svg'} alt="" className={styles.summaryIcon} />
          <span className={styles.eventLabel}>
            {injury.weeks ? `+${injury.weeks} ` : ''}{shortPlayerLabel(injury.playerName)}{eventMinute(injury.minute)}
          </span>
        </span>
      ))}
    </>
  ) : null;

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
              {presence.online ? '✔︎' : presence.label}
            </span>
            <Tooltip id={`${tooltipIdBase}-presence`} content={presence.tooltip} className="tooltip" />
          </>
        )}
      </div>
      {mode === 'fixtures' && groupedGoals.length > 0 && (
        <div className={styles.goalsRow} aria-label="Goals">
          {groupedGoals.map((goal) => (
            <React.Fragment key={goal.key}>
              <span
                className={styles.goalItem}
                data-tooltip-id={`${tooltipIdBase}-goal-${goal.key}`}
                data-tooltip-content={Array.from(new Set(goal.descriptions)).join(', ')}
              >
                <span aria-hidden="true">⚽️</span> {shortPlayerLabel(goal.playerName)}
                {goal.minutes.length > 0 && ` (${goal.minutes.map((minute) => `${minute}'`).join(', ')})`}
              </span>
              <Tooltip
                id={`${tooltipIdBase}-goal-${goal.key}`}
                content={Array.from(new Set(goal.descriptions)).join(', ')}
                className="tooltip"
              />
            </React.Fragment>
          ))}
        </div>
      )}
      {mode === 'fixtures' && summary && (
        <div className={styles.summaryRow} data-tooltip-id={`${tooltipIdBase}-summary`} aria-label={summaryTooltip}>
          {detailedEventIcons || (
            <>
              {repeatIcons('/svg/match-yellow.svg', 'Yellow card', summary.yellowCards, 'Yellow card')}
              {repeatIcons('/svg/match-card.svg', 'Red card', summary.redCards, 'Red card')}
              {repeatIcons('/svg/match-cross.svg', 'Injury', summary.injuries, 'Injury')}
            </>
          )}
          {hasDetailedEvents ? (
            <Tooltip id={`${tooltipIdBase}-summary`} className="tooltip" />
          ) : (
            <Tooltip id={`${tooltipIdBase}-summary`} content={summaryTooltip} className="tooltip" />
          )}
        </div>
      )}
    </div>
  );
};
