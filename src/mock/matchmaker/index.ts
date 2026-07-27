export { getMockMatchmakerTeams, getMockMatchmakerTeamById } from './mockTeams';
export { getMockMatchmakerRequests } from './mockRequests';
export { clearMockState, getMockManagerId, setMockManagerId, getSelectedMockManagerId } from '../persistence';
export { getAllScenarios, findScenarioById } from '../scenarios';
export { getTestManagerIdList, getTestManagerById } from '../mockManagerIds';

export const isMatchmakerMockDataEnabled = () => process.env.NEXT_PUBLIC_MATCHMAKER_MOCK_DATA === 'true';
