const STORAGE_KEY = 'ht120_matchmaker_mock_state';
const MOCK_MANAGER_ID_KEY = 'ht120_mock_manager_id';

export interface MockPersistenceState {
  requests: any[];
  bookings: any[];
  interests: any[];
  comments: any[];
}

export interface MockPersistenceStorage {
  mock: MockPersistenceState;
  scenario: MockPersistenceState;
}

export const defaultState = (): MockPersistenceState => ({
  requests: [],
  bookings: [],
  interests: [],
  comments: [],
});

const defaultStorage = (): MockPersistenceStorage => ({
  mock: defaultState(),
  scenario: defaultState(),
});

export function loadMockState(mode: 'mock' | 'scenario' = 'mock'): MockPersistenceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'mock' in parsed && 'scenario' in parsed) {
      return (parsed as MockPersistenceStorage)[mode] ?? defaultState();
    }

    return parsed as MockPersistenceState;
  } catch (e) {
    console.error('Failed to load mock state', e);
    return defaultState();
  }
}

export function saveMockState(state: MockPersistenceState, mode: 'mock' | 'scenario' = 'mock') {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const storage = raw ? JSON.parse(raw) : defaultStorage();
    if (!storage || typeof storage !== 'object' || !('mock' in storage) || !('scenario' in storage)) {
      const nextStorage = defaultStorage();
      nextStorage[mode] = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStorage));
      return;
    }

    const nextStorage = storage as MockPersistenceStorage;
    nextStorage[mode] = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStorage));
  } catch (e) {
    console.error('Failed to save mock state', e);
  }
}

export function clearMockState(mode?: 'mock' | 'scenario') {
  try {
    if (!mode) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const storage = JSON.parse(raw);
    if (!storage || typeof storage !== 'object' || !('mock' in storage) || !('scenario' in storage)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const nextStorage = storage as MockPersistenceStorage;
    nextStorage[mode] = defaultState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStorage));
  } catch (e) {
    console.error('Failed to clear mock state', e);
  }
}

export function setMockManagerId(managerId: string | null) {
  try {
    if (managerId) {
      localStorage.setItem(MOCK_MANAGER_ID_KEY, managerId);
    } else {
      localStorage.removeItem(MOCK_MANAGER_ID_KEY);
    }
  } catch (e) {
    console.error('Failed to set mock manager ID', e);
  }
}

export function getMockManagerId(): string | null {
  try {
    return localStorage.getItem(MOCK_MANAGER_ID_KEY);
  } catch (e) {
    console.error('Failed to get mock manager ID', e);
    return null;
  }
}

export function getPersistenceMode(): 'mock' | 'scenario' {
  try {
    const runtimeMode = typeof window !== 'undefined' ? localStorage.getItem('ht120_mode') : null;
    return runtimeMode === 'scenario' ? 'scenario' : 'mock';
  } catch (e) {
    console.error('Failed to get persistence mode', e);
    return 'mock';
  }
}

/**
 * In mock mode, get the currently selected test manager ID to impersonate.
 * If no manager is selected, returns null (no mock mode active).
 */
export function getSelectedMockManagerId(): string | null {
  try {
    return localStorage.getItem(MOCK_MANAGER_ID_KEY);
  } catch (e) {
    console.error('Failed to get selected mock manager ID', e);
    return null;
  }
}
