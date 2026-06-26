import React, { useState, useEffect, useRef } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Trophy,
  Sun,
  Moon,
  Plus,
  ArrowRight,
  CaretDown,
  IdentificationCard,
  SignOut,
  Clock,
  User,
  Handshake,
} from 'phosphor-react';
import { scroller } from 'react-scroll';
import { Button } from '../Button/Button';
import { useAuth } from '../../hooks/useAuth';
import { ProfileModal } from '../ProfileModal/ProfileModal';
import { BeerBanner } from '../BeerBanner/BeerBanner';
import styles from './Layout.module.sass';

interface LayoutProps {
  children: React.ReactNode;
}

const VISIT_COUNT_KEY = 'visitCount';
const LAST_VISIT_DAY_KEY = 'visitCountLastDay';

function getTodayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getVisitCount() {
  const todayKey = getTodayKey();
  const storedCount = Number(localStorage.getItem(VISIT_COUNT_KEY) || '0');
  const lastVisitDay = localStorage.getItem(LAST_VISIT_DAY_KEY);

  if (lastVisitDay !== todayKey) {
    const nextCount = storedCount + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(nextCount));
    localStorage.setItem(LAST_VISIT_DAY_KEY, todayKey);
    return nextCount;
  }

  return storedCount;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { managerName, profile, activeTournaments, logout } = useAuth();
  const [visitCount] = useState(() => getVisitCount());

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  const isProfileModalOpen = !!searchParams.get('profileId');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const isCreatePage = location.pathname.startsWith('/create');

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
    } else {
      navigate('/create');
    }
  };

  const handleLogin = () => {
    // Pure login: no tournament_id, no is_creation
    document.cookie = `auth_return_url=${encodeURIComponent(location.pathname + location.search)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
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

              <div className="hideOnMobile">
                <Button size="sm" onClick={handleActionClick} variant="zero" className={styles.actionBtn}>
                  {isCreatePage ? (
                    <>
                      <ArrowRight size={18} weight="bold" />{' '}
                      <span className={styles.hideMobile}>JOIN A TOURNAMENT</span>
                    </>
                  ) : (
                    <>
                      <Plus size={18} weight="bold" /> <span className={styles.hideMobile}>CREATE TOURNAMENT</span>
                    </>
                  )}
                </Button>
              </div>

              <div className={styles.userContainer} ref={dropdownRef}>
                {managerName ? (
                  <>
                    <Button
                      size="sm"
                      variant="zero"
                      className={styles.userBtn}
                      onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                    >
                      <User size={18} weight="bold" />
                      <span className={styles.hideMobile}>{managerName}</span>
                      <CaretDown size={14} weight="bold" />
                    </Button>

                    {isUserDropdownOpen && (
                      <div className={styles.dropdown}>
                        {activeTournaments.length > 0 && (
                          <div className={styles.dropdownInfo}>
                            <span>Active in:</span>
                            <div className={styles.activeTournamentsList}>
                              {activeTournaments.map((t) => (
                                <div key={t.id} className={styles.tourItem}>
                                  <Link
                                    to={`/t/${t.slug}`}
                                    className={styles.dropdownLink}
                                    onClick={() => setIsUserDropdownOpen(false)}
                                  >
                                    {t.name}
                                  </Link>
                                  {t.nextMatchDate && (
                                    <div className={styles.tourNextMatch} title="Next Match">
                                      <Clock size={12} weight="bold" />
                                      {t.nextMatchDate.toLocaleDateString('lv-LV', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <button
                          className={styles.dropdownItem}
                          onClick={() => {
                            navigate('/tinder');
                            setIsUserDropdownOpen(false);
                          }}
                        >
                          <Handshake size={18} />
                          120 min Tinder
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={() => {
                            navigate(`?profileId=${profile?.hattrick_user_id}`);
                            setIsUserDropdownOpen(false);
                          }}
                        >
                          <IdentificationCard size={18} />
                          My Profile
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={() => {
                            logout();
                            setIsUserDropdownOpen(false);
                            window.location.reload();
                          }}
                        >
                          <SignOut size={18} />
                          Logout
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <Button size="sm" onClick={handleLogin} variant="zero" className={styles.loginBtn}>
                    <User size={18} weight="bold" />
                    <span className={styles.hideMobile}>Login (CHPP)</span>{' '}
                    <ArrowRight size={18} className="hideOnTable" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          {visitCount >= 3 && <BeerBanner />}
          <p>
            © {new Date().getFullYear()}
            <span className="mr-sm" />
            <a href="http://getdagnis.vercel.app" target="_blank">
              mr_bots a.k.a. getdagnis
            </a>
            <span style={{ marginRight: '0.25rem' }}>🇱🇻</span>
            manager of{' '}
            <a href="https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=681813" target="_blank">
              This bot team is a bot
            </a>
            <span style={{ marginRight: '0.25rem' }}>🇱🇻</span> and{' '}
            <a href="https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=3220518" target="_blank">
              Guåhan Goddesses 🇬🇺
            </a>
            <b />
          </p>
          <a href="https://stage.hattrick.org/MyHattrick/Inbox/?actionType=newMail&userId=8777402" target="_blank">
            Enough dancing in the streets, send me a HT love poem!
          </a>{' '}
          💌
          <p className={styles.affiliated}>Not affiliated with Hattrick Ltd.</p>
        </div>
      </footer>

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => navigate(location.pathname, { replace: true })}
        profileId={searchParams.get('profileId') ? Number(searchParams.get('profileId')) : null}
        ownProfile={profile}
        activeTournaments={activeTournaments}
        maxWidth="620px"
      />

      <Analytics />
    </div>
  );
};
