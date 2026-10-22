# Finished-match 120mRt

The current-season fixture badge rates each team's preparation for a 120-minute friendly. It does not use goals, match duration, or opponent strength. `shared/match-120m-rating.ts` owns formula version 1 and the score-to-grade bands. It reuses the existing formation, tactic, and fully defensive style indicators. Raw CHPP sector ratings use the same `(raw + 3) / 4` display conversion as the fixture card.

The score weights defence versus attack (25%), tactic (25%), formation (25%), midfield versus defence (15%), and set-pieces taker skill (10%). A fully defensive style adds five points. Strongest attack sector and concentrated Quick/Head specialists lower the score. Severe attacking formations with an offensive tactic or strong attack are capped at 10. Missing core ratings, formation, or tactic leave a side unscored. Missing set-pieces skill gets neutral component credit; unknown specialties get no penalty. The saved `has_set_pieces_skill` and `has_specialties` flags preserve those distinctions without changing the badge.

`migrations/139_match_120m_ratings.sql` adds one row per fixture side with the actual participating team's UUID and Hattrick ID, score, grade, formula version, and input-availability flags. Historical snapshots and standings are unchanged. Rows survive a later team-row deletion. Public users may read rows; only the service role may replace them. The replacement RPC locks the match, checks the saved performance snapshot, current-season mode, and actual participant IDs, then replaces both sides in one transaction. A match-update trigger removes stale rows when performance, team identity, round, or completion changes. This also covers result reset paths that do not calculate a new score. Pre-kickoff predicted ratings remain separate and private.

Live MatchDetails refresh, manual match linking/addition, and the authorized match-facts refresh calculate scores after saving finished facts. The current-season public fixture projection reads stored rows; page visits do no rating calculation or CHPP lookup. `scripts/backfill-match-120m-ratings.ts` scans current-season finished fixtures from stored performance only, paginates reads, and defaults to a read-only dry run. Pass `--apply` to write via the guarded RPC. It never fetches CHPP and leaves historical fixture snapshots unchanged. Future ranking tables can aggregate rows by `team_id` and `formula_version`.

Score preparation resolves tournament ownership through the fixture's round. It uses each saved performance side's Hattrick team ID to keep the score with the correct scheduled fixture participant, including reversed venues and reserve substitutions. An ambiguous identity stays unscored. Automatic scoring failures are logged and reported separately from saved results so they cannot prevent length-round progression.

Rollout order: apply migration 139 after preceding prepared migrations, deploy the code, inspect a dry run, then explicitly run the backfill if the owner chooses. Localhost may use production Supabase, so even the backfill dry run reads live data; its apply mode writes live data. Formula changes need a new version and deliberate recalculation, not silent reinterpretation of old scores.

```sh
node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/backfill-match-120m-ratings.ts --tournament-id UUID
# After reviewing the dry-run count and applying migration 139:
node --env-file-if-exists=.env --env-file-if-exists=.env.local --import tsx scripts/backfill-match-120m-ratings.ts --tournament-id UUID --apply
```
