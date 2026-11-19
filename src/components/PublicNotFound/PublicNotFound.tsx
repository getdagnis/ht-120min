'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '../../i18n/LocaleProvider';
import { toLocalePath } from '../../next/locale-path';
import styles from './PublicNotFound.module.sass';

const illustrations = ['/404a.png', '/404b.png', '/404c.png'];

export function PublicNotFound() {
  const { locale, messages } = useLocale();
  const [illustration, setIllustration] = useState<string | null>(null);

  useEffect(() => {
    setIllustration(illustrations[Math.floor(Math.random() * illustrations.length)]);
  }, []);

  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      <div className={styles.illustration}>
        {illustration && <img src={illustration} alt="404" />}
      </div>
      <h1 id="not-found-title" className={styles.title}>{messages.notFound.title}</h1>
      <p className={styles.description}>{messages.notFound.description}</p>
      <Link className={styles.homeLink} href={toLocalePath(locale, '/')}>
        {messages.notFound.homeLink}
      </Link>
    </section>
  );
}
