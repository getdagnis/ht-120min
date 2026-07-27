'use client';

import { BrowserRouter } from 'react-router-dom';
import { ForgePage } from '../legacy-pages/Forge/ForgePage';

export function ForgeApp() {
  return (
    <BrowserRouter basename="/forge">
      <ForgePage />
    </BrowserRouter>
  );
}
