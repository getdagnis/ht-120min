import styles from './PublicDataUnavailable.module.sass';
import { getPublicDataRetryHref } from '../../utils/public-data-config';

export function PublicDataUnavailable({ retryHref = '.', attempt = 1 }: { retryHref?: string; attempt?: number }) {
  const exhaustedRetries = attempt >= 3;

  return (
    <main className={styles.unavailable} role="alert">
      <h1>Temporarily unavailable</h1>
      <p>{exhaustedRetries ? '3 attempts timed out. Please try again later' : 'We couldn’t load this page right now. Please try again.'}</p>
      <div className={styles.actions}>
        <a href={getPublicDataRetryHref(retryHref, attempt)}>{exhaustedRetries ? 'Try now' : 'Try again'}</a>
        {attempt >= 2 && (
          <a
            className={styles.reportLink}
            href="https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=8777402"
            target="_blank"
            rel="noreferrer"
          >
            Please report this problem
          </a>
        )}
      </div>
    </main>
  );
}
