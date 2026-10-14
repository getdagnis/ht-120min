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
was prepared without application by the agent. Production Vercel logs on 2026-10-14
confirmed its trigger was executing and failing with
`function public.country_size_snapshot_count(bigint) does not exist`.
[`122_fix_country_size_snapshot_bigint.sql`](../migrations/122_fix_country_size_snapshot_bigint.sql)
is the prepared emergency repair: it adds the missing BIGINT overload while preserving the
INTEGER snapshot, trigger, locks and existing rows. Apply 122 to recover affected registrations;
a frontend redeploy alone does not repair this database failure. Live repair application and
successful post-repair registration are not yet verified. For a fresh rollout, use migrations
113, 114, 121 and 122 before deploying the allowance
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

## Incident: registration failure, 2026-10-14

**Confirmed:** production deployment `185d1d8` logged repeated `/api/auth/complete`
failures on Around the World with the missing BIGINT helper signature. Migration 038
already defines `teams.country_id BIGINT`, while 121 defined only an INTEGER helper.
The local fixture incorrectly used INTEGER, so its passing tests did not exercise the
production call signature. The failed transaction does not insert a new entrant.
The full duration and number of affected managers have not been established.

**Recovery:** apply prepared migration 122, then retry a qualifying small-team registration
and verify the new roster row and absence of that error in fresh production logs. No roster
cleanup, restriction removal or frontend rollback is required for this signature repair.
Migration 121 is left unchanged because its trigger is already running in production.

**Prevention:** the regression fixture now uses BIGINT, first reproduces the exact missing
function error and rollback, then applies 122 and reruns registration, waiting-list,
promotion and concurrency checks. Snapshot parity uses explicitly BIGINT arguments;
unknown out-of-range IDs fail closed, and anonymous execution privileges stay revoked.
