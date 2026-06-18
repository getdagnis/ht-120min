import React from 'react';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { TeamsIcon } from '../Icons/TeamsIcon';
import styles from './TeamSelectorModal.module.sass';

interface TeamOption {
  teamId: number;
  teamName: string;
  logo_url?: string | null;
  countryName?: string;
  availabilityStatus?: 'available' | 'booked' | 'unknown';
}

interface TeamSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: TeamOption[];
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
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className={styles.container}>
        <div className={styles.grid}>
          {teams.map((team) => (
            <button
              key={team.teamId}
              className={`${styles.teamBtn} ${team.availabilityStatus === 'booked' ? styles.disabled : ''}`}
              onClick={() => team.availabilityStatus !== 'booked' && onSelect(team.teamId)}
              disabled={team.availabilityStatus === 'booked'}
            >
              <div className={styles.iconWrapper}>
                {team.logo_url ? (
                  <img src={team.logo_url} alt="" className={styles.teamLogo} />
                ) : (
                  <TeamsIcon size={24} />
                )}
              </div>
              <div className={styles.info}>
                <span className={styles.name}>{team.teamName}</span>
                <span className={styles.country}>{team.countryName}</span>
                {team.availabilityStatus === 'booked' && (
                  <span className={styles.status}>Already booked</span>
                )}
              </div>
            </button>
          ))}
        </div>
        <div className={styles.footer}>
          <Button variant="outline" onClick={onClose} fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
};
