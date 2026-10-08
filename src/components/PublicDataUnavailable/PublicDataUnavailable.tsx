import styles from './PublicDataUnavailable.module.sass';

export function PublicDataUnavailable({ retryHref = '.' }: { retryHref?: string }) {
  return (
    <main className={styles.unavailable} role="alert">
      <h1>Temporarily unavailable</h1>
      <p>We couldn’t load this page right now. Please try again.</p>
      <a href={retryHref}>Try again</a>
    </main>
  );
}
