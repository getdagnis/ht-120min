import React, { useEffect } from 'react';
import { SupportersWall } from '../../components/SupportersWall/SupportersWall';

export const SupportersPage: React.FC = () => {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div style={{ padding: '0 1rem' }}>
      <SupportersWall variant="full" />
    </div>
  );
};
