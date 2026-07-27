# Architecture

HT-120min is a Next.js App Router application backed by Supabase and consolidated Vercel route handlers for CHPP/OAuth work. The existing client-heavy feature components remain under `src/legacy-pages/` during the first migration pass so behavior can be preserved while the route shell moves to Next.js.

## Frontend Shape

- `src/legacy-pages/Home` lists featured/open tournaments and entry points.
- `src/legacy-pages/Create` owns tournament creation, organizer linking, local draft persistence, and team selection before insert.
- `src/legacy-pages/Public/TournamentView.tsx` owns the public tournament screen, tab switching, admin mode, schedule generation/regeneration calls, match refresh, chat/news, and tournament-level admin actions.
- `src/legacy-pages/Forge` owns the site-admin shell, dashboard widgets, FAQ editor, testing hub, and future admin surfaces.
- `src/legacy-pages/Public/Matchmaker.tsx` owns friendly ad browsing and matchmaker interactions.
- `src/app/[locale]` provides `/en` and `/lv` route entrypoints; `src/app/_data/public-data.ts` owns server-only initial public reads for Home and Tournament View; `src/i18n` owns locale validation, dictionaries, and language switching.
- `src/next/HomePublicApp.tsx` and `src/next/TournamentPublicApp.tsx` are route-specific hydration boundaries, so those public routes do not load the full compatibility router bundle.
- `src/components/TournamentTabs/*` contains tab-level tournament UI.
- `src/components/TournamentHistory/*` renders frozen season archives, distinctions, records, and yearbook comments.
- `src/components/TournamentTabs/Admin/*` contains admin panel surfaces.
- `src/utils/*` contains scheduling, standings, CHPP-ish parsing helpers, joinability, next-match derivation, and product logic.

`TournamentView.tsx` is currently large and stateful. Prefer extracting reusable pieces when making substantial changes, but do not refactor it casually during unrelated fixes.

## Reusable UI

Use existing components before adding new page-local patterns:

- `Button`
- `Card`, `HeroCard`, `SectionCard`
- `SidebarWidget`
- `Modal`
- `TournamentCard`, `FixtureCard`
- `Avatar`, `TeamByline`, `TeamDisplay`
- `SupportersWall`
- `MottoWidget`, `TinderWidget`
- `ProfileModal`, `TeamSelectorModal`

Styling uses Sass modules plus global CSS variables in `src/styles/global.sass`. Common tokens include `--accent`, `--danger`, `--text60`, `--border`, `--theme`, and `--table-bg-main`.

## Data Flow

- Home and public Tournament View load their initial data through `src/app/_data/public-data.ts` in App Router server components, using the Supabase public key and the same RLS policy as anonymous browser visitors. Their hydrated legacy components retain interactive updates, forms, tabs, and mutation paths.

## Remaining migration plan

The legacy feature tree was designed for a Vite-only browser render. During the App Router transition, a client component can now render once on the server and again in the browser during hydration, so browser-only identity, preferences, viewport state, clocks, random values, and locale-sensitive formatting must not decide the first visible markup.

The remaining migration work is staged as follows:

1. Keep the server snapshot contract explicit for every migrated route: initial public data comes from the App Router page, while browser identity and preferences enter through hydration-safe client boundaries.
2. Audit each migrated route and its shared children for render-time browser APIs, time, randomness, viewport branches, and implicit locale/time-zone formatting. Classify each use as server-safe, post-hydration, or interaction-only.
3. Move repeated browser-only behavior to shared hooks/components. The current baseline is `useHydratedBrowserState.ts` for storage/hydration and client clocks; route-specific data should continue to be passed as serialized server snapshots.
4. Verify Home and Tournament View at desktop/mobile widths, with empty and populated data, logged-out and remembered-user storage, direct loads and client navigation. The explicit App Router pages for Create, Matchmaker, Supporters, Auth Callback, and the Tinder alias are currently client-only parity pages.
5. Complete the public preview gate for OAuth/CHPP, cookies, Supabase reads, locale switching, and authenticated tournament flows before deleting compatibility behavior inside individual feature components. Forge is intentionally deferred and does not block public migration completion.
- Other app-owned tournament reads are still accessed directly from the frontend while their routes remain in the compatibility layer.
- The public FAQ is source-file driven from `src/constants/faq-revised.ts`; Forge edits it in a readable form and exports a replacement source file.
- `src/app/api/[[...path]]/route.ts` adapts the existing `src/server/api` handlers to Next route handlers while preserving API paths and payloads.
- App-owned tournaments are stored in Supabase; Hattrick/CHPP is used for identity, team metadata, friendly booking, and result sync.
- Standings are derived from app DB matches, not CHPP tournament endpoints.
- Finished-season history is rendered from versioned `tournament_seasons.snapshot_json` records so later roster changes do not rewrite the archive.

## Boundaries

- Keep CHPP transport/parsing concerns out of visual components when possible.
- Keep app-owned tournament rules in `src/utils` or RPC migrations, not duplicated in views.
- Keep server-only secrets in API routes. Do not expose service-role or CHPP consumer secrets to frontend code.
- Treat names as display values. Prefer ids for country, league, team, user, and match identity.

## Detailed References

- `AGENTS.md`
- `PROJECT_STATE.md`
- `src/styles/global.sass`
- `src/components/`
- `src/legacy-pages/Public/TournamentView.tsx`
- `src/utils/standings.ts`
- `src/utils/tournament-next-match.ts`
