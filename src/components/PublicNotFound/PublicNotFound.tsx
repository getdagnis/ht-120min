'use client';

import Link from 'next/link';
import { SectionCard } from '../Card/SectionCard';
import { useLocale } from '../../i18n/LocaleProvider';
import { toLocalePath } from '../../next/locale-path';
import styles from './PublicNotFound.module.sass';

export function PublicNotFound() {
  const { locale, messages } = useLocale();

  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      <SectionCard>
        <div className={styles.content}>
          <p className={styles.code}>404</p>
          <h1 id="not-found-title" className={styles.title}>{messages.notFound.title}</h1>
          <p className={styles.description}>{messages.notFound.description}</p>
          <Link className={styles.homeLink} href={toLocalePath(locale, '/')}>
            {messages.notFound.homeLink}
          </Link>
        </div>
      </SectionCard>
    </section>
  );
}
