import React from 'react';
import { ArrowUpRight, UsersThree } from 'phosphor-react';

import { Avatar } from '../Avatar/Avatar';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import { countryLabel, getClubRankLabel, SPECIAL_LEAGUES, type ManagerSpotlight as ManagerSpotlightViewModel } from '../../utils/manager-spotlight';
import styles from './ManagerSpotlight.module.sass';

const managerHref = (managerId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${managerId}`;
const teamHref = (teamId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;

interface ManagerSpotlightProps {
  spotlight: ManagerSpotlightViewModel | null;
}

export const ManagerSpotlight: React.FC<ManagerSpotlightProps> = ({ spotlight }) => {
  if (!spotlight) return null;

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
            <span>{spotlight.location}</span>
          </div>
          {spotlight.language && <span className={styles.language}>Hattrick language: {spotlight.language}</span>}
        </div>
      </div>

      <p className={styles.story}>{spotlight.story}</p>

      <div className={styles.teams}>
        {spotlight.currentTeams.map((team) => {
          const special = team.leagueId ? SPECIAL_LEAGUES[team.leagueId] : null;
          const details = [
            countryLabel(team.countryId, team.countryName),
            special?.shortName,
            team.seriesName,
            getClubRankLabel(team),
          ].filter(Boolean).join(' · ');

          return (
            <div key={team.teamId} className={`${styles.team} ${team.isTournamentTeam ? styles.tournamentTeam : ''}`}>
              <img src={team.logoUrl || '/matchKitLarge.png'} alt="" className={styles.teamLogo} />
              <div className={styles.teamDetails}>
                <a href={teamHref(team.teamId)} target="_blank" rel="noopener noreferrer" className={styles.teamName}>
                  {team.teamName}
                </a>
                <span className={styles.teamMeta}>
                  {details || 'Hattrick club'}
                </span>
              </div>
              <div className={styles.teamLabels}>
                {team.isTournamentTeam && <span className={styles.tournamentLabel}>This tournament</span>}
              </div>
            </div>
          );
        })}
      </div>
    </ReusableWidget>
  );
};
