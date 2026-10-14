# Country-size entry allowance

The existing `max_country_active_teams` restriction uses the static Forge Leagues snapshot in
[`country-active-team-counts.ts`](../shared/country-active-team-counts.ts). With
`allow_manager_country_size_exception` enabled, each manager's qualifying small-league
entry unlocks one additional larger-league entry. Active and waiting-list entries both
consume the total allowance; only active small teams unlock active larger-team admission.
Unknown countries retain the existing exception behavior and consume a larger-team allowance.
Placeholders, departed entries and other managers' teams do not unlock an allowance.

Registration keeps the existing team-selection flow and omits unavailable larger-league
teams. Eligible cards explain whether the small team unlocks an additional entry or the
larger team uses that entry. Waiting-list copy explicitly describes waiting-list entry,
without claiming participation. Existing entrants remain visible and can depart even
if their original qualifying team has left. Other eligibility and tournament rules remain.

## Transaction and rollout

[`121_limit_country_size_manager_allowance.sql`](../migrations/121_limit_country_size_manager_allowance.sql)
is prepared only; the agent has not applied it to application Supabase. Apply it after
migration 113 (membership locking) and 114 (country-size settings), before deploying this
change. It uses the existing transaction advisory lock `(120,113)` and a deferred constraint
trigger to check the final roster, so bulk promotion of a small and larger team works in
either write order. Departures and existing participants are grandfathered, including
metadata refreshes. The existing service-only verified administrator bypass is captured
when a row is written. No historical rows, settings UI, tables or pairing records are added.

The deferred trigger queues only inserts and updates naming eligibility-related columns.
Matchmaker metadata refreshes omit `country_id` when it matches the loaded row; actual
country changes retain the shared statement lock and deferred eligibility check. Name,
logo and rating updates alone do not queue the allowance trigger.

The SQL snapshot mirrors the TypeScript snapshot. If that snapshot changes, update the SQL
function in a new migration too. Existing applied migration markers remain owner bookkeeping.

## Verification

`tests/country-size-eligibility.test.ts` exercises counted application allowances.
`tests/country-size-allowance-database.test.ts` accepts only a dedicated disposable Unix
socket under `/private/tmp/ht120-country-pg.*`, through `HT120_COUNTRY_TEST_PG` on port 55443.
It checks snapshot parity, registration, waiting-list allowance, ordered bulk promotion,
concurrent active/waiting submissions, departures, grandfathering, unrestricted tournaments,
and the verified service bypass. It also checks that unrelated metadata updates do not
queue allowance checks or wait on the membership lock, while actual country changes
still wait on that lock. It does not connect to application Supabase.

UI inspection: with a manager owning a qualifying small-league team and two larger-league
teams, join small first, reopen registration, join one larger team, then confirm the remaining
larger team is omitted. Repeat on the waiting list and inspect its wording. Keep a second
manager's small team present to confirm it does not unlock your entries.

Real integration testing requires owner application of migration 121, real CHPP-owned teams
and suitable tournament rows. Promote only the larger waiting team to confirm active admission
requires an active small team, then promote both together. Submit two larger additions
simultaneously with one remaining allowance and confirm exactly one succeeds. Remove the
small entrant and confirm existing larger entrants remain and can leave. Browser, live CHPP,
application Supabase and deployment verification remain separate from disposable SQL checks.
