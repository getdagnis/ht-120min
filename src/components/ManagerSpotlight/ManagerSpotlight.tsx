import React from 'react';
import { UsersThree } from 'phosphor-react';

import { Avatar } from '../Avatar/Avatar';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import { getLeagueFlagUrl } from '../../utils/ht-data';
import {
  countryFlagUrl,
  countryLabel,
  getClubRankLabel,
  getFoundedYearLabel,
  getSpecialLeagueLabel,
  getVisibleClubTeams,
  type CountryMention,
  type ManagerSpotlight as ManagerSpotlightViewModel,
  type StorySegment,
  type StorySentence,
} from '../../utils/manager-spotlight';
import type { CountryRestrictionFormat } from '../../../shared/worlddetails';
import styles from './ManagerSpotlight.module.sass';

const managerHref = (managerId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${managerId}`;
const teamHref = (teamId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;

const CountryFlag: React.FC<{ countryId: number | null; countryName: string }> = ({ countryId, countryName }) => {
  const flag = countryFlagUrl(countryId, countryName);
  return flag ? (
    <img src={flag} alt="" className={styles.countryFlag} />
  ) : (
    <span
      aria-hidden="true"
      className={`${styles.countryFlag} ${styles.countryFlagFallback}`}
      title={`${countryName} flag unavailable`}
    />
  );
};

const renderSegment = (segment: StorySegment, key: React.Key) => {
  if (typeof segment === 'string') return <React.Fragment key={key}>{segment}</React.Fragment>;
  const country = segment as CountryMention;
  return (
    <React.Fragment key={key}>
      {country.name}
      {'\u00a0'}
      <CountryFlag countryId={country.countryId} countryName={country.name} />
    </React.Fragment>
  );
};

const normalizeLocation = (value: unknown): StorySegment[] => {
  if (Array.isArray(value)) return value as StorySegment[];
  return typeof value === 'string' && value.trim() ? [value] : [];
};

const normalizeStory = (value: unknown): StorySentence[] => {
  if (Array.isArray(value)) return value as StorySentence[];
  return typeof value === 'string' && value.trim() ? [{ candidateId: 'legacy-story', segments: [value] }] : [];
};

interface ManagerSpotlightProps {
  spotlight: ManagerSpotlightViewModel | null;
  tournament: {
    name: string;
    countryLimit?: string | null;
    countryLimitFormat?: CountryRestrictionFormat | null;
  };
}

export const ManagerSpotlight: React.FC<ManagerSpotlightProps> = ({ spotlight }) => {
  if (!spotlight) return null;
  const location = normalizeLocation(spotlight.location);
  const story = normalizeStory(spotlight.story);
  const visibleTeams = getVisibleClubTeams(spotlight);

  return (
    <ReusableWidget title="Meet the manager" icon={<UsersThree size={20} weight="bold" />} className={styles.widget}>
      <div className={styles.identity}>
        <Avatar avatar={spotlight.avatar} variant="full" size={52} className={styles.avatar} />
        <div className={styles.identityDetails}>
          <a
            href={managerHref(spotlight.managerId)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.managerName}
          >
            {spotlight.managerName}
          </a>
          <div className={styles.managerMeta}>
            <span>{location.map(renderSegment)}</span>
          </div>
          {spotlight.language && <span className={styles.language}>HT language: {spotlight.language}</span>}
        </div>
      </div>

      <div className={styles.story}>
        {story.map((sentence) => (
          <p key={sentence.candidateId}>
            {sentence.segments.map((segment, index) => renderSegment(segment, `${sentence.candidateId}:${index}`))}
          </p>
        ))}
      </div>

      <div className={styles.teams}>
        {visibleTeams.map((team, index) => {
          const special = getSpecialLeagueLabel(team.leagueId);
          const details: React.ReactNode[] = [];
          const countryName = countryLabel(team.countryId, team.countryName);
          if (countryName) {
            details.push(
              <React.Fragment key="country">
                {countryName}
                {'\u00a0'}
                <CountryFlag countryId={team.countryId} countryName={countryName} />
              </React.Fragment>,
            );
          }
          const hasRank = team.leagueRank !== null && team.leagueRank > 0;
          if (special && !hasRank) details.push(<span key="special">{special}</span>);
          if (team.seriesName) details.push(<span key="series">{team.seriesName}</span>);
          const rank = getClubRankLabel(team);
          if (rank && !special) details.push(<span key="rank">{rank}</span>);
          const leagueFlag = special && hasRank ? getLeagueFlagUrl(team.leagueId) : null;
          const founded = getFoundedYearLabel(team);

          return (
            <section key={team.teamId} className={styles.clubSection}>
              {team.isTournamentTeam && <h3 className={styles.clubHeading}>Participating in this tournament with:</h3>}
              {team.isPrimary && <h3 className={styles.clubHeading}>Main club:</h3>}
              {!team.isTournamentTeam &&
                !team.isPrimary &&
                !visibleTeams.slice(0, index).some((previous) => !previous.isTournamentTeam && !previous.isPrimary) && (
                  <h3 className={styles.clubHeading}>Other clubs:</h3>
                )}
              <div className={`${styles.team} ${team.isTournamentTeam ? styles.tournamentTeam : ''}`}>
                <img src={team.logoUrl || '/matchKitLarge.png'} alt="" className={styles.teamLogo} />
                <div className={styles.teamDetails}>
                  <a href={teamHref(team.teamId)} target="_blank" rel="noopener noreferrer" className={styles.teamName}>
                    {team.teamName}
                  </a>
                  <span className={styles.teamMeta}>
                    {details.length
                      ? details.map((detail, index) => (
                          <React.Fragment key={index}>
                            {index > 0 && ' · '}
                            {detail}
                          </React.Fragment>
                        ))
                      : 'Hattrick club'}
                  </span>
                  {special && hasRank && (
                    <span className={styles.teamMeta}>
                      Ranked #{team.leagueRank} in{' '}
                      {leagueFlag && <img src={leagueFlag} alt="" className={styles.leagueFlag} />} {special}
                    </span>
                  )}
                  {founded && <span className={styles.foundedDate}>{founded}</span>}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </ReusableWidget>
  );
};
