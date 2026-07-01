export type TournamentAnnouncementVisibility = 'participants' | 'public';
export type TournamentAnnouncementSource = 'admin' | 'system';

export const JOINED_NOTICE_KEY = 'joined_notice';

export const ANNOUNCEMENT_TEMPLATES = [
  {
    id: 'new-user-guide',
    label: 'New user guide',
    content:
      'New here? Check Fixtures & Results for your next opponent, arrange the friendly in Hattrick, then come back after the match to follow results and standings.',
  },
  {
    id: 'schedule-change',
    label: 'Schedule change',
    content:
      'Attention: tournament schedule has been updated by organizer. Please check Fixtures & Results for details. If you have any questions, please ask in tournament chat.',
  },
] as const;

export interface TournamentAnnouncement {
  id: string;
  tournament_id: string;
  content: string;
  template_key: string | null;
  visibility: TournamentAnnouncementVisibility;
  source: TournamentAnnouncementSource;
  audience_ht_user_ids: number[] | null;
  is_active: boolean;
  created_by_name: string | null;
  created_by_ht_user_id: number | null;
  created_at: string;
  hidden_at: string | null;
}

export interface TournamentAnnouncementDismissal {
  id: string;
  tournament_id: string;
  announcement_id: string | null;
  notice_key: string | null;
  hattrick_user_id: number;
  dismissed_at: string;
}

export type TournamentMessageSelection =
  | { type: 'join' }
  | { type: 'joined_notice' }
  | { type: 'announcement'; announcement: TournamentAnnouncement }
  | null;

interface SelectTournamentMessageInput {
  canJoin: boolean;
  hasJoined: boolean;
  currentHtUserId: number | null;
  joinedNoticeDismissed: boolean;
  announcements: TournamentAnnouncement[];
  dismissedAnnouncementIds: Set<string>;
  publicDismissedAnnouncementIds: Set<string>;
}

function isAnnouncementVisibleToViewer(
  announcement: TournamentAnnouncement,
  currentHtUserId: number | null,
  dismissedAnnouncementIds: Set<string>,
  publicDismissedAnnouncementIds: Set<string>,
) {
  if (!announcement.is_active) return false;

  if (announcement.visibility === 'public') {
    return !publicDismissedAnnouncementIds.has(announcement.id);
  }

  if (!currentHtUserId || dismissedAnnouncementIds.has(announcement.id)) return false;
  return (announcement.audience_ht_user_ids ?? []).includes(currentHtUserId);
}

export function selectTournamentMessage({
  canJoin,
  hasJoined,
  currentHtUserId,
  joinedNoticeDismissed,
  announcements,
  dismissedAnnouncementIds,
  publicDismissedAnnouncementIds,
}: SelectTournamentMessageInput): TournamentMessageSelection {
  if (canJoin) return { type: 'join' };
  if (hasJoined && !joinedNoticeDismissed) return { type: 'joined_notice' };

  const visibleAnnouncement = announcements
    .filter((announcement) =>
      isAnnouncementVisibleToViewer(
        announcement,
        currentHtUserId,
        dismissedAnnouncementIds,
        publicDismissedAnnouncementIds,
      ),
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

  return visibleAnnouncement ? { type: 'announcement', announcement: visibleAnnouncement } : null;
}
