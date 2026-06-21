import React from 'react';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { TeamsIcon } from '../Icons/TeamsIcon';
import { getDisplayTeamName, type MatchmakerTeamOption } from '../../utils/matchmaker';
import styles from './TeamSelectorModal.module.sass';

interface TeamSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: MatchmakerTeamOption[];
  onSelect: (teamId: number) => void;
  title?: string;
}

export const TeamSelectorModal: React.FC<TeamSelectorModalProps> = ({
  isOpen,
  onClose,
  teams,
  onSelect,
  title = 'Select Team'
}) => {
  const isSelectable = (status?: MatchmakerTeamOption['availabilityStatus']) => status === 'available';

  const groupedTeams = [
    {
      key: 'available',
      label: 'Available Now',
      teams: teams.filter((team) => team.availabilityStatus === 'available'),
    },
    {
      key: 'booked',
      label: 'Booked',
      teams: teams.filter((team) => team.availabilityStatus === 'booked'),
    },
    {
      key: 'unavailable',
      label: 'Unavailable',
      teams: teams.filter((team) => team.availabilityStatus === 'unavailable'),
    },
    {
      key: 'unknown',
      label: 'Unknown',
      teams: teams.filter((team) => team.availabilityStatus === 'unknown'),
    },
  ].filter((group) => group.teams.length > 0);

  const getStatusLabel = (team: MatchmakerTeamOption) => {
    if (team.availabilityStatus === 'available') return 'Available now';
    if (team.availabilityStatus === 'booked') return 'Booked';
    if (team.availabilityStatus === 'unknown') return 'Unknown';
    return 'Unavailable';
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className={styles.container}>
        {teams.length > 0 ? (
          <div className={styles.sections}>
            {groupedTeams.map((group) => (
              <section key={group.key} className={styles.section}>
                <h4 className={styles.sectionTitle}>{group.label}</h4>
                <div className={styles.grid}>
                  {group.teams.map((team) => {
                    const selectable = isSelectable(team.availabilityStatus);
                    return (
                      <button
                        key={team.teamId}
                        className={`${styles.teamBtn} ${selectable ? '' : styles.disabled}`}
                        onClick={() => selectable && onSelect(team.teamId)}
                        disabled={!selectable}
                      >
                        <div className={styles.iconWrapper}>
                          {team.logo_url ? (
                            <img src={team.logo_url} alt="" className={styles.teamLogo} />
                          ) : (
                            <TeamsIcon size={24} />
                          )}
                        </div>
                        <div className={styles.info}>
                          <span className={styles.name}>{getDisplayTeamName(team.teamName, team.genderId)}</span>
                          <span className={styles.country}>{team.countryName}</span>
                          <span className={styles.status}>{getStatusLabel(team)}</span>
                          {team.availabilityReason ? (
                            <span className={styles.reason}>{team.availabilityReason}</span>
                          ) : selectable ? (
                            <span className={styles.reason}>Ready to use right now.</span>
                          ) : (
                            <span className={styles.reason}>This team cannot be used right now.</span>
                          )}
                          {team.is_mock && <span className={styles.reason}>Mock</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <p>No matching teams found for this ad.</p>
          </div>
        )}
        <div className={styles.footer}>
          <Button variant="outline" onClick={onClose} fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
};
