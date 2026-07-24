import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTournamentAccess } from '../api/_lib/tournament-access.js';

const base = {
  viewerUserId: 10,
  viewerManagerName: 'Manager',
  organizerId: 20,
};

test('original organizer has organizer access regardless of password state', () => {
  const access = resolveTournamentAccess({ ...base, viewerUserId: 20, explicitRole: 'admin' });
  assert.equal(access.actualRole, 'original_organizer');
  assert.equal(access.effectiveRole, 'original_organizer');
  assert.equal(access.canManageOperations, true);
  assert.equal(access.canManageCoOrganizer, true);
});

test('co-organizer manages admins and press officer but not co-organizer', () => {
  const access = resolveTournamentAccess({ ...base, explicitRole: 'co_organizer' });
  assert.equal(access.canManageOperations, true);
  assert.equal(access.canManageAdmins, true);
  assert.equal(access.canManagePressOfficer, true);
  assert.equal(access.canManageCoOrganizer, false);
});

test('tournament admin is operational but read-only for roles', () => {
  const access = resolveTournamentAccess({ ...base, explicitRole: 'admin' });
  assert.equal(access.canManageOperations, true);
  assert.equal(access.canViewRoles, true);
  assert.equal(access.canManageAdmins, false);
  assert.equal(access.canManagePressOfficer, false);
});

test('press officer can publish announcements without admin or role-list access', () => {
  const access = resolveTournamentAccess({ ...base, explicitRole: 'press_officer' });
  assert.equal(access.canViewAdmin, true);
  assert.equal(access.canPublishAnnouncements, true);
  assert.equal(access.canManageOperations, false);
  assert.equal(access.canViewRoles, false);
});

test('implicit superadmin gets effective organizer access without an artificial actual role', () => {
  const access = resolveTournamentAccess({ ...base, isImplicitSuperadmin: true });
  assert.equal(access.actualRole, null);
  assert.equal(access.effectiveRole, 'original_organizer');
  assert.equal(access.isImplicitSuperadmin, true);
  assert.equal(access.canManageCoOrganizer, true);
});

test('a real role remains visible when the same user is also an implicit superadmin', () => {
  const access = resolveTournamentAccess({ ...base, explicitRole: 'admin', isImplicitSuperadmin: true });
  assert.equal(access.actualRole, 'admin');
  assert.equal(access.effectiveRole, 'admin');
  assert.equal(access.isImplicitSuperadmin, true);
  assert.equal(access.canManageAdmins, true);
  assert.equal(access.canManageCoOrganizer, true);
});

test('unassigned viewers have no tournament access', () => {
  const access = resolveTournamentAccess(base);
  assert.equal(access.canViewAdmin, false);
  assert.equal(access.effectiveRole, null);
});
