export { getMockMatchmakerTeams, getMockMatchmakerTeamById } from './mockTeams';
export { getMockMatchmakerRequests } from './mockRequests';

export const isMatchmakerMockDataEnabled = () => import.meta.env.VITE_MATCHMAKER_MOCK_DATA === 'true';

