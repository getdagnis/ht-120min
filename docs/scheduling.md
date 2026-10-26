# Scheduling

Scheduling is app-owned product logic. It creates Hattrick-friendly tournament rounds and persists exact match kickoff timestamps in Supabase.

## Current Rules

- Hattrick calendar epoch: HT season 94, week 1, 2026-03-30.
- Weeks 1-3 are blocked cup weeks.
- Weeks 4-6 are selectable but shown with cup-risk warnings.
- Normal tournament rounds use midweek friendly slots.
- Week 15 weekend is optional because qualification games can block teams; the organizer-added regular-round tool can use it without regenerating the season.
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

New generated seasons across all tournament categories use `schedule_mode = length`.
The organizer selects a safe start slot and one of these formats:

- **All remaining rounds** (default): every remaining safe friendly slot in that HT season.
- **Single round robin**: one complete cycle, offered only when it fits.
- **All remaining + 1 playoff round**: 6+ teams, at least one regular round plus the final.
- **All remaining + 2 playoff rounds**: 8+ teams, at least one regular round plus semifinals/final.
- **All remaining + 3 playoff rounds**: 12+ teams and 8+ available slots, ending in quarterfinals/semifinals/final.

Playoffs consume the last available slots; they never extend the calendar. The
planner excludes blocked cup weeks and the W15 weekend, includes the safe W16
weekend, and never spills into the next HT season. The old double/recurring
choices remain supported for existing schedules but are absent from new generation.

The ranking source is **Power Rating** for regular tournaments and **HFI
TeamRank** for HFI tournaments. Higher Power Rating and lower HFI rank seed first.
The explicit Admin Teams refresh action reuses the same CHPP teamdetails flow for
both sources; page loads do not refresh rankings. Non-HFI teams never require
HFI rank. Unavailable Power Ratings sort after rated teams using a stable ID tie
break; existing HFI missing-rank validation remains in place.

Version 2 plans freeze raw ranking values and seeds on `tournament_seasons` and
reserve a regular pairing plan using persistent season-slot indices. A ranked
opener pairs neighboring seeds. Complete round-robin cycles finish all unique
opponents before repeating; even repeat counts split venues equally, and an
Euler orientation balances each team's aggregate home/away count within one.
Partial cycles keep pair counts within one; odd fields receive one BYE per team
in each complete cycle. The circle construction avoids factorial matching searches
for ordinary generation, including large fields.

The full calendar is reserved atomically, but only Round 1 has match rows at
publication, accounting for every active participant. Later rounds remain
`pending` until the existing progression service and atomic transition resolve
the current round. Replacements inherit physical season slots and their frozen
seeds. Missed, repaired, reoriented or vacated rounds reuse the existing played
opponent/BYE history fallback, preferring least-repeated opponents rather than
forcing the original future plan. Finalized-unplayed fixtures are not played
opponent history. Existing version 1 schedules retain their original progression.

Every Active participant in a length season needs a current season slot before
the next round can materialize. The transition checks this inside its atomic
RPC and rejects a pairing that contains an unslotted team. Migration `141` is a
guarded one-time repair for four already Active teams in two blocked tournaments:
it adds new paired slots and assignment history without changing fixtures or
reusing a standings line. It does not make unslotted Active registration safe;
the paths that created those rows still need a separate prevention fix.

Playoffs remain `postseason` competition rounds within the same fixture list.
The regular standings qualify the top two, four or eight teams. Bracket match
numbers preserve winner routing independently of database row ordering;
semifinals/finals use the previous round's decisive winners. Postseason fixtures
are excluded from regular standings, and the final stores the champion separately.
The existing 120-minute knockout rule reverses a regulation-time winner and uses
the normal extra-time or shootout winner once extra time is reached. Ties or
unplayed knockout fixtures cannot choose advancing teams.

`Repair Round` is distinct from date regeneration. It locks linked/arranged
fixtures, refuses started or past-kickoff rounds, contains booked-elsewhere teams,
and re-pairs unbooked fixtures affected by warnings, vacant season slots, or
multiple BYEs in the same round. Unaffected fixtures, including a lone BYE,
keep their existing rows.
The remaining active teams can receive a BYE when no opponent is available.
Large repair fields use bounded pairing candidates. Fully vacant fixture rows
are removed inside the repair RPC; this requires migration `124` before using
the new repair flow. Finalized unplayed containment rows do not become opponent
history.

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

Real tournaments must be published as Recruiting before generating a schedule.
Planning is a non-exclusive waiting list and cannot create rounds. Explicit
Auto-start retains the already-committed Active path. See
[tournament lifecycle](tournament-lifecycle.md) for publication and reset rules.

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

- Generated midweek kickoff estimates use `COUNTRY_FRIENDLY_TIMES` in `src/utils/ht-data.ts`.
- Generated weekend kickoff estimates use `src/utils/global-match-times.json`.
- Weekend scheduling uses league-level-aware lookup where possible.
- Missing weekend country metadata falls back to a default weekend kickoff.
- Generated `scheduled_for` values are planned estimates, not proof of the eventual Hattrick kickoff.
- Exact CHPP kickoff instants are stored separately in `matches.chpp_match_date`.
- Public fixture dates prefer `chpp_match_date`; a generated schedule time is labeled estimated and does not drive inferred live status or polling.
- Arranged-fixture rating sharing and visibility use only the future confirmed `chpp_match_date`; a planned estimate cannot authorize access or close it early.

### CHPP fixture timestamps

Hattrick's CHPP `MatchDate` is a timezone-less Stockholm wall-clock value. The
older linked-fixture rows may preserve those wall-clock components in the
legacy `matches.scheduled_for` column, which is a PostgreSQL `timestamptz`
column. As a result, Supabase may return a value such as
`2026-04-28T21:00:00+00:00`; the `+00:00` suffix is a serialization artifact,
not a claim that the match began at 21:00 UTC. For a linked Hattrick fixture,
`21:00` means 21:00 in Europe/Stockholm and displays as 22:00 in Riga during
the relevant daylight-saving period.

New and repaired linked-fixture rows store the parsed exact instant in
`matches.chpp_match_date` as a normal UTC `timestamptz`; generated `scheduled_for`
remains untouched and retains its UTC planned-schedule meaning. The old
`scheduled_for` convention is still interpreted at the fixture boundary for
legacy rows:
`shared/chpp-dates.ts` contains the Stockholm parser and
`src/utils/match-schedule.ts` uses that legacy parser only for linked rows
without generated slot metadata. New CHPP data is parsed with
`parseChppStockholmDate()` and stored separately, so `schedule_slot_type` no
longer changes how an exact kickoff is interpreted. Do not add a browser-timezone
offset or rewrite generated schedule values as a display fix.

After migration `101_add_confirmed_chpp_match_dates.sql` is applied and the
updated app is deployed, use the existing **Refresh fixtures** action once for
each affected tournament. A separate repair pass fetches CHPP `MatchDetails`
for linked, uncompleted fixtures lacking an exact date across the current
season, verifies a tournament team is in the match, and stores dates that are
upcoming or within the live-polling window. It does not regenerate the schedule
or rewrite results. Unlinked generated fixtures have no known CHPP match to
repair and remain estimated until their Hattrick match is linked.

The schedule-generation RPCs continue writing `scheduled_for` as a real UTC
instant. The new `chpp_match_date` column keeps that estimate intact while
recording the exact Hattrick instant independently.

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

### Calendar-first generation rollout

`107_calendar_first_generated_schedules.sql` is prepared locally. It extends
`generate_length_tournament_schedule` and `apply_length_round_transition`, adds
server-protected `matches.playoff_match_number`, and retains service-only execution.
It changes no existing season plans or fixture rows. Apply it **before deploying**
the code that selects the new match column. The consolidated API rebuilds the
browser preview from persisted team metadata and supported calendar/format choices
before invoking generation; client-provided seeds and fixture plans are not trusted.

The owner-marked-applied archived 085 is unchanged. Inspect both live function
definitions using the preflight queries at the top of 107 before applying it;
local PostgreSQL testing is not verification of the live Supabase schema.

Local regression commands:

```sh
node --import tsx --test tests/length-schedule.test.ts tests/length-schedule-progression.test.ts tests/calendar-first-schedule-service.test.ts tests/hfi-rank-refresh.test.ts
```

The optional `tests/calendar-first-schedule-database.test.ts` uses the minimal
schema in `tests/fixtures/calendar-schedule-schema.sql`. Run it only against a
**disposable local PostgreSQL cluster** owned by the developer, with user
`postgres`, port 55442 and a Unix socket directory beginning
`/private/tmp/ht120-calendar-pg.`. It drops that cluster's public schema and uses
synthetic fixtures; it refuses remote connection strings and is skipped unless
`HT120_TEST_POSTGRES_SOCKET` is explicitly set. Example after starting such a cluster:

```sh
HT120_TEST_POSTGRES_SOCKET=/private/tmp/ht120-calendar-pg.YOUR_TEMP_SUFFIX node --import tsx --test tests/calendar-first-schedule-database.test.ts
```


## Waiting admission and the next regular round

Phase 1 uses Active, Waiting and Past. See [membership and rollout rules](database-and-deployment.md#team-membership-phase-1).
An eligible verified manager joins checked Waiting while registration is open,
even with another owned participant. The team appears below standings without
current fixtures, a ranked standings row or a season assignment. Waiting may
remain open when the playing field is full; capacity is rechecked on admission.
There is one registration setting, including tournaments with no team limit.
Closing it blocks new requests, not accepted Waiting.

A checked Waiting team is admitted at the next eligible regular-round
materialization, or when an immediate departure opens a place. Unchecked Waiting
stays for admin review. A manual Promote creates ordinary Active membership and
season integration; it does not rewrite the current round. Existing booking and
paired-add/Repair Round operations remain the way to add safe current-round
fixtures. Past → To waiting is checked; Active → To waiting is unchecked. Remove
and manager Leave move to Past while preserving match history.

The scheduler reads `get_waiting_admission_plan` before creating pairings.
That function determines a valid ordered subset using eligibility, actual Active
capacity and current commitments. Invalid entrants stay Waiting with a reason;
existing participants can advance. Accepted Leave-after-round requests are
accounted for before the next regular field, subject to protected later fixtures.
The service then calls `apply_length_round_transition_with_membership` with exact
accepted IDs, Active IDs, roster version and pairings. Its transaction recomputes
the plan, releases those leaving, adds accepted entrants with slots/assignments,
and invokes the existing six-argument transition from migration 107. A roster
race rolls back and retries planning; an admission cannot appear as Active
without the corresponding committed transition. Old 134 join wrappers cannot
silently bypass the new guards.

Released historical assignments do not prevent returning. New length admissions
append their own slot/assignment instead of inheriting a departed team's place.
Two physical rows per admission remain for compatibility in Phase 1. Existing
fixtures and results remain intact; future regular pairing uses the expanded
field/history fallback. Length standings count a team's own matches and show
only Active; opponents' results against Past/Waiting teams still count. Fixed
full-season slot inheritance is preserved.

Site-admin manual promotion retains its verified eligibility/membership/capacity
override; normal automatic admission has no such bypass. Booking and CHPP match
arrangement remain the normal manager/organizer workflow. No migration or live
integration was executed against Supabase during implementation.

## Adding reserve pairs during a staged season

Organizers can select an even group of Waiting teams in the scheduling operation, check their
booking/cup status, preview ranked newcomer pairs and add them to the current
materialized regular round. Selection is local to the page and does not itself
promote a team. Known booking/cup conflicts or unverifiable status block the whole
group. The final submission repeats the check and rejects a changed preview.
Dates are informative: other fixtures starting does not impose an admission
cutoff. Completed rounds and started playoffs remain protected.

Admission is additive. Existing pairings, BYEs and results stay intact; newcomers
get new physical season slots, assignment snapshots and one fixture each. They
start at zero and enter ordinary subsequent-round standings and playoff rules.
The existing configured team limit can be raised by explicit confirmation.
Admission retries use a request UUID recorded on the assignments, including when
the entry round has since completed. Existing removal tools retain their result
and protected-fixture guards.

`admit_length_schedule_reserves` in migration **108** remains the explicit paired-admission write
path, called through the authorized consolidated API. Season-slot assignments
are the source of truth for entry round, frozen admission ranking and request
identity; this is an extension of slot ownership, not a global identity migration.
Original schedule snapshots stay unchanged. Later regular rounds switch to
played-history pairing over the expanded roster, using frozen Power Rating or
HFI rank values independently of physical slot indices. Large expanded fields
use bounded circle candidates rather than factorial matching enumeration.
Original Round 1 recovery is disabled after expansion; regular repair still works.

Migration 108 carries the owner's applied marker; live schema inspection and
CHPP verification remain separate rollout steps. It adds no API function, automatic CHPP booking,
ratings consent, legacy-schedule expansion or pending-entry queue.

Normal Remove now moves Waiting to Past through 137's membership operation.
The older hard-delete RPC is retained separately for compatibility and is not a
membership control. Availability
checks distinguish missing cup data from ownership validation. When `teamdetails`
suppresses Cup during live play, an identified complete matches response can
verify availability: unresolved cup fixtures block; absence of them requires an
upcoming league fixture beyond the reserved friendly date to establish schedule
coverage. Empty, wrong-team or incomplete feeds remain unknown and block admission.


## Organizer-added counted rounds

The additional-round tool owns an explicit per-round roster across Active, Lobby,
and Past teams, independent of continuing season membership. It can materialize
alongside an unresolved reserved round, retains separate round numbers, and appears
in calendar order. It never renumbers or overwrites the frozen pairing plan.
All counted additional rounds must resolve before playoff qualification or final
reserved-round completion. Details, migration prerequisites, guest standings,
booking behavior, and acceptance: [Tournament Lobby and organizer-added rounds](tournament-lobby-and-rounds.md).
