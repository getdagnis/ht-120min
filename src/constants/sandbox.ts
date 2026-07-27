export const SANDBOX_REGULAR_TEAM_ID_MIN = 40000;
export const SANDBOX_REGULAR_TEAM_ID_MAX = 330000;
export const SANDBOX_HFI_TEAM_ID_MIN = 3220000;
export const SANDBOX_HFI_TEAM_ID_MAX = 3240000;
export const SANDBOX_RANDOM_ATTEMPTS = 25;

export const getRandomSandboxTeamId = (category: 'male' | 'hfi' = 'male') => {
  const min = category === 'hfi' ? SANDBOX_HFI_TEAM_ID_MIN : SANDBOX_REGULAR_TEAM_ID_MIN;
  const max = category === 'hfi' ? SANDBOX_HFI_TEAM_ID_MAX : SANDBOX_REGULAR_TEAM_ID_MAX;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};
