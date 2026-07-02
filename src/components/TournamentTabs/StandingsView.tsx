import React, { useEffect, useState } from 'react';
import { SectionCard } from '../../components/Card/SectionCard';
import { ArrowRight, ShieldCheck } from 'phosphor-react';
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
    id?: string;
    thumbnail_index?: number;
  } | null;
  lastSeenMap?: Record<number, string | null>;
  onRefreshPresence?: () => void;
  canJoinTournament?: boolean;
  isConnecting?: boolean;
  onJoinWithHattrick?: () => void;
}

const DEFAULT_TEAM_LOGO = '/default-logo.png';

export const StandingsView: React.FC<StandingsViewProps> = ({
  standings,
  is120minMode,
  myHtUserId,
  tournament,
  lastSeenMap = {},
  onRefreshPresence,
  canJoinTournament = false,
  isConnecting = false,
  onJoinWithHattrick,
}) => {
  const [presencePulse, setPresencePulse] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setPresencePulse((value) => value + 1), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!onRefreshPresence) return;

    const refresh = () => {
      if (document.visibilityState === 'visible') {
        onRefreshPresence();
      }
    };

    refresh();

    const interval = setInterval(refresh, 2.5 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [onRefreshPresence]);

  return (
    <div className={styles.mainColumn} data-presence-pulse={presencePulse}>
      <SectionCard title="🏆 Standings" thumbnailSeed={tournament?.id}>
        <div className={styles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                {is120minMode ? (
                  <>
                    <th className={styles.center120}>120m</th>
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
              {standings.length === 0 && (
                <tr>
                  <td className={styles.muted}>1</td>
                  <td className={styles.teamNameCell}>
                    <div className={styles.teamInfo}>
                      <img src={DEFAULT_TEAM_LOGO} alt="" className={styles.standingLogo} />
                      <div className={styles.teamTextContainer}>
                        <button
                          type="button"
                          className={`${styles.idLink} ${styles.placeholderJoinLink}`}
                          onClick={onJoinWithHattrick}
                          disabled={!canJoinTournament || isConnecting}
                        >
                          <div className={styles.nameRow}>
                            <span className={styles.teamName}>Be the FIRST team to start!</span>
                            <ArrowRight size={15} weight="bold" className={styles.placeholderArrow} />
                          </div>
                        </button>
                        <span className={styles.placeholderByline}>Join and be the one to start the tournament</span>
                      </div>
                    </div>
                  </td>
                  {is120minMode ? (
                    <>
                      <td className={`${styles.highlight} ${styles.center}`}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                      <td className={styles.center}>0</td>
                    </>
                  )}
                </tr>
              )}
              {standings.map((s, idx) => {
                const isMyTeam = s.htTeamId === Number(myHtUserId);
                return (
                  <tr key={s.teamId} className={isMyTeam ? styles.myTeamRow : ''}>
                    <td className={styles.muted}>{idx + 1}</td>
                    <td className={styles.teamNameCell}>
                      <div className={styles.teamInfo}>
                        <img
                          src={s.logoUrl || DEFAULT_TEAM_LOGO}
                          alt={s.teamName}
                          className={styles.standingLogo}
                          onError={(event) => {
                            event.currentTarget.src = DEFAULT_TEAM_LOGO;
                          }}
                        />
                        <div className={styles.teamTextContainer}>
                          <a
                            href={`https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${s.htTeamId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.idLink}
                          >
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
                          </a>
                          <TeamByline
                            countryName={s.countryName}
                            countryId={s.countryId}
                            teamId={s.htTeamId}
                            managerName={s.managerName}
                            managerHtId={s.hattrickUserId}
                            mode="standings"
                            lastSeenAt={s.hattrickUserId != null ? (lastSeenMap[s.hattrickUserId] ?? null) : null}
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
