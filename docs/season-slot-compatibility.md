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

## Forbidden shortcuts

- Do not write scheduled-team lifecycle fields from the browser.
- Do not insert a raw team for a known HT team.
- Do not rewrite completed fixture participants.
- Do not invoke or apply this migration until the named production preflight has
  passed for the exact FFC/Zermatt case.
- Do not extend this into registration, Season 2, global identity, credential,
  matchmaker, or scheduling work during peak season.

## Off-season target

After the season, replace the inconsistent legacy `teams` ownership model with
canonical manager/team identities, manager-scoped credentials, normalized
tournament registrations, and a deliberate historical migration. This document
does not authorize any part of that refactor.
