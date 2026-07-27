import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

const teams = getMockMatchmakerTeams().map((t, i) => ({
  ...t,
  availabilityStatus: i === 0 ? 'booked' : 'available',
  availabilityReason: i === 0 ? 'Booked this week, available next week' : undefined,
}));

const now = new Date();
const requests = getMockMatchmakerRequests(now).map((r, i) => ({
  ...r,
  team: { ...r.team, availability_status: i === 0 ? 'booked' : 'available' },
}));

export const futureAvailability: Scenario = {
  id: 'future-availability',
  name: 'Future Availability',
  description: 'Teams booked now but free later',
  teams,
  requests,
};

export default futureAvailability;
