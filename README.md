# HT-120min

HT-120min helps Hattrick communities organize recurring 120-minute friendlies without spreadsheets, forum juggling, or manual standings work.

The product is intentionally narrow: friendly tournaments for small communities, private leagues, and regional groups. It is not a general tournament platform.

## Mandatory development principle: product necessity before complexity

> **Implement the simplest reliable behaviour that satisfies the actual user need. Do not invent stricter requirements and then build infrastructure to satisfy them.**

Simplicity means fewer moving parts, execution paths and repeated operations,
with behaviour organizers can explain and predict. Preserve necessary security
and data integrity safeguards.

- Establish the outcome, actual timing and acceptable delay before choosing a mechanism. Immediate, continuous or automatic execution must earn its cost.
- Choose triggers from the real workflow. Live-score updates must not drive participant changes or next-round pairings when that work can wait until the weekly playing window ends.
- Evaluate the full cost across visitors, tabs and requests, including indirect operations, failures and retries. “Not ready” normally means stop without writes or immediate retries.
- Reuse existing paths. Justify new infrastructure and abstractions with a concrete need and explain why a simpler approach cannot meet it. Evaluate implementation suggestions from both users and agents.
- Keep feature and incident fixes proportional, remove obsolete triggers, and verify the actual database/API work in the user journey.

**Agents must justify complexity before introducing it.** The mandatory working
rules are in [AGENTS.md](AGENTS.md#mandatory-principle-justify-complexity-through-product-necessity).

## Stack

- Next.js App Router
- React 19
- TypeScript
- Sass modules
- Supabase
- Vercel route handlers / serverless deployment
- Hattrick CHPP OAuth/API

## Setup

Run locally:

```bash
npm i
npm run dev       # Next.js development server
```

The public application is served under `/en` and `/lv`; unprefixed public URLs redirect to `/en`.
Forge remains English-only and is disabled by default at `/forge`; enable it explicitly with `FORGE_ENABLED=true`.

The browser expects `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Server-side CHPP and Supabase credentials remain
private and are used only by Next route handlers.

Server-only deployment variables also include `SUPABASE_SECRET_KEY`, `APP_SESSION_SECRET`, and
`FORGE_SUPERADMIN_HT_ID`, and `FORGE_ENABLED`. Keep these server-only and never expose them in browser copy.

## Commands

```bash
npm run dev       # local Next.js dev server
npm run build     # server import check + Next.js production build
npm run start     # serve the production build
npm test          # Node test runner over tests/*.test.ts
npm run lint      # ESLint
npm run preview   # alias for the production server
vercel --prod     # deploys to Vercel, when the CLI is authenticated
```

## Deployment

The app deploys to Vercel and uses Supabase for persistence. Public pages are owned by the
Next.js App Router; the deferred Forge UI is the only remaining React Router consumer.

Important deployment constraint: current Vercel plan allows 12 serverless functions.
The migrated application exposes one consolidated Next.js API route at
`src/app/api/[[...path]]/route.ts`; handler implementations live under
`src/server/api/` and are not standalone root `api/` functions.

## Documentation

- `AGENTS.md` - short routing guide for agents.
- `AGENT_ONBOARDING.md` - optional deep-orientation checklist for new agents.
- `PROJECT_STATE.md` - current implementation, migration, test, and production status ledger.
- `ROADMAP.md` - product direction.
- `docs/architecture.md` - frontend structure and ownership boundaries.
- `docs/scheduling.md` - Hattrick calendar, schedule generation, and rescheduling rules.
- `docs/chpp.md` - CHPP auth, endpoint usage, parser rules, and known limitations.
- `docs/database-and-deployment.md` - Supabase model, migrations, RLS assumptions, and Vercel constraints.

Forge is the deferred private site-admin area at `/forge`. It includes the FAQ editor, protected CHPP testing
toolkit, and usage statistics, but is disabled unless `FORGE_ENABLED=true`. Forge login uses the separate signed
server session; the normal HT-120min login remains independent. Activity statistics require migration
`059_activity_ledger.sql` and the server-only Supabase key.

Detailed CHPP schemas, XML examples, audits, and screenshots remain in `docs/` as reference material.
