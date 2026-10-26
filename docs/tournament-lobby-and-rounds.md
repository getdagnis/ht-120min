# Tournament Lobby and organizer-added rounds

## Product and ownership

Fixtures & Results has My Matches and All Matches views. A manager with matches
starts on My Matches, covering every owned team, including former participants.
Both views use the existing fixture cards and their original styles and details behavior.
All Matches retains the individual-team filter. Explicit view choices survive
fixture refreshes within the same tournament, season, and manager context.

The tournament-scoped `teams` row continues to own membership and credentials.
Lobby replaces the former Waiting label, with exactly one persisted
`teams.lobby_status`: `hanging_around`, `ready_to_join`, or `open_to_invitations`.
Only Ready to join requests automatic admission. `actively_waiting` is a
synchronized compatibility field for existing membership RPCs, not a separate
preference. Existing checked Waiting maps to Ready; other Waiting maps to
Hanging around. Active/Past rows carry the neutral Hanging around value but do
not belong to Lobby. Old authorized readiness RPCs remain compatible.

Managers may change their own Lobby teams' status. Operational organizers may
manage any team in the tournament. The consolidated `lobby-status` route derives
the actor from the signed session and calls a service-only RPC. Open to invitations
is a signal supported by existing team/manager contact links; there is no offer
inbox or implicit admission/booking consent.

## Added regular rounds

Admin → Generate Schedule → Add regular round lets an operational organizer
select an unused friendly slot from the current Hattrick season, including W15
weekend. There is no signup. Search and group selection cover existing Active,
Lobby, and Past teams. Each selected non-active team can play this round only or
be admitted for subsequent rounds. This round only is the default. Continuing
admission uses the established slot-aware admission operation; existing verified
site-admin overrides remain server-controlled.

The [pairing assistant](organizer-pairing-assistant.md) adds batched slot-specific
checks, manager-first flag proposals, CSV recovery, final verification, and a
separate saved-round repair workflow. Migrations 150 and 151 are prepared, not applied;
its checks and repair tests are authored but unrun. The balanced preview remains
available alongside flag-aware proposals.

The preview supports
opponent edits, venue swaps, and explicit BYEs. Every selected team must appear
exactly once; duplicate registrations of the same known Hattrick club are rejected
within this round. The server recalculates planned kickoffs from the canonical
slot and home club metadata. An individually passed kickoff cannot be saved.
A weekend remains available while at least one club's planned kickoff is future,
even after the slot's nominal calendar date begins. Hattrick remains the actual
booking authority; qualification risk is shown without requiring extra signup.

`rounds.round_source = organizer` identifies an added **regular**, counted round.
`round_participants` is its first-class roster, keyed by round/team and storing
`round_only` or `admit`. Membership does not determine this roster after saving.
A service-only transaction serializes against membership changes, rejects stale
context versions and occupied slots, performs requested admissions, and creates
all roster/fixture rows together. A failed admission rolls everything back.
Browser roles can read the safe roster through the existing public-round access
boundary and cannot write it or create organizer-source rounds directly.

Added rounds retain separate round numbers after the frozen plan's reserved
numbers. Fixture lists sort them by reserved calendar date; neither existing round
IDs nor the season pairing plan is renumbered. Therefore displayed round numbers
can be nonconsecutive in calendar order. Added rounds can materialize while another
round is unresolved and complete without invoking normal membership admission or
departure again. They cannot advance the reserved pairing plan.

Normal scoring and warning rules apply to selected fixtures. Unselected teams get
no artificial absence, loss, or BYE. Length-season standings include Active teams
and explicitly selected added-round participants; each keeps its own season
results even while remaining Lobby/Past. Playoff eligibility still requires Active
membership. All counted additional rounds must resolve before qualification or
completion of the reserved season. Added regular slots must precede playoffs;
already-materialized brackets cannot be reseeded by this tool.

## CHPP and fixture integration

Public fixture challenges and Forge inspection/send/accept/withdraw/reverse derive
`isWeekendFriendly` from the fixture's persisted slot. Inactive clubs are bookable
only when the explicit roster authorizes their participation. Existing verified
ownership, challenge-management scope, exact-opponent offers, and automatic-booking
preferences remain required by their established paths. Lobby status itself grants
no booking permission. Auto-arrange preferences remain accessible to managers of
scheduled round-only clubs.

Public sends reread exact-opponent pending/agreed offers before sending, including
retries after an ambiguous timeout. This does not introduce a durable booking
queue or guarantee exclusion of simultaneous external requests. Accepted matches
still require fixture reconciliation. Refresh reconciles all materialized rounds,
using a shared friendly-list cache, and does not silently substitute an unselected
Lobby team into an organizer-owned round. Ratings for explicit round-only clubs
use the same confirmed future CHPP kickoff guard as ordinary participants.

## Rollout and evidence

Migration `148_tournament_lobby.sql` has no applied marker in this checkout;
`149_organizer_regular_rounds.sql` carries an owner-added applied marker. Neither
is independently live-verified here. Assistant foundation 150 and separate saved-repair migration 151 are
prepared locally and **not applied by the agent**. These depend on the existing staged
schedule/membership migrations, including 137. Check installed functions and run
the existing membership/season-slot preflights before owner-authorized application;
this work does not resolve the separately documented missing-slot blocker.
Preserve all owner migration markers.

Verify prerequisites and the installed 148/149 state, then apply 150 before deploying
this application's new public projections and API. Apply 151 separately to enable
saved-round repair; it is not required for the checker/generator/creation milestone. Invalidate affected tournament
caches and reload old tabs. Do not roll back to an application unaware of additional
rounds while those rounds exist; keep data/schema and use a compatible forward fix.
Do not remove roster tables as a routine rollback.

Local automated checks use synthetic PostgreSQL fixtures and mocked HTTP. The
browser preview uses real components with synthetic teams and mocked endpoints.
None proves live Supabase permissions, CHPP scope/ownership, accepted weekend
bookings, actual-phone layout, or production deployment.

UI acceptance: at about 160 teams, verify both owned clubs appear in My Matches,
Both views retain the original fixture presentation, and details/actions
remain keyboard accessible. Change each Lobby status and inspect organizer filters.
Build a weekend preview across all membership groups, edit venues/BYEs, and verify
round-only versus continuing-admission effects before saving.

Real integration acceptance requires an authorized disposable tournament and real
manager credentials: test own/other-manager status updates, denied organizer writes,
stale/duplicate round saves, membership preservation, weekend send/accept and opt-out,
reconciliation, counted guest results, and qualification waiting for the added round.
Verify failed/ambiguous CHPP actions can be inspected and retried without blindly
sending another exact-opponent offer.
