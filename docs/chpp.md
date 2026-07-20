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
- `matchdetails`: authoritative source for ongoing/finished match state and result sync.
- `live`: lightweight ongoing monitoring only; do not use it for final match state.
- `challenges`: challengeable/challenge actions when direct friendly management is needed.
- `worlddetails` and `leaguedetails`: preferred direction for canonical country/league normalization.

Do not use Hattrick website pages or undocumented interfaces. CHPP products must use documented CHPP files only.

## Match Refresh Rules

- Fixture refresh uses `matches` to detect arranged friendlies.
- Normal friendlies and cup friendlies are valid: match types `4`, `5`, `8`, `9`.
- `Status` may be absent/null in older local rows; treat missing app status as `not_arranged` when appropriate.
- Reversed Hattrick home/away still counts as the correct arranged match if both teams match and the date is within the accepted window.
- Record venue mismatch metadata instead of rejecting the match.
- Result sync uses `matchdetails` with `matchEvents=true`.
- Extra time should be detected from event type `70`, match parts `3/4`, and scorer/event evidence as described in `AGENTS_CHPP_INTEGRATION.md`.

## Structured Match Event Contract

- Request `matchdetails` with `version=3.1&matchEvents=true`. Both parameters are required for the event-level payload.
- `api/_lib/chpp-match-events.ts` is the shared server parser. Both live refresh and manual match linking must use it; do not create a third parser for event summaries.
- Store the structured payload in `matches.match_event_details`, mapped to the **scheduled fixture sides**. This keeps cards/injuries correct when CHPP home/away is reversed or an admin links one BYE team to an outside friendly.
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

- `api/teams/info.ts` still has bespoke parsing.
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
