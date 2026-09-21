import React, { useRef, useState } from 'react';
import { CaretLeft, CaretRight, Handshake, Heart, X } from 'phosphor-react';
import { Button } from '../../components/Button/Button';
import {
  getDisplayTeamName,
  getMatchmakerBrowseAction,
  getMatchmakerDeckView,
  getMatchmakerMessagePlaceholder,
  getMatchmakerSwipePreviewOffset,
  resolveMatchmakerSwipe,
  type MatchmakerBrowseTab,
  type MatchmakerRequest,
} from '../../utils/matchmaker';
import styles from './Matchmaker.module.sass';
import deckStyles from './MatchmakerBrowseDeck.module.sass';

const DEFAULT_TEAM_LOGO = '/default-logo.png';
const DEFAULT_ARENA_IMAGE = 'https://res.hattrick.org/arenas/default/12000/custom-620-0.jpg';

export interface MatchmakerBrowseEntry {
  request: MatchmakerRequest;
  freshness: {
    label: string;
    tone: 'good' | 'warn' | 'bad';
  };
}

interface MatchmakerBrowseDeckProps {
  activeTab: MatchmakerBrowseTab;
  loading: boolean;
  entries: readonly MatchmakerBrowseEntry[];
  cursor: number;
  emptyMessage: string;
  endMessage: string;
  mockDataEnabled: boolean;
  onPostAd: () => void;
  onPrevious: () => void;
  onPass: () => void;
  onPrimaryAction: (request: MatchmakerRequest) => void;
  onRestart: () => void;
  onShowBooked: () => void;
  onShowAll: () => void;
}

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('button, a, input, select, textarea, label, [role="button"]');

const getCountryName = (request: MatchmakerRequest) => request.team?.country_name || undefined;

const getLocationLabel = (request: MatchmakerRequest) => {
  if (request.opponent_location === 'domestic') {
    return `Domestic (${getCountryName(request) || 'same country'})`;
  }
  if (request.opponent_location === 'international_only' || request.opponent_location === 'international') {
    return 'International only';
  }
  return 'Anywhere';
};

const getVenueLabel = (request: MatchmakerRequest) => {
  if (request.home_away === 'home') return 'My place';
  if (request.home_away === 'away') return 'Your place';
  return 'Either venue';
};

const getAvailabilityLabel = (request: MatchmakerRequest) => {
  if (request.team?.availabilityStatusRaw === null) return '404';
  if (request.team?.availabilityStatus === 'available') return 'Available';
  if (request.team?.availabilityStatus === 'booked' || request.team?.availabilityStatus === 'unavailable') {
    return 'Booked This Week';
  }
  return 'Unknown';
};

const TeamLogo = ({ request, className }: { request: MatchmakerRequest; className: string }) => (
  <img
    src={request.team?.logo_url || DEFAULT_TEAM_LOGO}
    alt={`${getDisplayTeamName(request.team?.name || 'Team', request.team?.gender_id)} logo`}
    className={className}
    draggable={false}
    onError={(event) => {
      event.currentTarget.onerror = null;
      event.currentTarget.src = DEFAULT_TEAM_LOGO;
    }}
  />
);

export const MatchmakerBrowseDeck: React.FC<MatchmakerBrowseDeckProps> = ({
  activeTab,
  loading,
  entries,
  cursor,
  emptyMessage,
  endMessage,
  mockDataEnabled,
  onPostAd,
  onPrevious,
  onPass,
  onPrimaryAction,
  onRestart,
  onShowBooked,
  onShowAll,
}) => {
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const deckView = getMatchmakerDeckView(entries, cursor);

  const resetSwipe = () => {
    swipeStartRef.current = null;
    setSwipeOffset(0);
    setIsSwiping(false);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (
      isInteractiveTarget(event.target) ||
      !event.isPrimary ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return;
    }

    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsSwiping(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setSwipeOffset(getMatchmakerSwipePreviewOffset(event.clientX - start.x, event.clientY - start.y));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== event.pointerId || deckView.status !== 'card') return;

    const action = resolveMatchmakerSwipe(event.clientX - start.x, event.clientY - start.y);
    const request = deckView.item.request;
    resetSwipe();

    if (action === 'next') onPass();
    if (action === 'challenge') onPrimaryAction(request);
  };

  if (loading) {
    return (
      <div className={styles.loadingState} role="status">
        <Handshake size={48} className={styles.spin} />
        <p>{mockDataEnabled ? 'Synchronising friendly availability...' : 'Checking team availability and loading listings...'}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={styles.emptyState} role="status">
        <Handshake size={64} opacity={0.2} />
        <p>{emptyMessage}</p>
        <Button variant="tinder" onClick={onPostAd}>
          Post an Ad
        </Button>
      </div>
    );
  }

  if (deckView.status === 'exhausted') {
    return (
      <div className={styles.emptyState} role="status">
        <Handshake size={64} opacity={0.2} />
        <p>{endMessage}</p>
        <div className={styles.endActions}>
          <Button variant="tinder" onClick={onRestart}>
            Start Again
          </Button>
          {mockDataEnabled && (
            <>
              <Button variant="outline" onClick={onShowBooked}>
                Show Booked Teams
              </Button>
              <Button variant="outline" onClick={onShowAll}>
                Show All Listings
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const entry = deckView.item;
  const request = entry.request;
  const action = getMatchmakerBrowseAction(activeTab, request);
  const primaryLabel = 'Send Challenge';
  const handlePrimaryAction = () => onPrimaryAction(request);
  const swipeStyle = { '--swipe-offset': `${swipeOffset}px` } as React.CSSProperties;
  const pointerHandlers = {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: resetSwipe,
    onLostPointerCapture: resetSwipe,
    onDragStart: (event: React.DragEvent<HTMLElement>) => event.preventDefault(),
  };

  return (
    <div className={`${styles.cardWrapper} ${styles.browseWrapper}`}>
      <button
        type="button"
        className={`${styles.navArrow} ${styles.navArrowLeft}`}
        onClick={onPrevious}
        disabled={cursor === 0}
        aria-label="Previous ad"
      >
        <CaretLeft />
      </button>

      <article
        className={`${styles.myRequestCard} ${deckStyles.desktopCard} ${deckStyles.dragCard} ${isSwiping ? deckStyles.dragging : ''}`}
        style={swipeStyle}
        aria-label={`${getDisplayTeamName(request.team?.name || 'Team', request.team?.gender_id)} friendly ad`}
        {...pointerHandlers}
      >
        <div className={styles.tinderCard}>
          <div className={styles.cardTop}>
            <div className={styles.cardArena}>
              {(request.team?.arena_image_url || request.team?.arena_id) && (
                <div className={styles.arenaFrame}>
                  <img
                    src={request.team.arena_image_url || DEFAULT_ARENA_IMAGE}
                    alt={`${getDisplayTeamName(request.team.name, request.team.gender_id)} arena`}
                    draggable={false}
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = DEFAULT_ARENA_IMAGE;
                    }}
                  />
                </div>
              )}
            </div>
            <div className={styles.cardRight}>
              <div className={styles.teamInfo}>
                <div className={styles.teamMain}>
                  <TeamLogo request={request} className={styles.teamLogo} />
                  <div className={styles.teamText}>
                    <h2 className={styles.teamName}>
                      {getDisplayTeamName(request.team?.name || '', request.team?.gender_id)}
                    </h2>
                    <div className={styles.teamMeta}>
                      {request.team?.league_id && (
                        <img
                          src={`https://www.hattrick.org/Img/flags/${request.team.league_id}.png`}
                          alt=""
                          className={styles.flag}
                        />
                      )}
                      <span>{getCountryName(request)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className={styles.message}>
                {request.message ? `"${request.message}"` : <strong>{getMatchmakerMessagePlaceholder(request)}</strong>}
              </div>
              <div className={styles.adProfileSummary}>
                <span className={styles.summaryLabel}>Looking for</span>
                <div className={styles.badges}>
                  <span className={styles.badge}>
                    {request.match_type === '120min' ? '120 min training' : '90 min acceptable'}
                  </span>
                  <span className={styles.badge}>{getVenueLabel(request)}</span>
                  <span className={styles.badge}>{getLocationLabel(request)}</span>
                  <span className={styles.badge}>{request.is_long_term ? 'Long-term partner' : 'One-off match'}</span>
                  {request.is_back_and_forth && <span className={styles.badge}>Home/away exchange</span>}
                </div>
              </div>
              <div className={styles.adMetaRow}>
                <span className={`${styles.availabilityBadge} ${styles[entry.freshness.tone]}`}>{entry.freshness.label}</span>
                <span
                  className={`${styles.stateBadge} ${styles[request.team?.availabilityStatus || 'unknown']}`}
                  title={request.team?.availabilityReason || 'Availability from CHPP team details.'}
                >
                  {getAvailabilityLabel(request)}
                </span>
                {request.is_mock && <span className={styles.mockBadge}>Mock</span>}
              </div>
            </div>
          </div>
        </div>
        <div className={styles.cardActions} aria-label="Ad actions">
          <Button variant="outline" onClick={onPass}>
            Pass <X size={20} />
          </Button>
          <Button variant="tinder" onClick={handlePrimaryAction}>
            {action === 'challenge' ? <Handshake size={20} /> : <Heart size={20} weight="fill" />}
            {primaryLabel}
          </Button>
        </div>
      </article>

      <article
        className={`${deckStyles.mobileCard} ${deckStyles.dragCard} ${isSwiping ? deckStyles.dragging : ''}`}
        style={swipeStyle}
        aria-label={`${getDisplayTeamName(request.team?.name || 'Team', request.team?.gender_id)} friendly ad`}
        {...pointerHandlers}
      >
        <div className={deckStyles.mobileBody}>
          <div className={deckStyles.mobileIdentity}>
            <TeamLogo request={request} className={deckStyles.mobileLogo} />
            <div className={deckStyles.mobileTeamText}>
              <h2>{getDisplayTeamName(request.team?.name || '', request.team?.gender_id)}</h2>
              <div className={deckStyles.mobileMeta}>
                {request.team?.league_id && (
                  <img src={`https://www.hattrick.org/Img/flags/${request.team.league_id}.png`} alt="" />
                )}
                <span>{getCountryName(request)}</span>
              </div>
            </div>
          </div>
          <p className={deckStyles.mobileMessage}>
            {request.message ? `"${request.message}"` : getMatchmakerMessagePlaceholder(request)}
          </p>
          <div className={deckStyles.mobileProfile}>
            <span className={deckStyles.mobileSummaryLabel}>Looking for</span>
            <div className={deckStyles.mobileBadges}>
              <span>{request.match_type === '120min' ? '120 min training' : '90 min acceptable'}</span>
              <span>{getVenueLabel(request)}</span>
              <span>{getLocationLabel(request)}</span>
              <span>{request.is_long_term ? 'Long-term partner' : 'One-off match'}</span>
              {request.is_back_and_forth && <span>Home/away exchange</span>}
            </div>
          </div>
          <div className={deckStyles.mobileStatus}>
            <span>{entry.freshness.label}</span>
            <span>{getAvailabilityLabel(request)}</span>
          </div>
        </div>
        <div className={deckStyles.mobileActions} aria-label="Ad actions">
          <Button variant="outline" onClick={onPass}>
            Pass <X size={20} />
          </Button>
          <Button variant="tinder" onClick={handlePrimaryAction}>
            {primaryLabel}
            {action === 'challenge' ? <Handshake size={20} /> : <Heart size={20} weight="fill" />}
          </Button>
        </div>
      </article>

      <button type="button" className={`${styles.navArrow} ${styles.navArrowRight}`} onClick={onPass} aria-label="Next ad">
        <CaretRight />
      </button>
    </div>
  );
};
