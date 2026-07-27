# HT-120min

HT-120min helps Hattrick communities organize recurring 120-minute friendlies without spreadsheets, forum juggling, or manual standings work.

The product is intentionally narrow: friendly tournaments for small communities, private leagues, and regional groups. It is not a general tournament platform.

## Stack

- Next.js App Router
- React 19
- TypeScript
- React Router 7
- Sass modules
- Supabase
- Vercel Serverless Functions
- Hattrick CHPP OAuth/API

## Setup

Run locally:

```bash
npm i
npm run dev       # Next.js development server
vercel dev        # runs dev server with vercel serverless functions enabled on 3000
```

The public application is served under `/en` and `/lv`; unprefixed public URLs redirect to `/en`.
Forge remains English-only at `/forge`.

The browser expects `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Server-side CHPP and Supabase credentials remain
private and are used only by Next route handlers.

Server-only deployment variables also include `SUPABASE_SECRET_KEY`, `APP_SESSION_SECRET`, and
`FORGE_SUPERADMIN_HT_ID`. Keep these server-only and never expose them in browser copy.

## Commands

```bash
npm run dev       # local Next.js dev server
npm run build     # server import check + Next.js production build
npm run start     # serve the production build
npm test          # Node test runner over tests/*.test.ts
npm run lint      # ESLint
npm run preview   # alias for the production server
vercel --prod     # deploys to vercel
```

## Deployment

The app deploys to Vercel and uses Supabase for persistence.

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

Forge is the private site-admin area at `/forge`. It includes the FAQ editor, protected CHPP testing toolkit,
and usage statistics. Forge login uses the separate signed server session; the normal HT-120min login remains
independent. Activity statistics require migration `059_activity_ledger.sql` and the server-only Supabase key.

Detailed CHPP schemas, XML examples, audits, and screenshots remain in `docs/` as reference material.
