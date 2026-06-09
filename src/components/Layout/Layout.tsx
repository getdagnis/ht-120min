import React, { useState, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Trophy, Sun, Moon, Plus, ArrowRight, User } from 'phosphor-react';
import { scroller } from 'react-scroll';
import { Button } from '../Button/Button';
import styles from './Layout.module.sass';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
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

  const isCreatePage = location.pathname.startsWith('/create');
  const isTournamentPage = location.pathname.startsWith('/t/');
  const managerName = localStorage.getItem('my_ht_manager_name');

  const handleActionClick = () => {
    if (isCreatePage) {
      if (location.pathname !== '/') {
        navigate('/');
        setTimeout(() => {
          scroller.scrollTo('opentours', {
            duration: 800,
            smooth: true,
            offset: -100,
          });
        }, 100);
      } else {
        scroller.scrollTo('opentours', {
          duration: 800,
          smooth: true,
          offset: -100,
        });
      }
    } else if (isTournamentPage) {
      const tid = localStorage.getItem('last_viewed_tournament_id');
      if (tid) {
        window.location.href = `/api/auth/init?tournament_id=${tid}`;
      } else {
        window.location.href = '/api/auth/init?is_creation=true';
      }
    } else {
      navigate('/create');
    }
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
                {theme === 'dark' ? <Sun size={20} weight="bold" /> : <Moon size={20} weight="bold" />}
              </Button>
              <Button size="sm" onClick={handleActionClick} variant="zero" className={styles.createBtn}>
                {isCreatePage ? (
                  <>
                    <ArrowRight size={18} weight="bold" /> <span className={styles.hideMobile}>JOIN TOURNAMENT</span>
                  </>
                ) : isTournamentPage ? (
                  managerName ? (
                    <>
                      <User size={18} weight="bold" /> <span className={styles.hideMobile}>{managerName}</span>
                    </>
                  ) : (
                    <>
                      <ArrowRight size={18} weight="bold" /> <span className={styles.hideMobile}>{'Login (CHPP)'}</span>
                    </>
                  )
                ) : (
                  <>
                    <Plus size={18} weight="bold" /> <span className={styles.hideMobile}>CREATE TOURNAMENT</span>
                  </>
                )}
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
