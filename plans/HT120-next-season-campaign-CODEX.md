# HT-120min — superseded interest-poll brief

**Historical brief only. The poll, donation-note consent, and donation webhook requirements below were superseded by the four-product Buy Me a Coffee Shop fundraiser on 19 November 2026. Current behavior and rollout steps: `docs/fundraiser.md`.**

## Goal and limits

The current season is still running. Ask whether managers need HT-120min to continue after it, and **which competitions they would genuinely join**. The project is running low on fuel. Invite optional contributions without creating commitments. Keep required operational attention minimal.

**Important distinction:** **voting and donations are independent**. Managers select their interests first; Buy Me a Coffee (BMC) and Revolut are separate actions in the modal. The app does **not** check whether a voter donated, and donations are **not** allocated to specific competitions. **BMC webhook integration is required** for an automatically maintained recognition line; Revolut contributions are not ingested. Do not introduce category codes, vote attribution, or extra steps on the main UI.

Read `AGENTS.md`, `docs/architecture.md`, `docs/database-and-deployment.md`, and `PROJECT_STATE.md`. Use existing Next.js App Router, React/TypeScript, Supabase, signed Hattrick sessions, next-intl EN/LV, reusable components and `.module.sass`. Prepare work on an isolated feature branch for owner review. Do **not** apply production migrations, commit, push, open a PR, deploy, modify paid accounts, or alter tournaments/fixtures without the owner's authorization under `AGENTS.md`. No new general state manager, payment SDK, CRON or polling system.

**Repository constraints found during planning:** `src/legacy-pages/Home/Home.tsx` already owns Home and the tournament listing, plus an existing welcome modal. `src/app/api/[[...path]]/route.ts` is the consolidated API handler, and `docs/database-and-deployment.md` records the Vercel budget at 12/12 functions. Keep the webhook inside that handler; do not create another Next route file. The latest observed root migration is `168_unlinked_matches_resolve_rounds.sql`; recheck before numbering. Localhost connects to production Supabase, so do not apply migrations or write test rows as a local convenience.

## Four free vote choices

| Key | Public title | Clear one-line explanation |
|---|---|---|
| `exotic_hfi` | 🌴 Exotic HFI Leagues | Domestic friendlies for managers in smaller HFI nations. |
| `flag_hunters` | 🏴 Flag Hunters | A dedicated league for collecting rare Hattrick flags. |
| `one_twenty` | ⚽ 120-Minute Football | A tournament dedicated to full 120-minute matches and preparation. |
| `bone_crushers` | 💀 Bone Crushers / Fantasy Leagues | A new layer of competition based on existing Hattrick matches — no friendlies or extra scheduling needed. |

Include a very short **What's this?** expander for Bone Crushers. Do not invent rules or pretend the format is finalized.

Approved question and tone:
> **Do you think HT-120min should continue for another season?**
>
> The project is running low on fuel. Your interest in participating will help decide whether HT-120min brings its tournaments back after this season. Which competitions would you like to see return? Choose the ones you'd actually play in. If you'd like to put some fuel back in the tank, you can contribute through Buy Me a Coffee or Revolut.

Use natural EN/LV copy with concise tone. No artificial scarcity, pressure, obligation or promises of a tournament if a goal is met.

## Essential UI — stay clean

Keep the original attractive **four-card layout**; no checkout widgets, campaign codes, donation verification messages or sponsor directory inside each card. Each card shows:

- Title, concise description, **real distinct-manager interest count**, selected visual state.
- One immediate voting action; signed-in manager can toggle selections (multi-select). **Voting never opens BMC or Revolut.** Both contribution options sit below the cards inside the modal. Disable repeat clicks while a save is in flight; show an inline retryable error if saving fails. Anonymous choice prompts Hattrick sign-in and returns to the campaign page. A contribution click never confirms a saved vote or payment.
- The screenshot's four `€0 / €20` bars imply donation attribution that BMC cannot provide. Retain **€20 suggested support per idea** as editorial motivation if useful, but **do not render four monetary progress bars**. This implementation omits monetary totals entirely; interest counts remain primary, and no target promises delivery.

Below the cards, one compact **Supported by** line/strip (for example: “Supported by · @manager1 · @manager2 · +3 others”). Supporter names are verified contributors **to BMC**, but their Hattrick usernames are self-reported, **not verified Hattrick account ownership**. No ranking, donor amounts, supporter avatars, spotlight cards, separate donation form or intrusive animation. Hide gracefully if no publicly consenting supporters yet. Show unique opted-in names, not one row per tip. A minimal thank-you sentence is enough.

**Privacy / opt-in**: BMC supporters commonly write their Hattrick username in their tip. Do not assume that mentioning a name grants permission to republish it on HT-120min. Put one unobtrusive sentence next to the BMC link / supporter strip: **“Want your Hattrick name in Supported by? Include `HT:YourName #public` in your Buy Me a Coffee message.”** Publish only when there is a single parsable username, explicit `#public` consent, and BMC `note_hidden` is not true. Supporter may instead remain anonymous; email, raw notes and amounts are never public. Treat names as untrusted text, escape/sanitize before display; no unverified clickable Hattrick profile link. Do not log raw support messages or emails.

### Discoverability and interruption

- One locale-aware, shareable, responsive public campaign page, following existing routes.
- One concise banner by the Home tournament listing, dismissible per browser; the existing Home component is also the tournament listing, so do not duplicate promotion. Keep an ordinary route link accessible while active.
- One image-free WelcomeModal on Home for **guests and unanswered signed-in managers**, at most **once per rolling 24 h per browser**. It asks whether HT-120min should continue and contains all four choices, BMC, and Revolut. “Not now” snoozes; “Don't show again” turns off automatic prompts; a saved answer suppresses them. Show the small banner after dismissal or on later visits; it reopens the modal. Pause the other welcome prompts and BeerBanner while the campaign is active.
- Campaign configurable active/closed/hidden without admin UI. Closed hides prompts and voting, retains public results/supporter thanks. Hidden hides all campaign promotion. EN/LV strings, keyboard/Escape/focus and mobile support.

## Voting data — small and robust

- One campaign vote table with unique `(campaign_key, hattrick_user_id)`, validated set/array of the four choice keys, `responded_at`, `updated_at`. An empty array is a saved “none of these” answer and suppresses the modal. Signed-in Hattrick user ID comes from the verified app session **server-side**, never from the client; this is not Supabase Auth identity. One manager can select multiple competitions and edit the full set. Keep base-table reads and writes service-only; public responses return aggregate counts, while only that manager's authenticated response includes selections.
- Avoid rapid-toggle lost updates: serialize local writes or implement safe optimistic update/version semantics. No fake votes or duplicate counts.
- Use one small consolidated `GET /api/app?route=next-season` (or equivalent existing dispatch) for status, counts, public supporter summary, and optional private own selection; `POST` replaces the full selection set. Mark personalized responses private/no-store. Fetch on page load and after a successful write, not on a timer. Avoid repeated invalidation of tournament snapshots and a new general survey engine.

## Buy Me a Coffee — simple UI, real server integration

Reuse the existing `https://buymeacoffee.com/dagnis` creator URL already used by `BeerBanner`. No guessed category/referral query parameters or nonexistent BMC goal/checkout APIs. Link to BMC only from the prominent support action; **do not infer a payment from a click**, attempt cross-site checkout matching, or associate a donor with the user's vote.

Official documentation:
- Webhooks: https://help.buymeacoffee.com/en/articles/15743173-how-to-setup-and-use-buy-me-a-coffee-webhooks
- OpenAPI spec: https://cdn.buymeacoffee.com/assets/integrations/bmc-webhooks-openapi.json

### Incoming webhook and data model

- Route `POST /api/integrations/buymeacoffee` **through `src/app/api/[[...path]]/route.ts`**. Its current `invoke()` parses JSON before forwarding, so preserve the exact bounded raw body for this route before parsing. Verify `x-signature-sha256` using `HMAC-SHA256(rawBody, BMC_WEBHOOK_SECRET)` and fixed-length constant-time comparison. Reject invalid signatures, malformed or oversized bodies. No client-visible secret, OAuth keys or raw private payload logs. Do not add another Vercel function.
- Listen for `donation.created` and `donation.refunded` only (one-time support). Provider event envelope includes `live_mode`; acknowledge but **never write `live_mode:false`** test events. Verify payment ID, success/refund state, amount, currency, and event type. Acknowledge unknown signed event types without mutation. Webhook retries must be idempotent; one payment counts once regardless of deliveries, and refund cannot be resurrected by late/replayed `donation.created` event. Use one atomic refund-dominant database insert/update; a refund received first must still reserve the payment ID as refunded. BMC expects 2xx within 15 seconds and can disable a webhook after repeated failures.
- Store a minimal private ledger: unique provider payment ID, refunded state, optional **publicly opted-in HT display name** parsed from the note, and timestamps. Validate payment amount, currency and success state on intake, but do not store amounts when no monetary total is displayed. Store no payer email, raw note or vote identity matching. Never expose the raw ledger to anon/authenticated browsers. Constrain display names and provide a private operator correction/removal procedure for withdrawn consent.
- Public summary returns only a bounded, deduplicated set of opted-in names. No client polling or event-stream infrastructure. Webhook/read failure must not affect votes. Hide `Supported by` until valid consenting supporters exist.
- Do not show four funded milestones or a combined monetary total without a real need and an accurate attribution/aggregation model.

## Tests / acceptance

Implementation order for local Codex:

1. Reinspect route, session, Home/modal, locale, database, and migration conventions. Create an isolated branch while preserving unrelated edits.
2. Add the next numbered migration for the campaign vote row and private BMC payment ledger, with RLS/service-only access and an atomic refund-dominant write path. Do not apply it to production during implementation.
3. Add the poll and webhook dispatches inside the existing consolidated API function, retaining the webhook's raw body for signature verification. Keep the public result and private own vote separated.
4. Build the localized campaign page, Home banner and modal, plus the compact Supported by line. Match the reference's restraint across desktop and mobile.
5. Run focused tests and the repository's server-import, build, and diff checks; inspect function count and produce a migration/env/deployment handoff. No production writes or external publishing without owner authorization.

- Signed-in unique votes, anonymous refusal, multi-select, reselection, rapid changes, cached public counts vs private own state, disabled/closed campaign, localization.
- Modal at-most-once-per-day on Home (which contains the tournament listing), answered suppression, existing modal priority, keyboard and mobile.
- BMC: signature (real sample signed payload), absent/bad signature, duplicate delivery, create/refund and reverse order, test event ignored, hidden note, explicit opt-in required, missing/ambiguous name, XSS-safe name, non-EUR handling, unknown types, invalid amounts, provider failure. No raw personal information returned in public summary.
- Keep existing Hattrick competition/match scheduling unaffected. Run `npm run check:server-imports`, focused tests/lint/typecheck, build if feasible. No Docker/Playwright requirement.
- Before implementation, confirm `test -f 'src/app/api/[[...path]]/route.ts' && echo 1`, recheck the latest numbered migration, and inspect the existing WelcomeModal and app route dispatcher. In the implementation, measure one page-load summary fetch and bounded database reads; no repeated Home snapshot refresh, cron, or extra Vercel function.
- Handoff summary: files/migration, env names, owner steps, exact production webhook URL, smoke test, security, and incomplete verification. Respect `AGENTS.md` authority before commit, push, PR, production SQL application, or deployment. Update `PROJECT_STATE.md` for the significant new schema/integration, distinguishing prepared code from applied migration and live delivery.

## Owner setup (minimal)

1. Sign in to the existing `https://buymeacoffee.com/dagnis` creator account and confirm its payout settings. The app already uses this public URL, so no new URL setup is needed unless the account changes.
2. After owner review, apply the migration and deploy the matching code. In Buy Me a Coffee Dashboard → **Integrations → New webhook**, enter `https://<actual-production-domain>/api/integrations/buymeacoffee` and select only `donation.created` + `donation.refunded`. Copy its **Signing Secret** into server-only Vercel env `BMC_WEBHOOK_SECRET`, redeploy, then enable deliveries. Never paste the secret into GitHub or chat.
3. Use **Send test event** in BMC and inspect its delivery result for 2xx; test events must add neither money nor supporters. A real donation with `HT:YourName #public` should appear once under Supported by. A donation without consent or with a hidden note must not reveal a public name. A real donation is required for this final integration test; local mocks do not prove it.

**Non-goals:** allocating donations to competition votes; fake per-category progress; building a payment gateway; requiring donation; automatic Hattrick identity verification from BMC; promotional gamification; any tournament feature changes.
