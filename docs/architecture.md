# Architecture

HT-120min is a Vite/React application backed by Supabase and a small set of Vercel serverless functions for CHPP/OAuth work.

## Frontend Shape

- `src/pages/Home` lists featured/open tournaments and entry points.
- `src/pages/Create` owns tournament creation, organizer linking, local draft persistence, and team selection before insert.
- `src/pages/Public/TournamentView.tsx` owns the public tournament screen, tab switching, admin mode, schedule generation/regeneration calls, match refresh, chat/news, and tournament-level admin actions.
- `src/pages/Forge` owns the site-admin shell, dashboard widgets, FAQ editor, testing hub, and future admin surfaces.
- `src/pages/Public/Matchmaker.tsx` owns friendly ad browsing and matchmaker interactions.
- `src/components/TournamentTabs/*` contains tab-level tournament UI.
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

- Supabase is accessed directly from the frontend for app-owned tournament data.
- Site-wide editable content such as the FAQ is stored in Supabase as JSON and loaded by both Home and Forge.
- Vercel functions handle CHPP OAuth, CHPP XML requests, matchmaker server actions, and fixture refresh.
- App-owned tournaments are stored in Supabase; Hattrick/CHPP is used for identity, team metadata, friendly booking, and result sync.
- Standings are derived from app DB matches, not CHPP tournament endpoints.

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
- `src/pages/Public/TournamentView.tsx`
- `src/utils/standings.ts`
- `src/utils/tournament-next-match.ts`
