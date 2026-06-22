import { getMockMatchmakerTeams } from '../matchmaker/mockTeams';
import { getMockMatchmakerRequests } from '../matchmaker/mockRequests';
import type { Scenario } from './types';

const teams = getMockMatchmakerTeams();
const requests = getMockMatchmakerRequests(new Date());

export const happyPath: Scenario = {
  id: 'happy-path',
  name: 'Happy Path',
  description: 'Available teams, active ads, mixed domestic/international and HFI examples',
  teams,
  requests,
  metadata: { seed: 'happy' },
};

export default happyPath;
