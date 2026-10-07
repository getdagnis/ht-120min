# HT-120min localization transition plan

## Goal

Introduce Latvian as the first usable translation while keeping English as the default. Build a repeatable path for Italian and German next, then Spanish and Dutch. Beta languages stay opt-in until their core journeys are ready.

The goal is to replace hard-coded user-facing interface text with stable message keys such as `t('message.id')`, backed by one consistent localization system. This plan uses **`next-intl`**, following the established pattern in Foro. It does not introduce a second custom translation API.

## Current starting point

- Public routes already use `src/app/(public)/[locale]`.
- The app currently supports `en` and `lv` through a small custom TypeScript dictionary/provider, not `next-intl`.
- `lv.ts` spreads English messages, making missing translations look complete to simple parity checks.
- `src/proxy.ts` can select Latvian from `Accept-Language`; the existing `ht120_locale` cookie does not prove the visitor deliberately chose Latvian.
- `src/legacy-pages/Home/Home.tsx` is the Home component and already uses the current locale context. It renders child components that own their own text.

Routes provide a useful foundation, but the message runtime, language selection, fallback behavior, and translation inventory need a deliberate migration.

## Product and technical decisions

- English is the complete source language, default locale, and first-visit language.
- Use `next-intl` for routing-aware messages, translation hooks, ICU interpolation/plurals, and rich text where needed. Keep the existing locale-prefixed route structure and supported locale IDs (`en`, `lv`) during the first slice.
- Keep each locale’s source catalog explicit. For Latvian, load English messages as runtime fallback beneath actual Latvian entries; do not copy English entries into the Latvian catalog. This keeps the UI usable while preserving accurate coverage reports.
- Never generate Latvian translations automatically with the local CLI. English extraction is the first implementation task; Latvian copy is added by the owner or a trusted human translation process.
- First visits remain English regardless of browser language or location. A visitor opts into `/lv` through the language selector. Treat old `ht120_locale` cookies as potentially auto-selected, not as proof of a deliberate choice.
- Release Latvian first. Target 80–90% of ordinary interface text, with registration, sign-in, navigation, fixtures, and standings usable in Latvian before presenting it as a useful beta.
- Keep tournament/team/manager names, Hattrick data, user-written content, chat, and editorial articles in their original language for the initial UI translation work.
- Mark beta locales clearly, explain incomplete coverage on first selection, and make returning to English easy. Defer language-assistant recruitment and its banner until assistants are ready.

## Phase 1: establish `next-intl` and migrate Home as the pilot

Keep this first implementation intentionally narrow. Add the minimal `next-intl` configuration, request handling, provider, and locale-aware navigation needed by the existing routes and switcher. Do not migrate the rest of the app in the same pass.

Migrate the user-facing strings authored directly in `src/legacy-pages/Home/Home.tsx` into an English message catalog, grouped under a Home namespace. This includes headings, buttons, labels, empty states, prompts, notifications, placeholders, and accessibility labels. Use ICU parameters for dynamic content; do not build messages through string replacement.

Leave strings owned by Home’s child components for later slices. Do not translate Hattrick or user-provided values, CSS selectors, protocol values, logs, IDs, or editorial content. Add no automatic Latvian translations. Missing Latvian messages should render in English without being added to the Latvian source catalog.

After this pilot, review the actual diff and manually exercise Home and the locale switcher. Use what worked to settle the migration conventions before moving through more components.

## Phase 2: translation inventory and editing workflow

Adapt the existing Foro `check-locales.js` approach to this app and its `next-intl` catalogs. Provide two practical operations:

1. **Scan/export:** inventory existing message keys and likely hard-coded user-facing strings, then write the full translation inventory to one spreadsheet-friendly UTF-8 CSV.
2. **Import/update:** apply reviewed CSV translations to the correct locale catalog by stable key, preserving punctuation, ICU parameters, and Unicode text.

Recommended CSV columns: `key`, `feature`, `English`, `Latvian`, `status`, `context`, `source file`, and `line`. Treat source-code matches as review candidates, not translations: exclude or flag data values, user content, technical strings, logs, and editorial copy. Report parse failures instead of silently skipping files. Validate key uniqueness and ICU parameter parity.

Start in report-only mode. Do not make the existing hard-coded-text backlog a pre-push blocker before it has been inventoried and migrated. Keep CSV as the advanced-user editing exchange format; the app loads its normal message catalogs at runtime.

## Phase 3: continue UI migration in reviewed slices

After the Home pilot and workflow are reviewed, migrate interface text by user journey, completing and checking each slice before broadening:

1. Shared navigation, controls, and common errors.
2. Collections and tournament overview.
3. Fixtures, standings, and match details.
4. Sign-in, registration, profile, and team selection.
5. Organizer tools, confirmations, and validation errors.
6. Help text and remaining app-generated interface messages.

Keep user-authored text and editorial stories outside this UI pass. In particular, leave news stories, round-report prompts, and manager spotlight stories until the end; they need a separate content strategy rather than simple interface-string extraction.

## Phase 4: Latvian beta, then additional languages

- Keep English as the default for new visitors; Latvian is explicitly selected and marked `LV · Beta`.
- On first opt-in, explain that some text remains in English and that English fallback is expected. Do not show the notice on every visit.
- Preserve the current page, query parameters, tabs, and sign-in return path when switching locales.
- Update localized metadata as languages become usable.
- Use coverage reports as a progress measure, then manually verify critical journeys. The owner performs site checks; browser automation is not a release requirement.
- Once Latvian reaches the agreed 80–90% usable level, apply the same workflow to Italian and German. Spanish and Dutch follow. Keep each new locale opt-in and visibly beta until its own core journeys are ready.

## Phase 5: language-assistant editor

Build a simple editor only when assistants need assignments by language. Reuse the same message keys and validation rules. Show English source text and context beside each translation; restrict editing to the assistant’s assigned language; support draft, review, and publish states; and keep final publication approval with the owner. Until then, CSV export/import is the practical workflow for an advanced user.

## Completion checks

- Home uses `next-intl` keys for all user-facing strings authored directly in that component; dynamic text uses ICU parameters.
- First visits resolve to English independently of browser-language headers or legacy auto-set locale cookies. Explicit locale selection persists through navigation and sign-in return.
- Missing Latvian messages display English while remaining absent from the Latvian source catalog and visible in coverage reports.
- English and Latvian catalogs have valid unique keys and matching ICU parameters for translated messages.
- CSV export/import preserves keys, punctuation, placeholders, and Latvian characters.
- The scanner reports source locations and parse failures, and flags uncertain matches for review instead of treating every string as UI copy.
- Latvian’s 80–90% target is measured against user-facing UI messages; critical journeys are manually checked.
- No automatic Latvian translation is introduced. The Home pilot is reviewed before planning the next migration slice.
