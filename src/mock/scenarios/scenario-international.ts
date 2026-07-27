import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

const teams = getMockMatchmakerTeams().map((t, i) => ({ ...t, countryName: i % 2 === 0 ? 'England' : 'Guam' }));
const requests = getMockMatchmakerRequests(new Date()).map((r, i) => ({
  ...r,
  team: { ...r.team, countryName: i % 2 === 0 ? 'England' : 'Guam' },
}));

export const international: Scenario = {
  id: 'international',
  name: 'International',
  description: 'Mix of domestic and international teams to validate location logic',
  teams,
  requests,
};

export default international;
