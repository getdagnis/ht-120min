import styles from './PublicDataUnavailable.module.sass';

export function PublicDataUnavailable({ retryHref = '.' }: { retryHref?: string }) {
  return (
    <main className={styles.unavailable} role="alert">
      <h1>Temporarily unavailable</h1>
      <p>We couldn’t load this page right now. Please try again.</p>
      <div className={styles.actions}>
        <a href={retryHref}>Try again</a>
        <a
          className={styles.reportLink}
          href="https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=8777402"
          target="_blank"
          rel="noreferrer"
        >
          Please report this problem
        </a>
      </div>
    </main>
  );
}
