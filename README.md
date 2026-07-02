# HT-120min

HT-120min helps Hattrick communities organize recurring 120-minute friendlies without spreadsheets, forum juggling, or manual standings work.

The product is intentionally narrow: friendly tournaments for small communities, private leagues, and regional groups. It is not a general tournament platform.

## Stack

- Vite
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
npm run dev       # or vite, vite --host (local network access), runs vite project on 5173
vercel dev        # runs dev server with vercel serverless functions enabled on 3000
```

App expects  Vite public Supabase variables plus server-side CHPP credentials for API routes.

## Commands

```bash
npm run dev       # local Vite dev server
npm run build     # TypeScript build + Vite production build
npm test          # Node test runner over tests/*.test.ts
npm run lint      # ESLint
npm run preview   # preview production build
vercel --prod     # deploys to vercel
```

## Deployment

The app deploys to Vercel and uses Supabase for persistence.

Important deployment constraint: current Vercel plan allows 12 serverless functions.
Project has at any point likely maxed out at that limit.
Every `.ts` file under `api/` outside `_lib/` counts as one function.

Before adding an API endpoint:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
```

Shared server code belongs in `api/_lib/`; debug routes belong in `api/testing/index.ts`.

## Documentation

- `AGENTS.md` - short routing guide for agents.
- `PROJECT_STATE.md` - current implementation, migration, test, and production status ledger.
- `ROADMAP.md` - product direction.
- `docs/architecture.md` - frontend structure and ownership boundaries.
- `docs/scheduling.md` - Hattrick calendar, schedule generation, and rescheduling rules.
- `docs/chpp.md` - CHPP auth, endpoint usage, parser rules, and known limitations.
- `docs/database-and-deployment.md` - Supabase model, migrations, RLS assumptions, and Vercel constraints.

Detailed CHPP schemas, XML examples, audits, and screenshots remain in `docs/` as reference material.
