# Architecture

HT-120min is a Next.js App Router application backed by Supabase and a consolidated API route for CHPP, OAuth,
matchmaker, tournament, telemetry, and deferred Forge operations.

## Route ownership

| Route | Owner | Rendering boundary |
| --- | --- | --- |
| `/en`, `/lv` | `src/app/(public)/[locale]/page.tsx` | Server-loaded Home snapshot plus client interactions |
| `/[locale]/t/[slug]` | `src/app/(public)/[locale]/t/[slug]/page.tsx` | Server-loaded Tournament snapshot plus client tabs/forms |
| `/[locale]/create` | `src/app/(public)/[locale]/create/page.tsx` | Client-only parity screen |
| `/[locale]/matchmaker` | `src/app/(public)/[locale]/matchmaker/page.tsx` | Client-only parity screen |
| `/[locale]/supporters` | `src/app/(public)/[locale]/supporters/page.tsx` | Client-only parity screen |
| `/[locale]/auth/callback` | `src/app/(public)/[locale]/auth/callback/page.tsx` | Client-only OAuth finalization screen |
| `/[locale]/tinder` | `src/app/(public)/[locale]/tinder/page.tsx` | Redirect alias to Matchmaker |
| `/forge/**` | `src/app/(forge)/` | Deferred, disabled unless `FORGE_ENABLED=true` |
| `/api/**` | `src/app/api/[[...path]]/route.ts` | Consolidated route handler |

The localized public layout owns the server-rendered `<html lang>` value, locale provider, metadata, scroll behavior,
and shared `Layout`. Unprefixed public URLs are redirected by `src/proxy.ts` to the preferred locale.

## Frontend shape

- `src/legacy-pages/Home` owns Home content and public tournament entry points.
- `src/legacy-pages/Create` owns tournament creation and organizer linking.
- `src/legacy-pages/Public/TournamentView.tsx` owns tournament tabs, admin controls, schedule operations, results,
  chat, news, and join flows.
- `src/legacy-pages/Public/Matchmaker.tsx` owns friendly-ad browsing and Matchmaker interactions.
- `src/legacy-pages/Forge` contains the deferred site-admin UI and remains the only React Router consumer.
- `src/components/` contains reusable UI and tab-level client components.
- `src/i18n/` contains locale validation, dictionaries, and language switching.
- `src/global.sass` contains global Sass variables and theme styles; component styles use Sass modules.
- `src/next/ClientOnlyPublicRoutes.tsx` contains temporary client-only parity boundaries for non-SSR public routes.

`TournamentView.tsx` is large and stateful. Extract reusable pieces when making substantial changes, but do not
refactor it casually during unrelated fixes.

## Server and data flow

Home and Tournament View load initial public data through `src/app/_data/public-data.ts` in server components using
the public Supabase key and the same RLS policy as anonymous browser visitors. The serialized snapshot is passed into
the hydrated client tree; client effects handle identity, storage preferences, live clocks, viewport state, mutations,
and interactive tabs.

Server implementation is under `src/server/api/`. The App Router adapter preserves the existing public API URLs while
dispatching them to the current handlers. Any source imported by that server tree must use explicit runtime `.js`
extensions for relative imports.

## Hydration and time rules

The first server render must not depend on browser-only identity, localStorage, viewport measurements, current time,
random selection, or implicit browser timezone formatting. Use the shared hydration-safe hooks in
`src/hooks/useHydratedBrowserState.ts` and keep CHPP Stockholm wall-clock parsing separate from generated schedule
instants and ordinary Riga display timestamps.

## Deferred Forge boundary

Forge is a frozen, deferred subsystem for possible future site-admin workflows. It is not part of public migration
completion criteria. Its UI may retain React Router, but `/forge`, Forge session/statistics endpoints, and Forge testing
handlers must remain protected server-side and disabled unless `FORGE_ENABLED=true`.

## Reusable UI

Use existing `Button`, `Card`, `HeroCard`, `SectionCard`, `SidebarWidget`, `Modal`, `TournamentCard`, `FixtureCard`,
`Avatar`, `TeamByline`, `TeamDisplay`, `SupportersWall`, `MottoWidget`, `TinderWidget`, `ProfileModal`, and
`TeamSelectorModal` components before adding new page-local patterns.

## Detailed references

- `AGENTS.md` - agent constraints and task routing.
- `AGENT_ONBOARDING.md` - first-pass orientation.
- `PROJECT_STATE.md` - current implementation and deployment status.
- `docs/auth-flow.md` - OAuth flow and callback contracts.
- `docs/chpp.md` - CHPP endpoint and parser rules.
- `docs/database-and-deployment.md` - Supabase, RLS, migrations, and Vercel constraints.
- `docs/scheduling.md` - calendar and schedule-generation rules.
