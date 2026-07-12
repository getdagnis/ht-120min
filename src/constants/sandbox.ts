export const SANDBOX_TEAM_ID_MIN = 40000;
export const SANDBOX_TEAM_ID_MAX = 330000;
export const SANDBOX_RANDOM_ATTEMPTS = 25;

export const getRandomSandboxTeamId = () =>
  Math.floor(Math.random() * (SANDBOX_TEAM_ID_MAX - SANDBOX_TEAM_ID_MIN + 1)) + SANDBOX_TEAM_ID_MIN;
