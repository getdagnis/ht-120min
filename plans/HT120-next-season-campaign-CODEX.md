# HT-120min — Next Season: interest poll + optional community support

**Local Codex implementation brief · reviewed 18 November 2026 · planning only**

## Goal and limits

The organizer has paused HT-120min after a demanding first season. Determine whether people want a new season and **which competitions they would genuinely join**. Invite optional symbolic contributions without creating commitments. The owner will coordinate local implementation, testing and deployment; keep required operational attention minimal.

**Important distinction:** **voting and donations are independent**. A positive competition selection is a free vote and opens Buy Me a Coffee (BMC), but the app does **not** check whether that voter donated, and donations are **not** allocated to specific competitions. **BMC webhook integration is required** for a real, automatically maintained **Supported by** section and optional overall project support total. Do not drop the integration or introduce category codes, attribution, prefilled payment forms or extra steps on the main UI.

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

Suggested intro:
> **What's next for HT-120min?**
>
> I've taken a break after our first season. Before deciding what to continue, I'd like to see which competitions you actually want to play in. Choose any that interest you. If you'd also like to support further development, you can buy me a coffee — completely optional.

Use natural EN/LV copy with concise tone. No artificial scarcity, pressure, obligation or promises of a tournament if a goal is met.

## Essential UI — stay clean

Keep the original attractive **four-card layout**; no checkout widgets, campaign codes, donation verification messages or sponsor directory inside each card. Each card shows:

- Title, concise description, **real distinct-manager interest count**, selected visual state.
- One immediate voting action; signed-in manager can toggle selections (multi-select). A **positive** choice opens the ordinary BMC creator page in a new tab from the user gesture while the free vote saves independently. Disclose that behavior beside the choices so voting does not feel paywalled. Deselection only removes a vote. Disable repeat clicks while a save is in flight; show an inline retryable error if saving fails. A separate small **Support HT-120min** link remains available. Anonymous choice prompts Hattrick sign-in and returns to the campaign page. A BMC click never confirms a saved vote or payment.
- The screenshot's four `€0 / €20` bars imply donation attribution that BMC cannot provide. Retain **€20 suggested support per idea** as editorial motivation if useful, but **do not render four monetary progress bars**. A single site-wide EUR total against a combined €80 symbolic milestone is optional; omit it initially if it weakens the clean composition. Interest counts remain primary, and no target promises delivery.

Below the cards, one compact **Supported by** line/strip (for example: “Supported by · @manager1 · @manager2 · +3 others”). Supporter names are verified contributors **to BMC**, but their Hattrick usernames are self-reported, **not verified Hattrick account ownership**. No ranking, donor amounts, supporter avatars, spotlight cards, separate donation form or intrusive animation. Hide gracefully if no publicly consenting supporters yet. Show unique opted-in names, not one row per tip. A minimal thank-you sentence is enough.

**Privacy / opt-in**: BMC supporters commonly write their Hattrick username in their tip. Do not assume that mentioning a name grants permission to republish it on HT-120min. Put one unobtrusive sentence next to the BMC link / supporter strip: **“Want your Hattrick name in Supported by? Include `HT:YourName #public` in your Buy Me a Coffee message.”** Publish only when there is a single parsable username, explicit `#public` consent, and BMC `note_hidden` is not true. Supporter may instead remain anonymous; email, raw notes and amounts are never public. Treat names as untrusted text, escape/sanitize before display; no unverified clickable Hattrick profile link. Do not log raw support messages or emails.

### Discoverability and interruption

- One locale-aware, shareable, responsive public campaign page, following existing routes.
- One concise banner by the Home tournament listing, dismissible per browser; the existing Home component is also the tournament listing, so do not duplicate promotion. Keep an ordinary route link accessible while active.
- One small automatic modal on Home for **signed-in, unanswered managers**, at most **once per rolling 24 h per browser**, never over the existing welcome modal. “Not now” snoozes; “Don't show again” turns off prompts permanently; a saved answer suppresses it. Logged-out visitors find the page through the banner. The modal only needs a short message and campaign-page CTA.
- Campaign configurable active/closed/hidden without admin UI. Closed hides prompts and voting, retains public results/supporter thanks. Hidden hides all campaign promotion. EN/LV strings, keyboard/Escape/focus and mobile support.

## Voting data — small and robust

- One campaign vote table with unique `(campaign_key, hattrick_user_id)`, validated set/array of the four choice keys, `responded_at`, `updated_at`. An empty array is a saved “none of these” answer and suppresses the modal. Signed-in Hattrick user ID comes from the verified app session **server-side**, never from the client; this is not Supabase Auth identity. One manager can select multiple competitions and edit the full set. Keep base-table reads and writes service-only; public responses return aggregate counts, while only that manager's authenticated response includes selections.
- Avoid rapid-toggle lost updates: serialize local writes or implement safe optimistic update/version semantics. No fake votes or duplicate counts.
- Use one small consolidated `GET /api/app?route=next-season` (or equivalent existing dispatch) for status, counts, public supporter summary, and optional private own selection; `POST` replaces the full selection set. Mark personalized responses private/no-store. Fetch on page load and after a successful write, not on a timer. Avoid repeated invalidation of tournament snapshots and a new general survey engine.

## Buy Me a Coffee — simple UI, real server integration

Use one real creator URL (config or `NEXT_PUBLIC_BMC_URL`). No guessed category/referral query parameters or nonexistent BMC goal/checkout APIs. Link to BMC from voting cards or the separate support link; **do not infer a payment from a click**, do not attempt cross-site checkout matching, and **do not associate a donor to the user's vote**.

Official documentation:
- Webhooks: https://help.buymeacoffee.com/en/articles/15743173-how-to-setup-and-use-buy-me-a-coffee-webhooks
- OpenAPI spec: https://cdn.buymeacoffee.com/assets/integrations/bmc-webhooks-openapi.json

### Incoming webhook and data model

- Route `POST /api/integrations/buymeacoffee` **through `src/app/api/[[...path]]/route.ts`**. Its current `invoke()` parses JSON before forwarding, so preserve the exact bounded raw body for this route before parsing. Verify `x-signature-sha256` using `HMAC-SHA256(rawBody, BMC_WEBHOOK_SECRET)` and fixed-length constant-time comparison. Reject invalid signatures, malformed or oversized bodies. No client-visible secret, OAuth keys or raw private payload logs. Do not add another Vercel function.
- Listen for `donation.created` and `donation.refunded` only (one-time support). Provider event envelope includes `live_mode`; acknowledge but **never write `live_mode:false`** test events. Verify payment ID, success/refund state, amount, currency, and event type. Acknowledge unknown signed event types without mutation. Webhook retries must be idempotent; one payment counts once regardless of deliveries, and refund cannot be resurrected by late/replayed `donation.created` event. Use one atomic refund-dominant database insert/update; a refund received first must still reserve the payment ID as refunded. BMC expects 2xx within 15 seconds and can disable a webhook after repeated failures.
- Store minimal private ledger: provider payment ID unique, original money amount in integer minor units, currency, refunded state, optional **publicly opted-in HT display name** parsed from the note, timestamps. No payer email, raw note or vote identity matching. Never expose raw ledger to anon/authenticated browsers. Constrain/max length and validate display names; provide a private operator correction/removal procedure for withdrawn consent. Deduplicate public names without requiring a new supporter table.
- Only verified **EUR** payments count toward a displayed €80 site-wide total; non-EUR record separately without guessing exchange conversion. Disclose gross before provider fees if publishing euros. Supporter name display can be independent of payment currency if the signed donation is valid and non-refunded.
- Public summary endpoint returns only a bounded, deduplicated set of opted-in display names and, if actually displayed, safe aggregate EUR cents. No client polling or event-stream infrastructure. Payment/read failure must not affect votes. Hide `Supported by` until valid consenting supporters exist.
- Avoid the false claim of “four separate €20 funded milestones”: absent verified per-option attribution, only the **combined €80 symbolic milestone** has a truthful aggregate progress value.

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

1. Create/login at https://buymeacoffee.com, configure payout account, set EUR if offered, and copy the public creator URL into app config/Vercel env.
2. After owner review, apply the migration and deploy the matching code. In Buy Me a Coffee Dashboard → **Integrations → New webhook**, enter `https://<actual-production-domain>/api/integrations/buymeacoffee` and select only `donation.created` + `donation.refunded`. Copy its **Signing Secret** into server-only Vercel env `BMC_WEBHOOK_SECRET`, redeploy, then enable deliveries. Never paste the secret into GitHub or chat.
3. Use **Send test event** in BMC and inspect its delivery result for 2xx; test events must add neither money nor supporters. A real donation with `HT:YourName #public` should appear once under Supported by. A donation without consent or with a hidden note must not reveal a public name. A real donation is required for this final integration test; local mocks do not prove it.

**Non-goals:** allocating donations to competition votes; fake per-category progress; building a payment gateway; requiring donation; automatic Hattrick identity verification from BMC; promotional gamification; any tournament feature changes.
