/**
 * Test Manager IDs for CHPP Integration Testing
 *
 * These are real Hattrick manager IDs used for testing the CHPP integration.
 * Add manager IDs here to make them available in mock mode.
 *
 * Mock mode will fetch real team data for the selected manager ID
 * and store ads locally (not in DB) for integration testing.
 */

export const TEST_MANAGER_IDS = [
  {
    id: '8777402',
    label: 'CHPP Fetcher',
    description: 'Primary admin account used to fetch CHPP data',
  },
  {
    id: '10025846',
    label: 'Single team manager, #4 in V.93 in Latvia, no friendly booked',
    description: 'Available to book',
  },
];

export function getTestManagerIdList(): typeof TEST_MANAGER_IDS {
  return TEST_MANAGER_IDS;
}

export function getTestManagerById(id: string) {
  return TEST_MANAGER_IDS.find((m) => m.id === id);
}
