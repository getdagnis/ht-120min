import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOINED_NOTICE_KEY,
  selectTournamentMessage,
  type TournamentAnnouncement,
} from '../src/utils/tournament-announcements';

function announcement(overrides: Partial<TournamentAnnouncement> = {}): TournamentAnnouncement {
  return {
    id: overrides.id ?? 'announcement-1',
    tournament_id: overrides.tournament_id ?? 'tournament-1',
    content: overrides.content ?? 'Please check fixtures.',
    template_key: overrides.template_key ?? null,
    visibility: overrides.visibility ?? 'participants',
    source: overrides.source ?? 'admin',
    audience_ht_user_ids: overrides.audience_ht_user_ids ?? [1001],
    is_active: overrides.is_active ?? true,
    created_by_name: overrides.created_by_name ?? 'Tournament Administration',
    created_by_ht_user_id: overrides.created_by_ht_user_id ?? null,
    created_at: overrides.created_at ?? '2026-07-01T10:00:00.000Z',
    hidden_at: overrides.hidden_at ?? null,
  };
}

test('join prompt suppresses joined notice and announcements', () => {
  const selected = selectTournamentMessage({
    canJoin: true,
    hasJoined: false,
    currentHtUserId: null,
    joinedNoticeDismissed: false,
    announcements: [announcement({ visibility: 'public' })],
    dismissedAnnouncementIds: new Set(),
    publicDismissedAnnouncementIds: new Set(),
  });

  assert.equal(selected?.type, 'join');
});

test('joined notice suppresses announcements until dismissed', () => {
  const selected = selectTournamentMessage({
    canJoin: false,
    hasJoined: true,
    currentHtUserId: 1001,
    joinedNoticeDismissed: false,
    announcements: [announcement()],
    dismissedAnnouncementIds: new Set(),
    publicDismissedAnnouncementIds: new Set(),
  });

  assert.equal(selected?.type, 'joined_notice');
});

test('participant announcements are visible only to users in the audience snapshot', () => {
  const included = selectTournamentMessage({
    canJoin: false,
    hasJoined: true,
    currentHtUserId: 1001,
    joinedNoticeDismissed: true,
    announcements: [announcement({ audience_ht_user_ids: [1001] })],
    dismissedAnnouncementIds: new Set(),
    publicDismissedAnnouncementIds: new Set(),
  });
  const excluded = selectTournamentMessage({
    canJoin: false,
    hasJoined: true,
    currentHtUserId: 2002,
    joinedNoticeDismissed: true,
    announcements: [announcement({ audience_ht_user_ids: [1001] })],
    dismissedAnnouncementIds: new Set(),
    publicDismissedAnnouncementIds: new Set(),
  });

  assert.equal(included?.type, 'announcement');
  assert.equal(excluded, null);
});

test('dismissals hide participant and public announcements through the correct mechanism', () => {
  const participantAnnouncement = announcement({ id: 'participant', visibility: 'participants' });
  const publicAnnouncement = announcement({ id: 'public', visibility: 'public', created_at: '2026-07-01T11:00:00.000Z' });

  const selected = selectTournamentMessage({
    canJoin: false,
    hasJoined: true,
    currentHtUserId: 1001,
    joinedNoticeDismissed: true,
    announcements: [participantAnnouncement, publicAnnouncement],
    dismissedAnnouncementIds: new Set(['participant']),
    publicDismissedAnnouncementIds: new Set(['public']),
  });

  assert.equal(selected, null);
});

test('joined notice key is stable for database-backed dismissal', () => {
  assert.equal(JOINED_NOTICE_KEY, 'joined_notice');
});

