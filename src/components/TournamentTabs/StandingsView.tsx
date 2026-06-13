import React from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { ShieldCheck } from 'phosphor-react';
import { TeamByline } from '../TeamByline/TeamByline';

import type { TeamStanding } from '../../utils/standings';
// import { MottoWidget } from '../../components/MottoWidget/MottoWidget';
// import { TOURNAMENT_DEFAULT } from '../../constants/descriptions';

import styles from '../../pages/Public/TournamentView.module.sass';

interface StandingsViewProps {
  standings: TeamStanding[];
  is120minMode: boolean;
  myHtUserId: string | null;
  tournament: {
    thumbnail_index?: number;
  } | null;
}

export const StandingsView: React.FC<StandingsViewProps> = ({ standings, is120minMode, myHtUserId, tournament }) => {
  return (
    <div className={styles.mainColumn}>
      <SectionCard title="🏆 Standings" headerThumbnailIndex={tournament?.thumbnail_index}>
        <div className={styles.tableWrapper}>
          <table>
            <thead>
              <tr className={styles.muted}>
                <th>#</th>
                <th>Team</th>
                {is120minMode ? (
                  <>
                    <th className={styles.center}>120m</th>
                    <th className={styles.center}>Mins</th>
                    <th className={styles.center}>Pld</th>
                    <th className={styles.center}>Dif</th>
                    <th className={styles.center}>Goals</th>
                  </>
                ) : (
                  <>
                    <th className={styles.center}>Pld</th>
                    <th className={styles.center}>W</th>
                    <th className={styles.center}>D</th>
                    <th className={styles.center}>L</th>
                    <th className={styles.center}>GD</th>
                    <th className={styles.center}>Pts</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {standings.map((s, idx) => {
                const isMyTeam = s.htTeamId === Number(myHtUserId);
                return (
                  <tr key={s.teamId} className={isMyTeam ? styles.myTeamRow : ''}>
                    <td className={styles.muted}>{idx + 1}</td>
                    <td className={styles.teamNameCell}>
                      <div className={styles.teamInfo}>
                        {s.logoUrl && <img src={s.logoUrl} alt={s.teamName} className={styles.standingLogo} />}
                        <div className={styles.teamTextContainer}>
                          <div className={styles.nameRow}>
                            <span className={styles.teamName}>
                              {s.teamName}
                              {isMyTeam && <span className={styles.myTeamBadge}> (You)</span>}
                            </span>
                            {s.joinedViaOauth && (
                              <span title="Hattrick Validated Team">
                                <ShieldCheck size={14} weight="bold" className={styles.validatedIcon} />
                              </span>
                            )}
                          </div>
                          <TeamByline
                            countryName={s.countryName}
                            countryId={s.countryId}
                            teamId={s.htTeamId}
                            managerName={s.managerName}
                            managerHtId={s.hattrickUserId}
                            mode="standings"
                          />
                        </div>
                      </div>
                    </td>
                    {is120minMode ? (
                      <>
                        <td className={`${styles.highlight} ${styles.center}`}>{s.achievements120min}</td>
                        <td className={styles.center}>{s.totalMinutes}</td>
                        <td className={styles.center}>{s.played}</td>
                        <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                        <td className={styles.center}>{s.gf}</td>
                      </>
                    ) : (
                      <>
                        <td className={styles.center}>{s.played}</td>
                        <td className={styles.center}>{s.won}</td>
                        <td className={styles.center}>{s.drawn}</td>
                        <td className={styles.center}>{s.lost}</td>
                        <td className={styles.center}>{s.gd > 0 ? `+${s.gd}` : s.gd}</td>
                        <td className={styles.center}>{s.pts}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
      {/* <MottoWidget items={TOURNAMENT_DEFAULT} theme="dark" variant="standings" className={styles.standingsMotto} /> */}
      <SectionCard title="News Feed">
        <ul className={styles.newsFeed}>
          <li className={styles.feedItem}>
            <div className={styles.feedIcon}></div>
            <div className={styles.feedContent}>
              <p>New cup registration is now open!</p>
              <span>2 hours ago</span>
            </div>
          </li>
        </ul>
      </SectionCard>
    </div>
  );
};
