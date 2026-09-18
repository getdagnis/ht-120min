import type { ReactNode } from 'react';
import { barlow, barlowCondensed } from '../../fonts';
import '../../global.sass';

export default function ForgeRootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${barlow.variable} ${barlowCondensed.variable}`} lang="en">
      <body>{children}</body>
    </html>
  );
}
