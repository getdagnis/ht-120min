import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Shield,
} from 'phosphor-react';
import { scroller } from 'react-scroll';
import { Button } from '../Button/Button';
import { useAuth } from '../../hooks/useAuth';
import { usePresenceHeartbeat } from '../../hooks/usePresenceHeartbeat';
import { ProfileModal } from '../ProfileModal/ProfileModal';
import { BeerBanner } from '../BeerBanner/BeerBanner';
import { TeamOwnershipReclaim } from '../TeamOwnershipReclaim/TeamOwnershipReclaim';
import { FORGE_SUPERADMIN_USER_ID } from '../../constants/site-admins';
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
  const {
    managerName,
    profile,
    activeTournaments,
    finishedTournaments,
    organizerTournaments,
    testTournaments,
    logout,
    refreshProfile,
  } = useAuth();
  usePresenceHeartbeat(!!managerName, `${location.pathname}${location.search}`);
  const [visitCount] = useState(() => getVisitCount());
  const visibleOrganizerTournaments = useMemo(() => {
    const activeTournamentIds = new Set(activeTournaments.map((tournament) => tournament.id));
    return organizerTournaments.filter((tournament) => !activeTournamentIds.has(tournament.id));
  }, [activeTournaments, organizerTournaments]);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  const isProfileModalOpen = !!searchParams.get('profileId');
  const authError = searchParams.get('auth_error');
  const authErrorReference = searchParams.get('auth_error_ref');

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

  const dismissAuthError = () => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete('auth_error');
    nextParams.delete('auth_error_ref');
    navigate(
      { pathname: location.pathname, search: nextParams.toString() ? `?${nextParams.toString()}` : '' },
      { replace: true },
    );
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
                            <span>ACTIVE:</span>
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
                        {finishedTournaments.length > 0 && (
                          <div className={styles.dropdownInfo}>
                            <span>Finished:</span>
                            <div className={styles.activeTournamentsList}>
                              {finishedTournaments.map((t) => (
                                <div key={t.id} className={styles.tourItem}>
                                  <Link
                                    to={`/t/${t.slug}`}
                                    className={styles.dropdownLink}
                                    onClick={() => setIsUserDropdownOpen(false)}
                                  >
                                    {t.name}
                                  </Link>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {visibleOrganizerTournaments.length > 0 && (
                          <div className={styles.dropdownInfo}>
                            <span>Organizer:</span>
                            <div className={styles.activeTournamentsList}>
                              {visibleOrganizerTournaments.map((t) => (
                                <div key={t.id} className={styles.tourItem}>
                                  <Link
                                    to={`/t/${t.slug}`}
                                    className={styles.dropdownLink}
                                    onClick={() => setIsUserDropdownOpen(false)}
                                  >
                                    {t.name}
                                  </Link>
                                  {t.status && <div className={styles.tourStatus}>{t.status}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {testTournaments.length > 0 && (
                          <div className={styles.dropdownInfo}>
                            <span>Test tournaments:</span>
                            <div className={styles.activeTournamentsList}>
                              {testTournaments.map((t) => (
                                <div key={t.id} className={styles.tourItem}>
                                  <Link
                                    to={`/t/${t.slug}`}
                                    className={styles.dropdownLink}
                                    onClick={() => setIsUserDropdownOpen(false)}
                                  >
                                    {t.name}
                                  </Link>
                                  {t.status && <div className={styles.tourStatus}>{t.status}</div>}
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
                        {profile?.hattrick_user_id === FORGE_SUPERADMIN_USER_ID && (
                          <button
                            className={styles.dropdownItem}
                            onClick={() => {
                              navigate('/forge');
                              setIsUserDropdownOpen(false);
                            }}
                          >
                            <Shield size={18} />
                            Forge
                          </button>
                        )}
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

      <main className={styles.main}>
        {authError && (
          <section className={styles.authFailure} role="alert">
            <div>
              <h2>Hattrick login is temporarily unavailable</h2>
              <p>
                The site is still available, but the login connection could not be completed. Please try again shortly.
                {authErrorReference && <> Reference: <code>{authErrorReference}</code></>}
              </p>
            </div>
            <div className={styles.authFailureActions}>
              <Button size="sm" variant="primary" onClick={handleLogin}>
                <User size={18} weight="bold" /> Try login again
              </Button>
              <a
                className={styles.authFailureLink}
                href={`https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=8777402`}
                target="_blank"
                rel="noreferrer"
              >
                Report this problem
              </a>
              <button type="button" className={styles.authFailureDismiss} onClick={dismissAuthError}>
                Dismiss
              </button>
            </div>
          </section>
        )}
        {children}
      </main>

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
          <a
            href="https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=8777402"
            target="_blank"
          >
            Send me a HT message!
          </a>{' '}
          💌
          <p className={styles.affiliated}>Not affiliated with Hattrick Ltd.</p>
        </div>
        <h3>Rate us!</h3>
        <a
          href="https://www.hattrick.org/goto.ashx?path=/Community/CHPP/ChppProgramDetails.aspx?ApplicationId=5363"
          target="_blank"
        >
          <div className={styles.chpp}>
            <img src="/svg/chpp.svg" alt="CHPP product page" width={80} />
          </div>
        </a>
      </footer>

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => navigate(location.pathname, { replace: true })}
        profileId={searchParams.get('profileId') ? Number(searchParams.get('profileId')) : null}
        ownProfile={profile}
        activeTournaments={activeTournaments}
        maxWidth="620px"
      />

      <TeamOwnershipReclaim profile={profile} onClaimed={refreshProfile} />

      <Analytics />
    </div>
  );
};
