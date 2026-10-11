import { useTranslations } from 'next-intl';
import styles from './PublicDataUnavailable.module.sass';
import { getPublicDataRetryHref } from '../../utils/public-data-config';

export function PublicDataUnavailable({ retryHref = '.', attempt = 1 }: { retryHref?: string; attempt?: number }) {
  const uiText = useTranslations('PublicUI.PublicDataUnavailable');
  const exhaustedRetries = attempt >= 3;

  return (
    <main className={styles.unavailable} role="alert">
      <h1>{uiText('temporarilyUnavailable')}</h1>
      <p>{exhaustedRetries ? uiText('3AttemptsTimedOutPleaseTryAgainLater') : uiText('weCouldnTLoadThisPageRightNowPlease')}</p>
      <div className={styles.actions}>
        <a href={getPublicDataRetryHref(retryHref, attempt)}>{exhaustedRetries ? uiText('tryNow') : uiText('tryAgain')}</a>
        {attempt >= 2 && (
          <a
            className={styles.reportLink}
            href="https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=8777402"
            target="_blank"
            rel="noreferrer"
          >
            {uiText('pleaseReportThisProblem')}
          </a>
        )}
      </div>
    </main>
  );
}
