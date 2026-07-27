import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

const teams = getMockMatchmakerTeams().map((t) => ({ ...t, availabilityStatus: 'booked' as const }));
const requests = getMockMatchmakerRequests(new Date()).map((r) => ({
  ...r,
  team: { ...r.team, availability_status: 'booked' },
}));

export const noAvailable: Scenario = {
  id: 'no-available',
  name: 'No Available Teams',
  description: 'All teams are booked/unavailable',
  teams,
  requests,
};

export default noAvailable;
