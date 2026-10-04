'use client';

import { SectionCard } from '../../../components/Card/SectionCard';

// A shared boundary lets Next prefetch the shell and commit navigation immediately.
// Public data is cached separately; identity and live observations stay dynamic.
export default function PublicPageLoading() {
  return (
    <SectionCard title="Loading page…">
      <p role="status" aria-live="polite">Getting tournament information.</p>
    </SectionCard>
  );
}
