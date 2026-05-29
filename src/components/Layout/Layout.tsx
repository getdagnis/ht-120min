import React from 'react';
import { Link } from 'react-router-dom';
import styles from './Layout.module.scss';
import { Trophy } from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.container}>
          <Link to="/" className={styles.logo}>
            <Trophy size={32} className={styles.icon} />
            <span>HT-120 Organizer</span>
          </Link>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.container}>
          {children}
        </div>
      </main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          <p>© {new Date().getFullYear()} HT-120 Tournament Organizer</p>
        </div>
      </footer>
    </div>
  );
};
