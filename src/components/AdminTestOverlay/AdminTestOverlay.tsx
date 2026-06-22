/* eslint-disable react-hooks/set-state-in-effect */

import React, { useState, useEffect } from 'react';
import {
  clearMockState,
  getAllScenarios,
  getMockManagerId,
  setMockManagerId,
  getTestManagerIdList,
} from '../../mock/matchmaker';
import styles from './AdminTestOverlay.module.sass';

const STORAGE_MODE = 'ht120_mode';
const STORAGE_SCENARIO = 'ht120_scenario';

export const AdminTestOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<string>(() =>
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_MODE) || 'production' : 'production',
  );
  const [scenario, setScenario] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_SCENARIO) : null,
  );

  const [mockManagerId, setLocalMockManagerId] = useState<string>(() =>
    typeof window !== 'undefined' ? getMockManagerId() || '' : '',
  );

  useEffect(() => {
    // show overlay if not production or superadmin cookie present
    try {
      const cookie = typeof window !== 'undefined' ? document.cookie : '';
      if (mode !== 'production' && cookie.includes('issuperadmin=youbet')) setVisible(true);
    } catch {
      // ignore
    }
  }, [mode]);

  const apply = (nextMode: string, nextScenario?: string | null, nextMockManagerId?: string | null) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_MODE, nextMode);
    if (nextScenario) localStorage.setItem(STORAGE_SCENARIO, nextScenario);
    else localStorage.removeItem(STORAGE_SCENARIO);

    if (nextMockManagerId) {
      setMockManagerId(nextMockManagerId);
    } else {
      setMockManagerId(null);
    }

    window.location.reload();
  };

  const reset = () => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_MODE);
    localStorage.removeItem(STORAGE_SCENARIO);
    window.location.reload();
  };

  const resetState = () => {
    if (typeof window === 'undefined') return;
    clearMockState();
    window.location.reload();
  };

  if (!visible) return null;

  const scenarios = getAllScenarios();

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>Test Overlay</div>
      <div className={styles.row}>
        <label>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="production">Production</option>
          <option value="mock">Mock</option>
          <option value="scenario">Scenario</option>
        </select>
      </div>

      {mode === 'scenario' && (
        <div className={styles.row}>
          <label>Scenario</label>
          <select value={scenario || ''} onChange={(e) => setScenario(e.target.value || null)}>
            <option value="">(none)</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === 'mock' && (
        <div className={styles.row}>
          <label>Test Manager</label>
          <select value={mockManagerId} onChange={(e) => setLocalMockManagerId(e.target.value)}>
            <option value="">(None - Use fixtures)</option>
            {getTestManagerIdList().map((mgr) => (
              <option key={mgr.id} value={mgr.id}>
                {mgr.label} ({mgr.id})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.actions}>
        <button
          onClick={() => apply(mode, scenario, mode === 'mock' ? mockManagerId || null : null)}
          className={styles.btnApply}
        >
          Apply
        </button>
        <button onClick={reset} className={styles.btnReset}>
          Reset
        </button>
        <button onClick={resetState} className={styles.btnReset}>
          Clear State
        </button>
      </div>
    </div>
  );
};

export default AdminTestOverlay;
