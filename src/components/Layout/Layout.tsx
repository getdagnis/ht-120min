import React, { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';

import { Link, useNavigate } from 'react-router-dom';
import { Lineicons } from '@lineiconshq/react-lineicons';
import { Trophy1Outlined, MoonHalfRight5Outlined, Sun1Outlined, PlusOutlined } from '@lineiconshq/free-icons';
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

  // const [userData, setUserData] = useState(() => ({
  //   managerName: localStorage.getItem('my_ht_manager_name'),
  //   teamName: localStorage.getItem('my_ht_team_name'),
  // }));

  // TODO: reintroduce with user icon
  // Listen for storage changes to update user data UI
  // useEffect(() => {
  //   const handleStorageChange = () => {
  //     setUserData({
  //       managerName: localStorage.getItem('my_ht_manager_name'),
  //       teamName: localStorage.getItem('my_ht_team_name'),
  //     });
  //   };

  //   window.addEventListener('storage', handleStorageChange);
  //   // Also check on a timer or navigation because storage event only fires for other windows
  //   const interval = setInterval(handleStorageChange, 2000);

  //   return () => {
  //     window.removeEventListener('storage', handleStorageChange);
  //     clearInterval(interval);
  //   };
  // }, []);

  // TODO: reintroduce with user icon
  // const userTooltip = userData.managerName
  //   ? `Logged in as ${userData.managerName}${userData.teamName ? ` (${userData.teamName})` : ''}`
  //   : 'Not logged in';

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.container}>
          <div className={styles.headerContent}>
            <Link to="/" className={styles.logo}>
              <Lineicons icon={Trophy1Outlined} className={styles.icon} size={28} />
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
                  <Lineicons icon={Sun1Outlined} size={20} />
                ) : (
                  <Lineicons icon={MoonHalfRight5Outlined} size={20} />
                )}
              </Button>
              {/* TODO: reintroduce user indicator */}
              {/* {userData.managerName && (
                <div className={styles.userIndicator} title={userTooltip}>
                  <Lineicons icon={User4Outlined} size={20} />
                </div>
              )} */}
              <Button size="sm" onClick={() => navigate('/create')} variant="zero" className={styles.createBtn}>
                <Lineicons icon={PlusOutlined} size={18} /> <span className={styles.hideMobile}>CREATE TOURNAMENT</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
      <footer className={styles.footer}>
        <div className={styles.container}>
          {/* user written content: do not change */}
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
