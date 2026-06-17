import React, { useState } from 'react';
import { Button } from '../Button/Button';
import styles from './AdminTestPanel.module.sass';

export const AdminTestPanel: React.FC = () => {
  const [managerId, setManagerId] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/matchmaker/admin-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          adminManagerId: import.meta.env.VITE_ADMIN_HT_ID, // Ensure this is set in .env
          managerId,
          message,
          matchType: '120min',
          opponentLocation: 'any',
          homeAway: 'any',
          isBackAndForth: false,
          isLongTerm: false,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Test ad created!');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.panel}>
      <h3>Admin Ad Creator</h3>
      <input type="text" placeholder="Manager ID" value={managerId} onChange={(e) => setManagerId(e.target.value)} />
      <textarea placeholder="Message" value={message} onChange={(e) => setMessage(e.target.value)} />
      <Button onClick={handleCreate} disabled={loading}>
        {loading ? 'Creating...' : 'Create test ad'}
      </Button>
    </div>
  );
};
