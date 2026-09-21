import React from 'react';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { ModalTeamCard } from '../ModalTeamCard/ModalTeamCard';
import { getDisplayTeamName, type MatchmakerTeamOption } from '../../utils/matchmaker';
import styles from './TeamSelectorModal.module.sass';

interface TeamSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: MatchmakerTeamOption[];
  onSelect: (teamId: number) => void;
  title?: string;
  modalClassName?: string;
}

export const TeamSelectorModal: React.FC<TeamSelectorModalProps> = ({
  isOpen,
  onClose,
  teams,
  onSelect,
  title = 'Select Team',
  modalClassName = '',
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
      label: 'Booked This Week',
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
    return 'Booked This Week';
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} modalClassName={modalClassName}>
      <div className={styles.container}>
        {teams.length > 0 ? (
          <div className={styles.sections}>
            {groupedTeams.map((group) => (
              <section key={group.key} className={styles.section}>
                <h4 className={styles.sectionTitle}>{group.label}</h4>
                <div className={styles.grid}>
                  {group.teams.map((team) => {
                    const selectable = isSelectable(team.availabilityStatus);
                    const status = team.availabilityReason
                      ? `${getStatusLabel(team)} — ${team.availabilityReason}`
                      : selectable
                        ? 'Available now — ready to use right now.'
                        : `${getStatusLabel(team)} — this team cannot be used right now.`;
                    return (
                      <ModalTeamCard
                        key={team.teamId}
                        team={{
                          teamId: team.teamId,
                          teamName: getDisplayTeamName(team.teamName, team.genderId),
                          logoUrl: team.logo_url,
                          countryId: team.countryId,
                          countryName: team.countryName,
                          leagueId: team.leagueId,
                          leagueName: team.leagueName,
                        }}
                        status={team.is_mock ? `${status} Mock` : status}
                        statusDanger={!selectable}
                        onSelect={selectable ? () => onSelect(team.teamId) : undefined}
                        disabled={!selectable}
                      />
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
