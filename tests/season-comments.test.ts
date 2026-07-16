import test from 'node:test';
import assert from 'node:assert/strict';
import { findOwnedSeasonParticipant, validateSeasonComment } from '../api/_lib/season-comments';

const snapshot = {
  participants: [
    { teamId: 'a', teamName: 'Team A', hattrickUserId: 1001, managerName: 'Manager A' },
    { teamId: 'b', teamName: 'Team B', hattrickUserId: 1001, managerName: 'Manager A' },
    { teamId: 'c', teamName: 'Team C', hattrickUserId: 1002, managerName: 'Manager C' },
  ],
};

test('comment validation preserves formatting and rejects empty or oversized input', () => {
  assert.deepEqual(validateSeasonComment('\n  Final words.\n\n'), { comment: '\n  Final words.\n\n', error: null });
  assert.ok(validateSeasonComment('   ').error);
  assert.ok(validateSeasonComment('x'.repeat(481)).error);
});

test('a manager can be matched to each of multiple frozen season teams', () => {
  assert.equal(findOwnedSeasonParticipant(snapshot, 'a', 1001)?.teamName, 'Team A');
  assert.equal(findOwnedSeasonParticipant(snapshot, 'b', 1001)?.teamName, 'Team B');
  assert.equal(findOwnedSeasonParticipant(snapshot, 'c', 1001), null);
  assert.equal(findOwnedSeasonParticipant(snapshot, 'missing', 1001), null);
});

test('legacy standings snapshots can still authorize their frozen owner', () => {
  const legacy = {
    standings: [{ teamId: 'legacy', teamName: 'Old Team', hattrickUserId: 2001, managerName: 'Old Manager' }],
  };
  assert.equal(findOwnedSeasonParticipant(legacy, 'legacy', 2001)?.teamName, 'Old Team');
});
