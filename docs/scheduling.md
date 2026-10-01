# Scheduling

Scheduling is app-owned product logic. It creates Hattrick-friendly tournament rounds and persists exact match kickoff timestamps in Supabase.

## Current Rules

- Hattrick calendar epoch: HT season 94, week 1, 2026-03-30.
- Weeks 1-3 are blocked cup weeks.
- Weeks 4-6 are selectable but shown with cup-risk warnings.
- Normal tournament rounds use midweek friendly slots.
- Week 15 weekend is optional because qualification games can block teams.
- Week 16 weekend is a regular friendly slot and is included by default.
- Odd-team tournaments generate BYE rows instead of fake opponents.

Core implementation:

- `src/utils/hattrick-calendar.ts`
- `src/utils/schedule-draft.ts`
- `src/utils/reschedule-draft.ts`
- `src/utils/scheduler.ts`
- `src/utils/length-schedule.ts`
- `src/components/TournamentTabs/Admin/TournamentSchedulePanel.tsx`

## Length-based staged schedules

New HFI generated seasons use `schedule_mode = length`. The organizer chooses a
round count from safe friendly slots remaining in the selected Hattrick season;
the planner never spills into the next HT season and excludes the W15 weekend.
The chosen TeamRank values are frozen on `tournament_seasons` at generation.

The full calendar is reserved atomically, but only the current actionable round
has match rows. Later `rounds` rows remain `pending` with authoritative reserved
slot metadata. Once every current-round fixture is either played, a BYE, or
explicitly finalized unplayed, the shared server progression service materializes
the next round. Pairings use the frozen rank order, actual played-opponent/BYE
history, and current season-slot occupants.

A complete round robin plus one remaining safe slot may reserve that final slot
as a Championship Final. It is materialized as regular-season #1 versus #2 only
after the regular phase resolves. Postseason matches are excluded from regular
standings, and the champion is stored separately on the season. The 120-minute
final rule deliberately reverses a regulation-time winner; after extra time is
reached, the normal extra-time or shootout winner is champion.

`Repair Round` is distinct from date regeneration. It locks linked/arranged
fixtures, refuses started or past-kickoff rounds, contains booked-elsewhere teams,
and re-pairs only the unresolved current-round remainder. Finalized unplayed
containment rows do not become opponent history.

The admin-only Round 1 recovery action is separate from `Repair Round`. It is a
one-off recovery for the destructive Round 1 repair failure: it ignores current
Round 1 pairings, reconstructs the deterministic original from the frozen
`ranking_snapshot_json`, current season slot occupants, and
`generateBalancedRound(..., {}, 0)`, then replaces only that round's fixture
rows using its reserved slot and `buildStoredPairings()` kickoff times. It does
not change the round, later rounds, rankings, or season slots.

Legacy `single`, `double`, `recurring`, and `manual` seasons retain their existing
generation and management paths.

## Generation

The admin schedule panel builds a frontend draft, then calls `generate_tournament_schedule`.

The serialized payload includes:

- schedule mode
- selected start slot
- team count
- `include_week15_weekend_friendly`
- round dates
- exact match `scheduled_for` timestamps
- `schedule_slot_type`
- BYE flags

Generation closes registration and locks the selected schedule start.

## Regeneration

Regeneration moves future unarranged rounds only. Pairings and venue types remain unchanged.

Rounds are locked if any affected match is:

- completed
- linked to a Hattrick match
- arranged
- ongoing
- misarranged
- already past kickoff

Regeneration also supports the optional W15 weekend flag when applicable and keeps W16 weekend included by default.

## Kickoff Times

- Midweek and weekend kickoff times come from `src/utils/global-match-times.json`.
- Weekend scheduling uses league-level-aware lookup where possible.
- Missing weekend country metadata falls back to a default weekend kickoff.
- Persisted `scheduled_for` should be preferred over legacy calculated dates.

### CHPP fixture timestamps

Hattrick's CHPP `MatchDate` is a timezone-less Stockholm wall-clock value. The
application's existing linked-fixture rows preserve those wall-clock
components in the legacy `matches.scheduled_for` column, which is a PostgreSQL
`timestamptz` column. As a result, Supabase may return a value such as
`2026-04-28T21:00:00+00:00`; the `+00:00` suffix is a serialization artifact,
not a claim that the match began at 21:00 UTC. For a linked Hattrick fixture,
`21:00` means 21:00 in Europe/Stockholm and displays as 22:00 in Riga during
the relevant daylight-saving period.

This legacy convention is deliberately interpreted at the fixture boundary:
`shared/chpp-dates.ts` contains the Stockholm parser and
`src/utils/match-schedule.ts` applies it only to rows with an Hattrick match
ID. Generated schedule rows remain real UTC instants and continue to use the
normal `timestamptz`/ISO behavior. Do not add a browser-timezone offset or
change a linked fixture's stored value to a different instant as a display
fix. New CHPP-linked writes should use `serializeStoredStockholmDate()` so the
legacy representation is explicit.

The database column is not being changed here: the schedule-generation RPCs
and existing migrations rely on `timestamptz`. A future schema migration could
separate a Stockholm wall-clock field from real instants, but until then the
two categories must remain distinct in code and documentation.

## Migrations

- `047_add_week15_special_schedule.sql` introduced special schedule slot metadata.
- `048_add_schedule_metadata_and_generation_rpc.sql` added schedule metadata and generation RPC.
- `049_reschedule_tournament_rounds_rpc.sql` added regeneration RPC.
- `051_correct_week15_week16_weekend_schedule.sql` corrects W15/W16 weekend behavior and updates both RPCs.

`051` is currently marked in the file as applied, but production state should still be confirmed when deployment status matters.

## Validation

Relevant tests:

- `tests/hattrick-calendar.test.ts`
- `tests/schedule-draft.test.ts`
- `tests/reschedule-draft.test.ts`
- `tests/match-schedule.test.ts`
- `tests/length-schedule.test.ts`

Manual SQL helper:

- `docs/schedule-rpc-smoke-test.sql`

That helper is a disposable SQL smoke test reference, not proof that production has the migration.

## Detailed References

- `PROJECT_STATE.md`
- `migrations/047_add_week15_special_schedule.sql`
- `migrations/048_add_schedule_metadata_and_generation_rpc.sql`
- `migrations/049_reschedule_tournament_rounds_rpc.sql`
- `migrations/051_correct_week15_week16_weekend_schedule.sql`
- `migrations/085_length_schedule_progression.sql`
- `src/utils/hattrick-calendar.ts`
- `src/utils/schedule-draft.ts`
- `src/utils/reschedule-draft.ts`
