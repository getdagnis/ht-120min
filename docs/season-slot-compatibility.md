# Peak-season season-slot compatibility

## Decision

This is a deliberately narrow compatibility layer for one already-generated, current
season. `teams` remains the legacy tournament identity/credential record. A
`tournament_season_slot` is the durable physical place in that season's fixture
box, and a `tournament_season_slot_assignment` records who occupied it, including
a frozen public identity snapshot. A match retains its legacy team columns, but
also records its home/away slot and the assignment that was current when that
side was written.

Consequently, completed fixtures retain the former team's frozen assignment,
while standings aggregate by slot and render the slot's current assignment. An
incomplete fixture is deliberately moved to the incoming existing team row, but
keeps the same slot.

## Invariants

- One slot exists per deterministic current-season position; only one live
  assignment may occupy a slot.
- A known Hattrick team is reused from its existing `teams` row. This operation
  never inserts a team or moves credentials.
- Completed `matches.home_team_id` / `away_team_id` and their assignment IDs are
  never rewritten.
- Incomplete sides change team identity and retain their slot.
- Removing a current-season team releases its live assignment and sets the slot's
  `current_team_id` to `NULL`; only incomplete fixture sides are vacated. A slot
  with completed results remains visible in standings through its historical
  fixture identity until it is filled again.
- The replacement RPC is one transaction and is the only write path for this
  compatibility operation. Browser clients receive no slot-table write policy.
- Legacy seasons without slots keep their existing team-based reads.

## Allowed operation

`replace_known_team_in_current_season` accepts the tournament/current-season,
the outgoing team and an existing incoming HT ID. The API authenticates the
organizer/delegated operational role before invoking it using the service role.
The RPC locks the tournament, both rows, current-season fixtures and slots; it
creates a deterministic backfill only when all participating fixture sides map
unambiguously, then atomically releases the old assignment, assigns the incoming
team, clears its reapply marker, and changes only incomplete fixture sides.

## Hard preflight and rollback boundary

Before production use, run the read-only query in
`docs/season-slot-compatibility-preflight.sql`. It must identify exactly one
outgoing slot, one existing credential-bearing incoming row, no duplicate HT
identity, no blocking tournament participation, a consistent replacement
lineage, and the exact completed/incomplete fixture list and slot totals. Any
missing credential, duplicate, cross-tournament conflict, ambiguous lineage or
fixture-side mismatch is a hard stop: do not repair production data manually.

The database transaction is the rollback boundary: a rejected precondition rolls
back all new slots, assignments, and match changes. A successful live action is
not a general undo workflow; investigate from the recorded assignment history.

## Current-season removal and reset

The server-authorized scheduled-team removal action vacates the outgoing team's
current slot instead of deleting it. Completed fixtures and assignment snapshots
remain immutable; future incomplete sides become empty/BYE sides. The existing
replacement flow can fill a released slot by using the former team's released
assignment as the slot lineage.

Admin Manage Teams displays active participants, Past teams, and reserves as
separate groups. A manager's open-registration leave sets the existing Past
representation (`active = false`, `reserve_active = false`). For a generated
season, **Replace** on a Past row selects an existing reserve and targets that
row's released slot. Migration `126_past_team_admin_actions.sql` prepares the
service-role-only transactional fill and a separate removal RPC that refuses
teams with relational or season-snapshot history. Protected bookings and
completed fixtures cannot be changed by this fill. The migration is not
agent-applied; its API/UI must be deployed only with the matching database RPCs.

A verified site admin may promote a reserve into an existing vacant current-
season slot even when that Hattrick team is active in another exclusive
tournament. Migration `127_site_admin_reserve_promotion_membership_bypass.sql`
adds a service-role-only wrapper around the existing guarded fill RPC; slot
lineage and protected-fixture checks still apply. The owner reports applying
the migration to production Supabase on 2026-10-16; this was not independently
verified.

A verified site admin can promote a reserve past `max_teams` after confirming a
warning. The owner reports applying migrations `131` and `132`; their applied
markers are preserved, but this agent did not inspect live schema state.
Migration `133_site_admin_season_participation.sql` is prepared locally to
correct the roster-only promotion from 131. For a generated season it atomically
restores that club's own released slot through the guarded fill RPC, including
eligible unplayed fixture sides, or assigns a new slot and frozen team identity
for the next regular round of a staged length schedule. Filling another club's
vacant slot remains a separate explicit action because the incoming club then
inherits that slot's historical standings line. New slots appear in standings
immediately; the current round is not changed by a single-team addition. The
existing paired reserve admission is the way to add new fixtures to the current
regular round. A generated legacy schedule with no vacancy, or a staged season
without a future regular round, has no safe single-team scheduling path and
rejects that promotion. Ordinary organizers retain their existing guards.

Migration 133 also replaces the site-admin removal/demotion RPC from applied
132: a released assignment or completed fixture remains history, while an
unresolved fixture still blocks slotless reclassification. A slotted removal
continues to use the guarded vacate RPC; demoting a slotted team still requires
removal first. The owner must apply 133 before deploying its matching API/UI.
No migration or production data change was performed by the agent; live
promotion, reversal, standings and scheduling remain unverified.

An ongoing current season can also be reset to planning before any match is
ongoing or finished. The atomic reset clears only that season's rounds, matches,
and generated slot state, resets the season lifecycle fields, and preserves the
current registration-closed state. Historical season rows are not changed.

### Manager-requested departure after a round

Migration `125_deferred_team_departures.sql` prepares a private, one-request-per-team
departure record. An authenticated manager can check or uncheck **Leave tournament
after round is finished** while their team occupies a current-season slot. The
request names the current materialized round; it does not alter that round's
fixture or Hattrick booking. Operational admins see active requests above
Tournament Settings.

When the staged round transition marks that round completed, a deferred database
trigger runs after the next round's fixtures are materialized. It reuses the
guarded `vacate_team_slot_in_current_season` operation, so completed history stays
and future incomplete sides become vacant. A later booked/started fixture or
another removal guard leaves the request in place for organizer review rather
than blocking round completion. Direct admin Remove remains immediate. The
manager request currently relies on staged rounds reaching `phase_status =
'completed'`; legacy schedules without that transition need organizer handling.

Migration 125 is prepared locally and must be applied before deploying the API
and UI. No live database, CHPP or browser behavior is claimed from the local code.

## Forbidden shortcuts

- Do not write scheduled-team lifecycle fields from the browser.
- Do not insert a raw team for a known HT team.
- Do not rewrite completed fixture participants.
- Do not invoke or apply the season-slot migration until the named production
  preflight has passed for the exact FFC/Zermatt case.
- Do not extend this into registration, Season 2, global identity, credential,
  matchmaker, or scheduling work during peak season.

## Off-season target

After the season, replace the inconsistent legacy `teams` ownership model with
canonical manager/team identities, manager-scoped credentials, normalized
tournament registrations, and a deliberate historical migration. This document
does not authorize any part of that refactor.

## Same-club validation and restoration

Operational admins can use **Validate known team** on an active participant as
well as on a reserve. The participant action verifies current token-owner team
membership and updates only ownership metadata on the existing tournament row.
It does not re-register the team, change eligibility, move the source credential row, or change slots and fixtures. Existing credential resolution is reused.

Prepared migration `120_restore_same_team_to_vacant_slot.sql` lets **Fill vacant
slot** restore the same Hattrick club recorded by the slot's latest released
assignment. It prefers that club's former slot, preserves arranged status and
Hattrick match links, and still rejects started, completed-status, scored or
otherwise protected incomplete fixtures. Different-club fills keep the original
unlinked/unarranged guard. Completed fixtures remain untouched. The patch aborts
on unexpected installed function source and retains the lifecycle lock from 113.
Migration 120 is unapplied by the agent; real Supabase/CHPP and UI restoration
remain unverified.
