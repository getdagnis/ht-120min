# Forge Leagues

`/forge/leagues` is a private organizer helper for leagues with 1–1200 active teams.
It lists opportunities, without tournament registration, consent inference,
challengeability checks or challenge sending. Forge locale editors cannot access it.

Groups: 1–115, 116–150, 151–200, 201–300, 301–800, 801–1200 and All. Leagues
sort by active-team count ascending. A league is marked **Fetched** only when a
complete team list exists in the database. The catalogue reads saved league IDs
once on page load; the marker also updates after successful completion/save.

## Separate operations

- **Populate/Rebuild team list:** `leaguelevels` 1.0 → `leaguedetails` 1.6 →
  `teamdetails` 3.9. Discard ownerless, bot, deactivated and outside-league teams.
  Save names, team/manager IDs and country ID; do not request matches or logos.
  Rebuilding leaves the previous DB snapshot intact until the new list finishes.
- **Check next-match status/Refresh availability:** only `teamdetails` 3.9.
  `StillInCup` provides cup status. Explicit `FriendlyTeamID=0` means not booked,
  positive ID means booked, and missing/empty/invalid values mean Unknown. The
  shared general teamdetails parser defaults missing friendly fields to zero, so
  this helper intentionally parses these fields directly from the requested team.
- **Precise check (matches):** an explicit second-level action, rereading
  teamdetails and checking `matches` 2.9 for upcoming/ongoing friendlies. Cup
  participants need no extra matches call. Positive booking evidence from either
  source is retained. Failed/incomplete fixture checks remain Unknown.

Available requires confirmed not booked and not in cup. No date/window selector.
The list records whether the latest availability pass used teamdetails or matches.
All teams, Available and Users share one list; Users deduplicates manager IDs.
Basic checks do not filter by Hattrick's accept-challenges settings.

## Browser progress, one completion write

Scan requests handle up to three series or teams concurrently, without a fixed
per-team sleep. Working results, queue/cursor, expected saved revision and operation
UUID stay in browser memory and sessionStorage, keyed by league. Pause, cancel,
unmount or failed batches do **not** write a snapshot. Reloading the same browser
tab can resume its draft. If browser storage is unavailable, progress survives only
while the component remains open. Population failures keep the failed batch pending;
availability failures advance with Unknown and can be retried with a fresh pass.

At completion the client calls **save once**. The server validates the bounded list,
reads its current revision once and executes exactly one INSERT or conditional UPDATE.
It stores only complete lists, with no work queues (`job=null`). A UUID identifies
completion retries: a lost success response can be retried without writing again.
Save failures retain the completed browser draft and show Save results. Concurrent
changes return a conflict without overwriting another tab; Reload saved list explicitly
confirms discarding the local draft. No per-team snapshot reads, leases, revision writes
or progress saves remain. Legacy persisted jobs may be resumed as browser drafts.

**Resource contract:** catalogue load = one small saved-ID query; selecting a league
= one saved-list read (or its browser draft); scan batches = zero snapshot queries
and zero DB writes; successful completion = one revision/list read and one write.
Scanner credentials have a five-minute server-process cache; new/cold instances or
expiry may still require a credential lookup per batch, never per team inside it.
The world catalogue has a 24-hour process cache. No credentials go to the browser.

## Private storage and API

Migration 110 creates `forge_league_snapshots`; 111 increases its list cap to 1200.
Both have owner-added applied markers, not independently verified here. No new
migration is needed for this change; the old lease columns remain unused.

One replaceable snapshot per explicitly scanned league, separate from `teams` and
`profiles`. Persist names/IDs, country ID, availability/error observations and check
method/timestamps plus completion UUID. No logos, bot status, series/division
metadata, credentials, global identity directory or background crawler.

RLS stays enabled with no public policies. PUBLIC/anon/authenticated have no table
privileges; only server-side service-role access. Existing consolidated testing
routing (`tool=leagues`) checks Forge enablement/admin authorization for every action.
No API route/serverless function added. POST snapshot payloads are private helper
lists, validated server-side; they never authorize tournament ownership or automation.

GET: `catalogue`, `snapshot`. POST: `populate` (series IDs), `series` (up to three
series IDs → candidates), `teams` (up to three IDs → identity), `availability` or
`precise` (up to three IDs → current availability), `save` (complete snapshot,
expected revision, completion UUID). All are gated by Forge admin access.

## Evidence and manual checks

Local compilation/source inspection do not prove live CHPP fields, query counts,
Supabase execution or browser persistence. Prerequisites: Forge enabled, admin
login, stored admin CHPP access, migrations 110/111 applied.

- UI: inspect Fetched markers, separate basic/precise buttons, working vs saved list,
  pause/continue/cancel, tab reload and save-failure retry. Confirm paused/uncompleted
  drafts do not gain Fetched unless a previous complete DB list already existed.
- Real integration: compare known free/booked/cup teams. Empty FriendlyTeamID must
  stay Unknown. Confirm ordinary checks make no `matches` requests; precise checks
  do. Verify no snapshot table mutation occurs until one completion INSERT/UPDATE.
  Retry the same completion UUID and verify no second write. Competing-tab save
  must return conflict and keep local results. Anonymous/locale-editor requests and
  direct anon/authenticated database access must remain denied.

Discovery XML remains a separate real integration check. Local docs cover world,
team and matches fields; public client definitions at
https://github.com/lucianoq/hattrick/tree/master/chpp were supplemental discovery
field-layout evidence, not live verification.

## Corrected resource mistake

The initial scanner saved a growing snapshot and lease/revision on every single-team
step, plus a three-second wait per step. This contradicted the lightweight snapshot
intent and caused excess DB writes and long scans. The current handler isolates all
snapshot mutations in its explicit completion save branch. Keep that boundary:
progress belongs in browser storage, not database checkpoints.
