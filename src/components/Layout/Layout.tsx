'use client';

import React, { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import { usePresenceHeartbeat } from '../../hooks/usePresenceHeartbeat';
import { useActivityTracking } from '../../hooks/useActivityTracking';
import { ProfileModal } from '../ProfileModal/ProfileModal';
import { BeerBanner } from '../BeerBanner/BeerBanner';
import { TeamOwnershipReclaim } from '../TeamOwnershipReclaim/TeamOwnershipReclaim';
import { LocaleSwitcher } from '../../i18n/LocaleSwitcher';
import { useLocale } from '../../i18n/LocaleProvider';
import { toLocalePath } from '../../next/locale-path';
import styles from './Layout.module.sass';

interface LayoutProps {
  children: React.ReactNode;
}

const VISIT_COUNT_KEY = 'visitCount';
const LAST_VISIT_DAY_KEY = 'visitCountLastDay';
const THEME_CHANGED_EVENT = 'ht-120min:theme-changed';
type ThemePreference = 'light' | 'dark' | 'system';

function getTodayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getVisitCount() {
  if (typeof window === 'undefined') return 0;
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

function subscribeToTheme(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_CHANGED_EVENT, callback);
  };
}

function getThemeSnapshot(): ThemePreference {
  const storedTheme = localStorage.getItem('theme');
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'system';
}

function getServerThemeSnapshot(): ThemePreference {
  return 'system';
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const isTinderPage = pathname.endsWith('/matchmaker') || pathname.endsWith('/tinder');
  const isMockMatchmakerRoute = isTinderPage && process.env.NEXT_PUBLIC_MATCHMAKER_MOCK_DATA === 'true';
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const currentUrl = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const {
    managerName,
    profile,
    activeTournaments,
    finishedTournaments,
    organizerTournaments,
    testTournaments,
    logout,
    refreshProfile,
    authReady,
  } = useAuth();
  usePresenceHeartbeat(!!managerName, currentUrl, !isMockMatchmakerRoute);
  useActivityTracking(currentUrl, !isMockMatchmakerRoute);
  const visibleOrganizerTournaments = useMemo(() => {
    const activeTournamentIds = new Set(activeTournaments.map((tournament) => tournament.id));
    return organizerTournaments.filter((tournament) => !activeTournamentIds.has(tournament.id));
  }, [activeTournaments, organizerTournaments]);

  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isProfileModalOpen = !!searchParams.get('profileId');
  const authError = searchParams.get('auth_error');
  const authErrorReference = searchParams.get('auth_error_ref');

  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    getVisitCount();
  }, []);

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
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
  };

  const isCreatePage = pathname === `/${locale}/create` || pathname.startsWith(`/${locale}/create/`);

  const handleActionClick = () => {
    if (isCreatePage) {
      if (location.pathname !== '/') {
        router.push(toLocalePath(locale, '/'));
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
      router.push(toLocalePath(locale, '/create'));
    }
  };

  const handleLogin = () => {
    // Pure login: no tournament_id, no is_creation
    document.cookie = `auth_return_url=${encodeURIComponent(currentUrl)}; path=/; max-age=300`;
    window.location.href = '/api/auth/init';
  };

  const dismissAuthError = () => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('auth_error');
    nextParams.delete('auth_error_ref');
    const query = nextParams.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`);
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.container}>
          <div className={styles.headerContent}>
            <Link href={toLocalePath(locale, '/')} className={styles.logo}>
              <Trophy size={28} weight="bold" className={styles.icon} />
              <span>HT-120min</span>
            </Link>

            <div className={styles.actions}>
              <LocaleSwitcher />
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
                {!authReady ? (
                  <div className={styles.authPlaceholder} aria-hidden="true" />
                ) : managerName ? (
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
                                    href={toLocalePath(locale, `/t/${t.slug}`)}
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
                                        timeZone: 'Europe/Riga',
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
                                    href={toLocalePath(locale, `/t/${t.slug}`)}
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
                                    href={toLocalePath(locale, `/t/${t.slug}`)}
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
                                    href={toLocalePath(locale, `/t/${t.slug}`)}
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
                            router.push(toLocalePath(locale, '/tinder'));
                            setIsUserDropdownOpen(false);
                          }}
                        >
                          <Handshake size={18} />
                          120 min Tinder
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={() => {
                            router.push(`${pathname}?profileId=${profile?.hattrick_user_id}`);
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
                            router.refresh();
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
                {authErrorReference && (
                  <>
                    {' '}
                    Reference: <code>{authErrorReference}</code>
                  </>
                )}
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
          <BeerBanner key={currentUrl} variant={isTinderPage ? 'tinder' : 'default'} />
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
        <h3>Rate this app on Hattrick!</h3>
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
        onClose={() => router.replace(pathname)}
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
