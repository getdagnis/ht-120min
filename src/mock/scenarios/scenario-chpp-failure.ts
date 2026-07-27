import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

// Simulate missing data by nulling out logos and arenas
const teams = getMockMatchmakerTeams().map((t) => ({ ...t, logo_url: null, arena_image_url: null }));
const requests = getMockMatchmakerRequests(new Date()).map((r) => ({
  ...r,
  team: { ...r.team, logo_url: null, arena_image_url: null },
}));

export const chppFailure: Scenario = {
  id: 'chpp-failure',
  name: 'CHPP Failure',
  description: 'Incomplete/missing CHPP responses to validate graceful degradation',
  teams,
  requests,
};

export default chppFailure;
