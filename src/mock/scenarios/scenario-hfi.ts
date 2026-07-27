import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

const teams = getMockMatchmakerTeams().map((t) => ({ ...t, genderId: 0 }));
const requests = getMockMatchmakerRequests(new Date()).map((r) => ({ ...r, team: { ...r.team, genderId: 0 } }));

export const hfi: Scenario = {
  id: 'hfi',
  name: 'HFI',
  description: 'Hattrick Femme International teams only',
  teams,
  requests,
};

export default hfi;
