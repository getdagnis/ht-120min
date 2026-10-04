import React from 'react';
import { ArrowUpRight, UsersThree } from 'phosphor-react';

import { Avatar } from '../Avatar/Avatar';
import { ReusableWidget } from '../ReusableWidget/ReusableWidget';
import { getCanonicalCountryName, getCountryFlagUrl } from '../../utils/ht-data';
import type { ManagerSpotlight as ManagerSpotlightViewModel } from '../../utils/manager-spotlight';
import styles from './ManagerSpotlight.module.sass';

const managerHref = (managerId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/Manager/?userId=${managerId}`;
const teamHref = (teamId: number) => `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;

interface ManagerSpotlightProps {
  spotlight: ManagerSpotlightViewModel | null;
}

export const ManagerSpotlight: React.FC<ManagerSpotlightProps> = ({ spotlight }) => {
  if (!spotlight) return null;

  const managerCountry = getCanonicalCountryName(spotlight.countryName, spotlight.countryId);
  const managerFlag = getCountryFlagUrl(spotlight.countryId, managerCountry);

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
            {managerFlag && <img src={managerFlag} alt="" />}
            <span>{managerCountry || 'Country unknown'}</span>
          </div>
          {spotlight.language && <span className={styles.language}>Hattrick language: {spotlight.language}</span>}
        </div>
      </div>

      <div className={styles.teams}>
        {spotlight.currentTeams.map((team) => {
          const countryName = getCanonicalCountryName(team.countryName, team.countryId);
          const countryFlag = getCountryFlagUrl(team.countryId, countryName);
          const details = [countryName, team.seriesName || team.leagueName].filter(Boolean).join(' · ');

          return (
            <div key={team.teamId} className={`${styles.team} ${team.isTournamentTeam ? styles.tournamentTeam : ''}`}>
              <img src={team.logoUrl || '/matchKitLarge.png'} alt="" className={styles.teamLogo} />
              <div className={styles.teamDetails}>
                <a href={teamHref(team.teamId)} target="_blank" rel="noopener noreferrer" className={styles.teamName}>
                  {team.teamName}
                </a>
                <span className={styles.teamMeta}>
                  {countryFlag && <img src={countryFlag} alt="" />}
                  {details || 'Hattrick club'}
                </span>
              </div>
              <div className={styles.teamLabels}>
                {team.isPrimary && <span className={styles.primaryLabel}>Main club</span>}
                {team.isTournamentTeam && <span className={styles.tournamentLabel}>This tournament</span>}
              </div>
            </div>
          );
        })}
      </div>

      <p className={styles.story}>{spotlight.story}</p>
    </ReusableWidget>
  );
};
