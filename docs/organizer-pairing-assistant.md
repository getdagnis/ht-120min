# Organizer pairing assistant

## Product contract

The existing additional-round editor now supports slot-specific availability,
cached flag collections, manager-first flag proposals, editable/CSV previews,
draft repair, and a separately selected saved organizer-round repair. It reuses
the existing round creation, membership, standings, and booking paths. Frozen-plan
rounds and the historical approved Around the World opener are unchanged.

Practical quality is the goal: some imperfect pairings are acceptable. This is a
bounded heuristic with manual corrections, not a guarantee of optimal allocation.
No new scheduling engine, autonomous booking, background scans, or challenge
cancellation is introduced. No fixture styles have been redesigned.

Initial proposals prioritize matching cardinality, managers with at least one
confirmed gain, scarcity, total gains, rarity, then repeats/secondary tie-breaks.
The private Forge scarcity playground retains its old default scoring; the
organizer adapter opts into manager-first scoring explicitly. Known same-manager
and conflicting-gender pairs are excluded automatically and rejected on save.
Unknown manager identity cannot establish a compatible automatic pairing.
Unknown flags do not exclude an otherwise available team. Unknown availability
does. Rematches may be useful in the reverse venue; history produces warnings.

Repairs seed maximum-cardinality matching with surviving pairs. Augmenting paths
and bounded two/three-pair rearrangements may revisit every unbooked pair. After
cardinality, fewer teams changing opponent or venue outranks flag improvements.
This is a preference in the existing heuristic, not a proven minimum-change
solution. Real bookings and existing started/completed fixtures remain protected.

## Ownership and persistence

- Browser state owns candidate selection, draft pairs, progress, and repair
  comparisons. Local storage is scoped to organizer, tournament, and app season.
  Restore is explicit, reloads current identities, and requires new checks.
  Verification tokens/progress are not restored across browser sessions.
- Existing `profiles.teams_json` owns flags per Hattrick club. The saved fields are
  `homeFlagLeagueIds`, `awayFlagLeagueIds`, `flagsFetchedAt`, `homeFlagsUnknown`,
  and `awayFlagsUnknown`. Legacy entries without uncertainty markers are
  unverified for missing-flag claims. Country keys use shared worlddetails, never
  raw competition LeagueID. The shared flag parser still distinguishes omitted
  collections from confirmed empty collections.
- Explicit flag refreshes call `save_team_flag_snapshot`, which locks the
  profile row and merges only the selected club instead of overwriting another
  club or sending a full profile in a URL filter. Ordinary manager
  refresh preserves these fields through the existing snapshot merge.
- A flag fetch after the latest completed preceding friendly window is reusable.
  For weekend selection the immediate boundary is Thursday noon Stockholm; for
  midweek it is Monday midnight Stockholm. If that boundary is still in the
  future, use the last completed equivalent window so organizers can plan early.
  Once the intervening window ends, earlier snapshots become stale. A known
  ongoing preceding friendly prevents fresh gain claims. The explicit refresh
  covers selected teams regardless of booking status. Failed refreshes keep
  saved collections and their successful timestamp.
- `tournament_slot_checks` owns the latest private observation for tournament,
  app season, canonical Hattrick slot ID, and tournament team. It stores the check
  timestamp, state, booking identity, offer-check certainty, and pending opponent
  IDs. It is not a draft, job queue, historical scan ledger, or booking lock.
  Previous database observations are shown as requiring recheck when loaded.
  Browser roles have no table access; operational admin authorization is required
  by the consolidated API before every read/write.

## Availability and final verification

`fetchTeamBookingStatus().isBooked` is deliberately not used. The checker validates
the requested team and complete `matches` list, parses every CHPP date as Stockholm
wall time, and classifies matches in the selected slot. A Wednesday friendly does
not block the weekend. A competitive fixture in that weekend, including a
qualification match, does. Invalid/incomplete responses remain unknown. The
assistant's shared window helper compares Stockholm wall clocks across DST;
existing refresh/Matchmaker window behavior is not silently rewritten.

The checker reads challenges with `teamId`, `actionType=view`, and the correct
weekend flag. Challenges are filtered by their actual `MatchTime`, not assumed to
belong to the selected date. Pending incoming offers are shown separately and do
not block a proposal or save. Outgoing challenges in the selected slot do block
new pairings; an unchanged saved pair may retain an outgoing challenge to its
same opponent. Missing or undated outgoing challenge data blocks verification.
An accepted offer missing from the match list forces a recheck. Older cached
observations with combined offer IDs need a fresh check to establish direction.
The assistant never cancels, accepts, or sends challenges.

Both normal checks and final verification use **at most two teams per request**.
Requests have bounded CHPP timeouts, visible counts, stop-after-batch, and retry/
resume. A failed HTTP batch invalidates browser certainty for its requested teams.
Successful completed batches are retained within the current session.

Save captures the exact slot, roster/admission choices, pairings, selected round,
and context version. `begin-verification` issues a server-signed token bound to
that proposal and actor. Subsequent small `check` batches save server-owned
receipts under the token's run ID and proposal hash. Tokens expire after one hour;
start a new verification if that limit is reached. Editing invalidates the run.
The final save performs **no CHPP fetches**: it checks receipt coverage and states,
and the transaction locks/rechecks those same receipts and fixture/context state.
Consumed receipts cannot be replayed as another successful save.

Unknown checks, unresolved offers, context changes, or newly unavailable teams
stop saving without changing the proposal. A newly discovered booking in a saved
round requires ordinary fixture reconciliation and a reload before repair. A
confirmed exact booking in a new draft can be retained for later reconciliation.
Neither a final scan nor a database transaction can prevent an external booking
immediately afterward; ongoing recheck and repair is the intended response.

## API and saved repair

All operations remain under `/api/app?route=organizer-round`:

| Operation | Contract |
| --- | --- |
| GET | Current context/version, safe team identities, slots, flags, prior observations, organizer rounds, saved-repair capability, browser storage key, batch size |
| POST `check` | Slot, optional round, up to two team IDs; final batches also include the exact proposal and signed verification token |
| POST `flags` | Slot, optional round, up to two team IDs; returns individual success/failure and saves successful flag snapshots |
| POST `begin-verification` | Exact roster, pairings, slot, context version, optional target round; returns signed verification token |
| POST `save` | Same proposal and completed verification token; creates a counted round or applies approved repair |

Saved repair targets only a materialized, organizer-source regular round. It may
remove unavailable participants, but cannot add new participants or change prior
admission choices. Removing a round participant does not reverse an admission or
alter other rounds. Protected rows must remain identical. Unchanged unbooked rows
keep their IDs; replaced rows are deleted/recreated so linked ratings/shares are
cleared by their existing foreign keys. Affected warnings are retired. All changes
and receipt consumption are atomic under the existing tournament lifecycle lock.

Pairing CSV keeps `home_ht_team_id,away_ht_team_id` as its first two editable
columns; empty cells represent a BYE. The export also includes planned kickoff,
team and manager identities, countries, saved flag country IDs and timestamps,
uncertainty markers, current slot check results, and expected flag gains. Its
flag IDs are normalized country keys, unlike Forge's saved raw league IDs.
Imports read only the first two columns, accepting both this enriched export and
the older two-column file. They resolve against the selected current roster and
always remain previews.
Excluded/unresolved candidates are listed separately and receive no artificial
counted BYE, loss, departure, or membership change. Only actual fixture participants
and their admission choices reach the existing round-save operation.

## Rollout and verification status

Migration **150** requires 149 and its existing prerequisites. It adds the private
slot-check table, expands the context fingerprint to include manager/country
identity, and adds verified creation plus the locked flag merge RPC. It is **not
applied by the agent**. It supports availability, flags, previews, draft repair,
and creation independently. Migration **151**, also unapplied, separately enables
saved-round repair by extending the verified-save transaction. The editor reads
the service-only capability and hides saved repair until 151 is applied. Existing migration markers are untouched. Review/apply 150 before using or deploying the updated editor/API or Forge flag
cache writes. Apply 151 only when releasing saved-round repair. No extra serverless route is
added. No live CHPP, Supabase, migration, publication, or booking action occurred
during implementation.

Tests were authored but **not run**, following the owner's current instruction.
No build, lint, typecheck, browser automation, or SQL execution was performed.
Coverage prepared in `tests/organizer-planning.test.ts` includes slot/DST
boundaries, multiple fixtures, incomplete CHPP results, pending/accepted offers,
legacy uncertainty, concurrent flag updates, signed verification, manager
coverage, stability, CSV, and a synthetic 160-team field. The opt-in disposable
PostgreSQL test checks receipt coverage, rollback, protected/unchanged IDs,
participant removal, rating cleanup, warning scope, and private grants.

UI inspection: select an additional slot, include teams across membership groups,
check/retry/stop/resume, refresh flags, generate and edit a preview, export/import,
restore after reload, inspect opportunities, and observe batched final progress.
Use synthetic/mocked data for UI inspection without touching live records.

Real integration testing requires separate authorization, the applied foundation migration (and 151 for saved repair),
and suitable real teams. Check Wednesday-versus-weekend bookings, qualification
blockers, fresh/stale collections, offers, and changed bookings during a scan.
Use an authorized disposable tournament for counted save and saved-round repair;
localhost itself uses production Supabase. Reconcile newly accepted matches through
the existing refresh path. Verify standings and protected fixture identities after
repair. Live bookability and production behavior remain unverified.

## Forge collection availability

Forge Scheduling scans a selected collection and friendly slot in bounded batches.
It stores shared per-Hattrick-team snapshots in `forge_slot_observations` (migration
152), separate from `tournament_slot_checks` and its final-verification receipts.
Snapshots are observations at their displayed time, not guarantees of availability.
The scanner includes Active, Lobby and Past registrations; unknown match or
challenge data is not presented as ready to arrange. Match-list access may use
another authenticated team's credentials; personal challenges require the team's
own authorization. The scanner does not change fixtures, membership or bookings.
Migration 152 is prepared locally and requires owner application before using the
new view; no live database or CHPP verification is implied.

Forge Scheduling can create an unscored organizer round after an explicit,
proposal-bound availability recheck. Migration 153 adds the protected
`rounds.is_unscored` marker and an atomic wrapper around the existing verified
save; fixtures remain ordinary organizer fixtures for Forge booking. Unscored
rounds do not contribute to standings, season-history statistics, 120m ratings,
or staged progression. The optional make-up label in a draft is only a pairing
hint: no reference or result is transferred. Historical manual linking remains
separate. Migration 153 must be applied before deploying this code; it is
prepared locally and has not been applied by the agent.

Migration 154 extends this same unscored save to generated `single`, `double`
and `recurring` schedules. The private wrapper enables the legacy path only for
its transaction; counted organizer actions retain their staged-season guard.
Legacy schedules need neither a staged season plan nor reserved-slot metadata,
and completed playoffs do not block an unscored extra. Existing rounds, season
state and membership remain unchanged. Only paired Active teams are saved;
unmatched teams and BYEs are excluded. Apply 154 after 153 before using this
path. It has been tested in disposable local PostgreSQL, not applied to Supabase.

Public fixture snapshots retain `is_unscored` independently of `round_source`.
Public Fixtures and Forge Matches show `Unscored` from that persisted flag;
round source and calendar slot do not imply scoring status.
