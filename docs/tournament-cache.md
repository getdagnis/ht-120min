# Public tournament caching and navigation recovery

Implemented locally; reviewed by reading source and diff only. No tests, lint,
typechecks, build, local server, browser automation or verification script were
run for this recovery. Runtime correctness, cache reuse, request counts and
navigation timing remain unverified and require owner testing.

## Ownership and freshness

[`public-data.ts`](../src/app/_data/public-data.ts) uses the installed Next 16
`unstable_cache` Data Cache, plus React request memoization. The header is keyed
by slug. The public bundle is keyed by tournament ID, current season, UTC day
(daily manager spotlight) and the public header values. It includes the existing
`tournament_seasons.snapshot_json` and `fixtures_snapshot_json` archives for local
season selection; switching an already-loaded season needs no server navigation
or new historical storage. A different tournament remounts the client view.

Both cache entries revalidate after **60 seconds**. This is Next's on-demand
background revalidation, not a scheduled refresh or a strict 60-second delivery
guarantee: the first request after expiry can receive stale data while Next
refreshes it. Cold reads and reads after explicit invalidation rebuild the public
payload. Database failures do not cache empty core rosters/fixtures.

[`tournament-public-fields.ts`](../src/lib/tournament-public-fields.ts) selects
public columns explicitly. Passwords, recovery email, OAuth credentials, private
announcement audiences and dismissals are excluded. The existing season archive
builders were reviewed: they contain public standings, identities, fixtures,
awards and event summaries, not credential-bearing team rows. Profile JSON is
used to build an allowlisted spotlight; raw profiles are not returned. Ongoing
scores/event counters are cleared from the cached payload and refreshed through
the separate existing live/fixture paths. Presence remains an uncached read.

[`tournament-actions.ts`](../src/app/_data/tournament-actions.ts) provides shared
public refreshes and uncached private reads. Private reads verify the signed
session/role or the submitted legacy password server-side. Operational
credentials are returned only to operational admins; a press role alone cannot
use legacy password login. Public cache callbacks receive no viewer/session data
and perform no CHPP calls or publication writes. Anonymous hydration does not
repeat the full loader. Signed viewers can still load their private messages and
settings separately; chat, presence and live polling keep their existing paths.

## Mutation invalidation

[`tournament-cache.ts`](../src/server/api/_lib/tournament-cache.ts) immediately
expires ID and slug tags with `revalidateTag(tag, { expire: 0 })`. Tags belong to
one tournament and cover its current data and included historical archives;
unrelated tournaments are not invalidated.

The existing consolidated API adapter invalidates successful registration/team,
rank, schedule, repair, result, reserve, fixture-refresh and applied match-detail
backfill mutations. CHPP final observations invalidate; changing live scores are
not placed in this cache. OAuth registration/claim responses identify the
affected tournaments. Preview/dry-run fixture calls do not purge. API purge
failures are logged and signaled by `X-Tournament-Cache: invalidation-failed`,
without turning an already completed write into a failed submission.

Legacy browser edits in `TournamentView.tsx` request an authorized scoped purge
before refreshing through the shared loader, or after an optimistic local update.
These cover settings, team edits, manual schedule/results and season archive
corrections. API callers already purged by the adapter avoid duplicate purges
where explicitly marked and retry when the failure header is present. Local
edits remain visible through state updates/explicit refresh; live finish callbacks
refresh fixtures separately. A reconnect refreshes public data without purging.
Direct database/legacy writers outside these paths rely on fallback revalidation.
No new tables, migrations, API route handlers, workers or dispatch protocols were
added. A future mutation of a selected public field must use this same scoped
invalidation helper after its successful write.

`[public-tournament] rebuild` and `[public-tournament] invalidated` runtime log
lines make manual cache checks possible without synthetic tooling. They contain
only public tournament IDs and season numbers. Browser network panels alone
cannot count Supabase reads made inside a server component.

## Deployment

1. Review and commit only the task files. Preserve unrelated activity Sass,
   `public/default-avatar.png` and the externally changed `next-env.d.ts`.
2. Push the reviewed branch when ready and deploy it through the existing Vercel
   Git integration; test its preview manually before merging/promoting production.
   This implementation has not been committed, pushed or deployed by the agent.
3. No new configuration is required. Retain `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
   (or the existing service-role fallback) and `APP_SESSION_SECRET`. Keep the
   already-enabled `PUBLIC_HOME_SNAPSHOT_ENABLED=true`, existing
   `PUBLIC_HOME_WORKER_SECRET` and Home dispatch configuration unchanged.
   Do not reapply migrations 088–090 for this code change.
4. The read-only Vercel inspection on 2026-10-04 showed the project uses Next.js,
   Node 24.x and a ready production deployment of `8d98cad169d5ab4c09a3cc211c4f1f7f5c54fb96`
   in `iad1`. Supabase/session keys and the Home flag are configured for production
   and preview; the Home worker secret is production-scoped. Encrypted values
   were not decrypted. The owner confirms the Home flag is enabled and 088–090
   are applied; database dispatch health was not independently tested.

## Owner manual checklist

- **UI:** Click Home → tournament with mouse and keyboard. Expect immediate
  feedback or destination content. Repeat with two different tournaments.
- **Cache:** In fresh sessions, revisit/reload the same tournament within 60
  seconds. Look for reuse without another `[public-tournament] rebuild`; compare
  Vercel/Supabase request counts where available. Presence, auth, chat, private
  reads and due live fixtures can still issue requests. Navigation timings have
  not been measured for this implementation.
- **Hydration/tabs:** Confirm hydration does not run the full public refresh
  action again. Change standings/fixtures/news/history/admin tabs; expect no RSC
  navigation/full tournament loader. Fixtures can still legitimately poll CHPP.
- **Seasons/history:** Select current and finished seasons, open their direct
  URLs, reload, and use Back/Forward. Confirm standings and frozen fixtures remain
  correct. Archived seasons without saved fixtures keep the existing empty state.
- **Real registration:** With an eligible owned Hattrick team, click Join, check
  immediate connecting feedback, try a rapid second click, complete selection,
  and confirm only one registration. Test return from OAuth and browser Back.
- **Real edits:** On an authorized disposable tournament, change a public
  setting, team/registration, fixture/result and an archive report. Expect scoped
  invalidation logs and the saved value immediately for the editor and on a fresh
  visit. Check an unrelated tournament remains warm. Check password login and
  delegated permissions, and that anonymous payloads omit private fields/messages.
- **Real live updates:** During a real linked match, confirm new scores appear,
  completion refreshes standings, chat/presence still work and reconnect refreshes
  the view. CHPP ownership/live data are required; UI inspection alone cannot
  prove this integration.
