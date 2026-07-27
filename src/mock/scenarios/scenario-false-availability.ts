import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

const teams = getMockMatchmakerTeams().map((t, i) => ({
  ...t,
  availabilityStatus: i % 2 === 0 ? 'available' : 'booked',
}));
const requests = getMockMatchmakerRequests(new Date()).map((r, i) => ({
  ...r,
  team: { ...r.team, availability_status: i % 2 === 0 ? 'available' : 'booked' },
}));

export const falseAvailability: Scenario = {
  id: 'false-availability',
  name: 'False Availability',
  description: 'Some ads appear but teams are actually booked',
  teams,
  requests,
};

export default falseAvailability;
