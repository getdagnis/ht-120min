/* eslint-disable react-refresh/only-export-components */

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../global.sass';

export const metadata: Metadata = {
  title: 'HT-120min',
  description: 'The easiest way to organize recurring Hattrick friendlies.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
