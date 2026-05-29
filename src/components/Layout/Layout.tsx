import React from 'react';
import { Link } from 'react-router-dom';
import styles from './Layout.module.scss';
import { Trophy } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.container}>
          <Link to="/" className={styles.logo}>
            <Trophy size={32} className={styles.icon} />
            <span>HT-120min</span>
          </Link>
        </div>
      </header>
      <div className={styles.wrapper}>
        <main className={styles.main}>
          <div className={styles.container}>{children}</div>
        </main>
        <footer className={styles.footer}>
          <div className={styles.container}>
            <p>
              © {new Date().getFullYear()}{' '}
              <a href="http://getdagnis.vercel.app" target="_blank">
                mr_bots
              </a>{' '}
              manager of{' '}
              <a href="http://www.hattrick.org/Club/?TeamID=681813" target="_blank">
                This bot team is a bot
              </a>
            </p>
          </div>
        </footer>
      </div>
    </>
  );
};
