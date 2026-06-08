import React, { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Link, useNavigate } from 'react-router-dom';
import { Trophy, Sun, Moon, Plus } from 'phosphor-react';
import { Button } from '../Button/Button';
import styles from './Layout.module.sass';

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
              <Trophy size={28} weight="bold" className={styles.icon} />
              <span>HT-120min</span>
            </Link>

            <div className={styles.actions}>
              <Button
                size="sm"
                onClick={toggleTheme}
                className={styles.themeToggle}
                aria-label="Toggle theme"
                variant="zero"
              >
                {theme === 'dark' ? (
                  <Sun size={20} weight="bold" />
                ) : (
                  <Moon size={20} weight="bold" />
                )}
              </Button>
              <Button size="sm" onClick={() => navigate('/create')} variant="zero" className={styles.createBtn}>
                <Plus size={18} weight="bold" /> <span className={styles.hideMobile}>CREATE TOURNAMENT</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          <p>
            © {new Date().getFullYear()}
            <a href="http://getdagnis.vercel.app" target="_blank">
              {' '}
              mr_bots a.k.a. getdagnis 🇱🇻
            </a>{' '}
            manager of{' '}
            <a href="https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=681813" target="_blank">
              This bot team is a bot 🇱🇻
            </a>{' '}
            and{' '}
            <a href="https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=3220518" target="_blank">
              Guåhan Goddesses 🇬🇺
            </a>
            <b />
          </p>
          <p>Not affiliated with Hattrick.org.</p>
        </div>
      </footer>
      <Analytics />
    </div>
  );
};
