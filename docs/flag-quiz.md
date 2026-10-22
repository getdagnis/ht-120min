# Tournament flag quiz

The standings sidebar hosts a global quiz, independent of tournament membership,
season status, or scoring rules. Every visitor sees the same question between
00:00–12:00 or 12:00–00:00 UTC. Signed-in Hattrick managers can submit once per
question across all tournaments; guesses are immutable.

## Ownership and contracts

`shared/worlddetails.ts` is the country source. The quiz excludes entries without
a country and excludes Oceania (LeagueID 15), regardless of its display emoji.
Short English league names are the option labels. The generator chooses two
same-initial distractors where available, then fills the six choices from leagues
within ±20 LeagueID. Same-initial choices are exempt from the distance limit.

`flag_quiz_questions` owns frozen question windows, emoji, options/order and the
correct LeagueID. `flag_quiz_answers` owns each manager's selected LeagueID and
submission timestamp. Neither is a projection of tournament votes or telemetry.
Old season-poll votes remain untouched and do not contribute to quiz scores.
Question/answer history is retained; monthly reset is a query boundary, not deletion.

`GET /api/app?route=flag-quiz` lazily creates the current question under a database
lock and loads viewer state. No cron or background polling is required. The
previous persisted flag is excluded from the next random selection. UTC window
authority and submission expiry use the database clock. Concurrent first visitors
reuse the first persisted question and option order.

`POST /api/app?route=flag-quiz` accepts `{ questionId, selectedLeagueId }`. Identity
comes exclusively from the signed `ht_session` cookie. The service-only RPC
validates expiry and option membership; the question/manager primary key prevents
duplicate effects. Retries preserve the first answer. Expired questions return 409,
invalid answers 400, and missing sessions 401.

Responses contain question ID, expiry, emoji, six options, `canAnswer`, and the
viewer's answer/results when answered. Before answering, correctness and results
are withheld. After answering, counts aggregate all answers to that question,
across tournaments; percentages are rounded independently and may not sum to 100.
Responses use `private, no-store`; personalized quiz state is outside shared
Home/tournament snapshots and does not invalidate them.

The leaderboard is calculated in SQL from answers submitted during the current
UTC calendar month. It shows up to 20 managers with at least one correct answer,
ranked by correct total, with correct/attempted counts. Equal totals share a rank;
nickname then manager ID provide stable display ordering and cutoff. Nicknames
come from `profiles`, with a neutral fallback for missing profiles. Browser
responses contain no voter lists or manager IDs. Raw tables and RPCs have RLS and
service-role-only privileges; browser localStorage identity never authorizes a vote.

## Presentation

The reusable sidebar shell and Button are retained. A plain-text emoji has a
neutral accessible label, no `title` or tooltip wrapper, and no country-name label
before answering. The widget disables text selection, including Safari. Browser
or operating-system emoji lookup tools remain outside the page's control. Radio
options remain keyboard accessible. Results label both the manager's guess and
the correct option. The monthly ranking appears below answered results only.

The widget reloads at the next window and on tab visibility restoration. Loading,
retry, expired-question and expired-session states are explicit. English keys use
the existing locale catalog; empty Latvian entries retain English fallback.

## Migration and verification

`migrations/142_flag_quiz.sql` is prepared locally. Apply it **before** deploying the
matching API/widget. The agent has not applied it to application Supabase or
deployed the feature. The localhost application uses production Supabase: do not
submit real guesses from localhost as a harmless smoke test.

Focused tests: `node --import tsx --test tests/flag-quiz*.test.ts`.
For a fresh, disposable database with no application data, run
`psql -v ON_ERROR_STOP=1 -d <disposable_database> -f tests/sql/flag-quiz.sql`.
That script creates minimal roles/profile fixtures and applies the actual migration;
it must never run against application Supabase. It checks question persistence,
previous-flag exclusion, duplicate guesses, invalid/expired answers, private reads,
UTC month filtering, ties, top-20 limits and aggregation beyond 1,000 answers.

Local unit/API tests and disposable PostgreSQL checks are distinct from live
Supabase and deployment verification. A temporary browser harness uses the actual
component, styles, and English catalog with mocked responses; it is not a real
Hattrick login or application database integration test. After owner-approved
migration/deployment, verify two signed-in managers see the same flag, a guess
persists across tournament navigation, aggregates combine their guesses, and the
monthly ranking agrees with those answers. Inspect mobile layout and keyboard use,
and verify a question changes at noon/midnight UTC.
