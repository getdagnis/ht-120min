import React from 'react';
import { ArrowUpRight, UsersThree } from 'phosphor-react';

import { Avatar } from '../Avatar/Avatar';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import { countryFlagUrl, countryLabel, getClubRankLabel, SPECIAL_LEAGUES, type CountryMention, type ManagerSpotlight as ManagerSpotlightViewModel, type StorySegment, type StorySentence } from '../../utils/manager-spotlight';
import styles from './ManagerSpotlight.module.sass';

const managerHref = (managerId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${managerId}`;
const teamHref = (teamId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;

const CountryFlag: React.FC<{ countryId: number | null; countryName: string }> = ({ countryId, countryName }) => {
  const flag = countryFlagUrl(countryId, countryName);
  return flag
    ? <img src={flag} alt="" className={styles.countryFlag} />
    : <span aria-hidden="true" className={`${styles.countryFlag} ${styles.countryFlagFallback}`} title={`${countryName} flag unavailable`} />;
};

const renderSegment = (segment: StorySegment, key: React.Key) => {
  if (typeof segment === 'string') return <React.Fragment key={key}>{segment}</React.Fragment>;
  const country = segment as CountryMention;
  return (
    <React.Fragment key={key}>
      {country.name}<CountryFlag countryId={country.countryId} countryName={country.name} />
    </React.Fragment>
  );
};

const normalizeLocation = (value: unknown): StorySegment[] => {
  if (Array.isArray(value)) return value as StorySegment[];
  return typeof value === 'string' && value.trim() ? [value] : [];
};

const normalizeStory = (value: unknown): StorySentence[] => {
  if (Array.isArray(value)) return value as StorySentence[];
  return typeof value === 'string' && value.trim()
    ? [{ candidateId: 'legacy-story', segments: [value] }]
    : [];
};

interface ManagerSpotlightProps {
  spotlight: ManagerSpotlightViewModel | null;
}

export const ManagerSpotlight: React.FC<ManagerSpotlightProps> = ({ spotlight }) => {
  if (!spotlight) return null;
  const location = normalizeLocation(spotlight.location);
  const story = normalizeStory(spotlight.story);

  return (
    <ReusableWidget title="Meet the manager" icon={<UsersThree size={20} weight="bold" />} className={styles.widget}>
      <div className={styles.identity}>
        <Avatar avatar={spotlight.avatar} variant="circle" size={52} className={styles.avatar} />
        <div className={styles.identityDetails}>
          <a
            href={managerHref(spotlight.managerId)}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.managerName}
          >
            {spotlight.managerName}
            <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
          </a>
          <div className={styles.managerMeta}>
            <span>{location.map(renderSegment)}</span>
          </div>
          {spotlight.language && <span className={styles.language}>Hattrick language: {spotlight.language}</span>}
        </div>
      </div>

      <div className={styles.story}>
        {story.map((sentence) => (
          <p key={sentence.candidateId}>{sentence.segments.map((segment, index) => renderSegment(segment, `${sentence.candidateId}:${index}`))}</p>
        ))}
      </div>

      <div className={styles.teams}>
        {spotlight.currentTeams.map((team) => {
          const special = team.leagueId ? SPECIAL_LEAGUES[team.leagueId] : null;
          const details: React.ReactNode[] = [];
          const countryName = countryLabel(team.countryId, team.countryName);
          if (countryName) {
            details.push(<React.Fragment key="country">{countryName}<CountryFlag countryId={team.countryId} countryName={countryName} /></React.Fragment>);
          }
          if (special) details.push(<span key="special">{special.shortName}</span>);
          if (team.seriesName) details.push(<span key="division">{team.seriesName}</span>);
          const rank = getClubRankLabel(team);
          if (rank) details.push(<span key="rank">{rank}</span>);

          return (
            <div key={team.teamId} className={`${styles.team} ${team.isTournamentTeam ? styles.tournamentTeam : ''}`}>
              <img src={team.logoUrl || '/matchKitLarge.png'} alt="" className={styles.teamLogo} />
              <div className={styles.teamDetails}>
                <a href={teamHref(team.teamId)} target="_blank" rel="noopener noreferrer" className={styles.teamName}>
                  {team.teamName}
                </a>
                <span className={styles.teamMeta}>
                  {details.length ? details.map((detail, index) => <React.Fragment key={index}>{index > 0 && ' · '}{detail}</React.Fragment>) : 'Hattrick club'}
                </span>
              </div>
              <div className={styles.teamLabels}>
                {team.isTournamentTeam && <span className={styles.tournamentLabel}>This tournament</span>}
                {team.isPrimary && <span className={styles.primaryLabel}>Main club</span>}
              </div>
            </div>
          );
        })}
      </div>
    </ReusableWidget>
  );
};
