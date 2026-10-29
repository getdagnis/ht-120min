# CHPP

CHPP is used for Hattrick identity, team metadata, fixture booking/reconciliation, challenge actions, and live/finished match sync. App tournaments remain app-owned.

For any CHPP task, read this file and then `docs/AGENTS_CHPP_INTEGRATION.md`.

## OAuth And Auth Flow

OAuth routes:

- `/api/auth/init`
- `/api/auth/callback`
- `/api/auth/complete`

The flow supports:

- standalone login
- tournament join
- tournament creation

`manage_challenges` is requested for challenge-management work. Existing users whose tokens predate that scope may need to reauthorize.

Detailed flow reference: `docs/auth-flow.md`.

## Endpoint Source Rules

- `managercompendium`: manager identity and owned-team discovery.
- `teamdetails`: team metadata such as team name/id, logo, arena pointer, gender, country/league fields, and challengeability hints.
- `matches`: authoritative source for upcoming/recent team fixtures and friendly booking detection.
- `matchdetails`: authoritative source for confirmed finish and final result sync. During play it may contain only match metadata, without status or score.
- `matchlineup`: source for the lineup of a finished match, including the resolved set-pieces taker as RoleID `17`.
- Fixture kits use `teamdetails` `DressURI` for the actual Hattrick home side and `DressAlternateURI` for the actual away side, including finished fixtures. MatchDetails is still authoritative for results and events, but its report `DressURI` must not overwrite the home/away kit snapshot. Kit URLs are stored on `matches` by scheduled fixture side and rendered directly from Hattrick. Default and custom kits both render when a URL is stored. A fixture refresh rechecks arranged matches, and a finished-match refresh can correct older report-kit snapshots. `matches.xml` does not carry kit URLs.
- `live`: source for ongoing presence, current score, and structured live events. Do not use it to declare a match finished.
- `challenges`: challengeable/challenge actions when direct friendly management is needed.
- `worlddetails` and `leaguedetails`: preferred direction for canonical country/league normalization.

Do not use Hattrick website pages or undocumented interfaces. CHPP products must use documented CHPP files only.

## Forge friendly-availability directory

The private `challengeable-directory` testing tool scans each manager through
their stored CHPP access. It lists only teams confirmed unbooked and out of cup,
and checks each listed team against the selected team above using the directional,
opponent-specific `challenges?actionType=challengeable` response for both friendly
windows. It never sends a challenge. `PossibleToChallengeMidweek` /
`PossibleToChallengeWeekend` from teamdetails are not used as substitutes for
that pair-specific result. The displayed challengeability is true if either
window permits a challenge, false only if both windows deny it, and unknown when
CHPP does not confirm enough data. Unbooked teams remain visible for organizer
contact. Missing booking or cup status and failed checks remain unknown and are
excluded from the available list.

Starting a rescan clears the old results immediately. As managers are checked,
each successfully rediscovered manager's team snapshot replaces the previous one,
including empty rosters. Failed manager lookups do not restore old entries. Each
listed team shows its check time; legacy session-storage entries are unknown until
rescanned. `Restart full scan` clears the old results and scans all managers again;
`Refresh listed teams` checks only the currently listed manager/team pairs and
removes teams confirmed booked, in cup, or no longer owned. A failed refresh keeps
that listing and reports the failed check. Progress counters restart per full scan,
pause/resume retains the cursor, directory responses bypass HTTP caching. Cancel
stops after the in-flight page and keeps the accumulated results; continuing
resumes from the saved cursor.

The Testing Hub can accept a pending incoming challenge for the selected manager
and team. It finds the pending offer from the specified challenger team, then uses
the offer's CHPP `TrainingMatchID`; ambiguous duplicate offers are not accepted.
Acceptance requires explicit user confirmation and the receiving manager's own
stored `manage_challenges` credentials.

Forge Matches has a manual `Book all` run scoped to the selected tournament and
materialized round. It rereads CHPP fixture states, sends eligible Cup Rules
challenges through the existing per-fixture action, rereads challenge states,
then accepts exact-opponent incoming challenges through that same action. Bulk
actions reread both managers' current auto-arrange preferences server-side and
skip an opt-out. A specific Hattrick refusal to accept challenges permits one
retry from the other fixture side; the existing side-based `matchPlace` keeps
the scheduled home/away venue. The browser runs actions one at a time and Stop
finishes the current request. Accepted fixtures are reconciled once at the end.

A separate server-side worker is available through the existing consolidated
API at `POST /api/cron/auto-booking`. It requires a server-only bearer secret
(`AUTO_BOOKING_CRON_SECRET`, at least 32 characters), does not require a Forge
session, and discovers enabled settings for each tournament's current season.
Finished, archived, cancelled, test, disabled, and old-season entries are
excluded. Each invocation is capped at five tournament fixtures and records
outcomes in the service-only `forge_booking_worker_runs` table. A database
uniqueness constraint prevents overlapping runs for the same tournament season.
Recent results are bounded to the last 24 hours; booked fixtures and fixtures
whose saved next-attempt time is still in the future are skipped without CHPP
reads.

For international midweek fixtures (different team countries and
`midweek_friendly` schedule metadata), the worker derives the opening from the
fixture date in Europe/Stockholm time. It makes three preliminary checks on
Wednesday at 10:00, 14:00 and 18:00, then checks every two hours overnight until
Thursday 06:00. Once open, pending bookings and Hattrick error 70 are checked
again after five minutes. Weekend and domestic fixtures do not use that Thursday
window; ordinary eligibility checks wait two hours. Persistent opt-out or CHPP
permission/ownership blocks wait up to 12 hours, while other transient state
errors wait 30 minutes (five minutes once the international window is open).
When no fixture is due, the tournament waits at least two hours before another
database check. Unfinished `running` audit rows older than ten minutes are marked
failed to release the overlap guard.

Forge → Match Bookings reads the latest ten real-mode audit rows through its
authenticated server endpoint and shows activity at the bottom of the page.
No browser access to the private audit table is granted. The panel shows the
latest result and next scheduled attempt when available; absence of recent rows
does not prove the Cron is healthy.

Live actions additionally require the server-only
`AUTO_BOOKING_CRON_LIVE_ENABLED=true`, an explicit request for `mode: "real"`,
and the season's existing automatic-booking setting. Each challenge/accept still
uses the existing Forge action checks for live booking state, consent, permission,
credential ownership, and manager preferences. Hattrick error 70 causes a state
reread without an immediate action retry; if unresolved, the next check is five
minutes later. The single-job replacement SQL and enabled-tournament preview
are in [auto-booking-cron.sql](auto-booking-cron.sql). That SQL has not been run;
no cron was changed and no deployment was made in this work. The owner reports
the generalized production cron is already running; live status was not
independently inspected. The SQL uses the existing `AUTO_BOOKING_CRON_SECRET`
Vault entry and owner-confirmed production URL.

For a local auth smoke check, configure `AUTO_BOOKING_CRON_SECRET` in the local
server environment, then send a POST with `Authorization: Bearer <secret>` and
an empty JSON object. Omit `mode` to remain in dry-run. Do not put the secret in
browser code or a URL. The handler and auth contract are covered by
`tests/cron-auto-booking.test.ts`.

To run one local dry-run for a selected tournament after applying migration 162
to the database used by the local app, open Forge while signed in as a Forge
admin and run this in the browser console. Choose the tournament UUID from the
Forge Matches page or the read-only SQL preview in `auto-booking-cron.sql`:

```js
const { tournaments } = await fetch('/api/forge/matches', { credentials: 'include' }).then((r) => r.json());
const tournament = tournaments[0];
if (!tournament) throw new Error('No tournament was returned by Forge.');
const response = await fetch('/api/forge/matches', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'run-auto-booking-worker', tournamentId: tournament.id }),
});
console.log(await response.json());
```

The response includes `runId`, `mode: "dry_run"`, and the inspected fixture's
proposed action or skip reason. Inspect the durable record with:

```sql
select id, tournament_id, season_number, round_id, fixture_id, mode, status, outcome, started_at, finished_at
from public.forge_booking_worker_runs
order by started_at desc
limit 10;
```

Dry-run performs CHPP state reads for one candidate and writes one audit row;
it does not send or accept a challenge. Confirm the local app points to a
non-production database before invoking it if an audit write there is not
intended. If a server process is terminated mid-run, its `running` row safely
blocks another attempt; after confirming no request is still active, mark that
row failed before retrying rather than clearing the guard blindly.

## Match Refresh Rules

- Fixture refresh uses `matches` to detect arranged friendlies.
- Public friendly lists use the team's complete OAuth credentials when available,
  otherwise another authenticated team in the same tournament. A manually added
  team without owner credentials must still be checked for correct and conflicting
  bookings, so its fixture warning is available to `Repair Round`. This read
  fallback does not validate ownership or grant challenge-management access.
- A correct future booking found after round repair reopens its provisional
  `finalized_unplayed` containment row as `pending` in the materialized round.
  Saved warning history remains intact, but cannot override an arranged, ongoing
  or finished fixture's displayed status.
- Normal friendlies and cup friendlies are valid: match types `4`, `5`, `8`, `9`.
- `Status` may be absent/null in older local rows; treat missing app status as `not_arranged` when appropriate.
- Reversed Hattrick home/away still counts as the correct arranged match if both teams match and the date is within the accepted window.
- Record venue mismatch metadata instead of rejecting the match.
- Result sync uses `matchdetails` with `matchEvents=true`.
- Extra time should be detected from event type `70`, match parts `3/4`, and scorer/event evidence as described in `AGENTS_CHPP_INTEGRATION.md`.

### Match dates and storage convention

CHPP `MatchDate` has no offset and is a Europe/Stockholm wall-clock value.
Do not parse it as UTC by appending `Z`, and do not apply a fixed `+01:00`
offset because Stockholm observes daylight saving time. The shared
`parseChppStockholmDate()` helper is the correct date-aware parser when a real
instant is required.

For compatibility, linked Hattrick fixtures currently store the original
Stockholm wall-clock components in the existing `matches.scheduled_for`
`timestamptz` column. PostgreSQL/Supabase therefore serializes them with
`+00:00`, even though that suffix is not the semantic timezone of the value.
Use `parseStoredStockholmDate()` when reading a linked row for display, and
`serializeStoredStockholmDate()` when writing a new linked row. Generated
application schedules are different: their `scheduled_for` values are genuine
UTC instants and must retain ordinary ISO/timestamptz handling.

Never “correct” this mixed legacy convention with arbitrary hour arithmetic in
React or by changing all fixture display to UTC/Stockholm. Keep the distinction
at the shared parsing/serialization boundary.

## Structured Match Event Contract

- Request `matchdetails` with `version=3.1&matchEvents=true`. Both parameters are required for the event-level payload.
- `src/server/api/_lib/chpp-match-events.ts` is the shared server parser. Both live refresh and manual match linking must use it; do not create a third parser for event summaries.
- Pure canonical event descriptions live in `shared/match-events.ts`, shared by the parser and TeamByline's fallback for older goals without stored descriptions. The server parser re-exports the helper for existing callers; browser components must not import the server parser.
- Store the structured payload in `matches.match_event_details`, mapped to the **scheduled fixture sides**. This keeps cards/injuries correct when CHPP home/away is reversed or an admin links one BYE team to an outside friendly. Version 2 also persists stable MatchDetails result semantics (regulation/extra-time/penalty scores, decision and winner), formations, tactic/skill, possession, ratings, chance counts and scorer names; raw XML is never stored.
- Version 3 adds the taker when MatchDetails records a set-pieces change (event 81). When no change event identifies the taker, the finished-match system refresh reads `matchlineup` with that participating team's stored owner credentials; RoleID `17` identifies the resolved starting taker, including when the manager left the choice to the coach. It then reads that player's current Set Pieces skill from `playerdetails` using the same team credentials. Successful skill snapshots are reused, and the player ID is removed before the public match snapshot is stored.
- Existing numeric card/injury columns remain derived compatibility summaries for standings and older snapshots.
- The parser uses only stable structured IDs and fields, never localized `EventText`:
  - cards: `510` yellow/nasty play, `511` yellow/cheating, `512` second yellow/red nasty play, `513` second yellow/red cheating, `514` straight red;
  - injuries: `<InjuryType>1</InjuryType>` is a plaster and type `2` is an injury; `401-422` record the body location, whose `ObjectPlayerID` may carry weeks; `454` is a doctor-report duration in `SubjectPlayerID` when it can be attached unambiguously by match time; `423` records a foul-related injury;
  - do not infer an attacking or offending player/team from prose. A team attribution is only recorded where the structured `423` event and the two-team match context make it explicit.
- Season fixture archives copy the persisted fixture data and never re-fetch CHPP. Regenerating a report upgrades only older fixture archives that lack the `match_event_details` field.

## Parser Rules

- Inspect raw XML before changing parser behavior.
- Prefer shared parser helpers where available.
- Avoid new ad hoc regex parsing unless the existing parser cannot support the endpoint yet.
- Preserve the raw event code even if the current UI or scoring system does not use it yet. Future tournament modes can derive rules from this structured data.
- Store ids as identifiers and names as display fields.
- Be careful with localized country/league names.

Known parser risks:

- `src/server/api/teams/info.ts` still has bespoke parsing.
- Some country/league logic still uses display-name fallbacks.
- `teamdetails` country id coverage has historically lagged behind country name usage.

## Debugging

When CHPP behavior is unclear:

- inspect raw XML response snippets
- include request ids or unique log markers in server handlers
- verify the deployed route is the route being executed
- use `/forge/testing` for debug tooling instead of adding new API files
- confirm Vercel function count remains at or below 12

## Detailed References

- `docs/AGENTS_CHPP_INTEGRATION.md`
- `docs/# CHPP Files help.md`
- `docs/auth-flow.md`
- `docs/chpp-audit.md`
- `docs/chpp-parser-audit.md`
- `docs/match-event-types.md`
- `docs/challenges.params.md`
- `docs/*.schema.xml`
- `docs/*.example.xml`


## Organizer-added validated reserves

Private admin lookup resolves candidate managers from `profiles.teams_json`
(including the legacy JSON-string shape) and historical tournament team entries.
Cached ownership is a hint only. The candidate's saved credentials must fetch
`managercompendium` without a `userID` override, identify that token owner and
include the selected HT team before it can be marked validated. The regular
reserve-registration helper writes the same owner and validation metadata as a
self-service reserve join. Existing unvalidated reserves can be upgraded in place.
Credential failure never silently grants validation; an unvalidated add remains
an explicit option. Credentials and lookup internals are never returned publicly.

Reserve admission reuses public teamdetails/matches booking checks; selected
reserve rankings are refreshed as part of that explicit check. The final admit
request repeats availability checks, then invokes the private atomic slot RPC.
No challenge automation or ratings-sharing consent is enabled by validation.


### Post-outage fixture refresh follow-up (2026-10-28)

Manual result refresh and automatic live polling use the same 30-ID batching
rule. Batches run sequentially; a failed manual batch reports the error and exits
through the existing loading-state cleanup. Automatic fixture refresh skips
completed matches; explicit manual refresh retains finished-match resync.
Overdue ongoing fixtures remain eligible for explicit refresh without extending
the four-hour automatic live polling window or inferring completion from time.

A later export (15:18–15:26 Riga) showed 423 `Fixture performance changed`
serialization errors. Migration 157 changes the rating RPC's two stale-input
business exceptions to `PT409`, preserving validation and rollback. The caller
rereads persisted facts and retries once; another conflict is reported separately
from saved match results. Migration application and stopping existing database
retry loops require owner action; local mocked tests do not establish recovery.
