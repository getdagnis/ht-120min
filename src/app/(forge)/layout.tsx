import type { ReactNode } from 'react';
import { barlow, barlowCondensed, ibmPlexMono, notoColorEmoji } from '../../fonts';
import '../../global.sass';

export default function ForgeRootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={`${barlow.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} ${notoColorEmoji.variable}`} data-theme="light" lang="en">
      <body>{children}</body>
    </html>
  );
}
