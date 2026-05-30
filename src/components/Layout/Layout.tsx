import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trophy, Moon, Sun, Plus } from 'lucide-react';
import { Button } from '../Button/Button';
import styles from './Layout.module.scss';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.container}>
          <div className={styles.headerContent}>
            <Link to="/" className={styles.logo}>
              <Trophy className={styles.icon} size={28} />
              <span>HT-120min</span>
            </Link>

            <div className={styles.actions}>
              <button onClick={toggleTheme} className={styles.themeToggle} aria-label="Toggle theme">
                {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              </button>
              <Button size="sm" onClick={() => navigate('/create')} variant="primary">
                <Plus size={18} /> <span className={styles.hideMobile}>Create Tournament</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.container}>{children}</div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <p>&copy; {new Date().getFullYear()} HT-120min - A Hattrick Community Tool</p>
        </div>
      </footer>
    </div>
  );
};
