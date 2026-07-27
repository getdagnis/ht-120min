import type { ReactNode } from 'react';
import '../../global.sass';

export default function ForgeRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
