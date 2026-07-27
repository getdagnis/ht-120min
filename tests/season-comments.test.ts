import test from 'node:test';
import assert from 'node:assert/strict';
import { findSeasonParticipant, validateSeasonComment } from '../src/server/api/_lib/season-comments';

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
  assert.equal(findSeasonParticipant(snapshot, 'a')?.teamName, 'Team A');
  assert.equal(findSeasonParticipant(snapshot, 'b')?.teamName, 'Team B');
  assert.equal(findSeasonParticipant(snapshot, 'c')?.teamName, 'Team C');
  assert.equal(findSeasonParticipant(snapshot, 'missing'), null);
});

test('snapshot ownership is not required for later-linked teams', () => {
  const unlinked = {
    participants: [{ teamId: 'later-linked', teamName: 'Later Linked', hattrickUserId: null }],
  };
  assert.equal(findSeasonParticipant(unlinked, 'later-linked')?.teamName, 'Later Linked');
});

test('legacy standings snapshots can still authorize their frozen owner', () => {
  const legacy = {
    standings: [{ teamId: 'legacy', teamName: 'Old Team', hattrickUserId: 2001, managerName: 'Old Manager' }],
  };
  assert.equal(findSeasonParticipant(legacy, 'legacy')?.teamName, 'Old Team');
});
