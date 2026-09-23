# AI round press drafts

The server-only `POST /api/app?route=generate-round-summary` endpoint creates an editable draft for a completed tournament round. It does not write to `news_posts`, publish anything, or mutate the UI.

- Generation runs only in the consolidated application API. `ROUND_PRESS_PROVIDER=gemini` (or no value) uses Gemini `gemini-3.8-flash`; `ROUND_PRESS_PROVIDER=cloudflare` uses Cloudflare Workers AI model `@cf/zai-org/glm-4.7-flash` through Cloudflare's REST API. Both use thinking level `low` and prompt version `2` (`ROUND_PRESS_PROMPT_V2`).
- Cloudflare requires server-only `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN`. It has no Worker binding, client-side call, or automatic provider fallback; provider selection is deliberately server configuration only for this comparison experiment.
- The caller must have a valid HT-120min app session and tournament access with `canPublishAnnouncements`.
- Input is a compact deterministic fact model. Structured cards, goals (including scorer names where MatchDetails supplies them), injuries, injury weeks, formations, tactics, possession, ratings, chance counts, result decision semantics, extra-time and penalty-shootout fields come from persisted `match_event_details` and match columns; localized CHPP `EventText` is never parsed.
- Historical requests use the archived fixture snapshot for the requested season. Pre-round standings, when available, are reconstructed only from fixtures in earlier rounds of that season; final standings and future rounds are not used as historical context. The next round is supplied only as a preview.
- Gemini output is schema-constrained and validated for article fields and exact match IDs. One repair request is allowed; a second failure returns an error.
- Gemini transport failures with HTTP 429 or 503 are retried up to three total attempts with approximately one and two second backoffs. Exhausted transient failures return HTTP 503; ordinary authentication/configuration failures are not retried.
- Cloudflare transient failures (HTTP 408, 429, and 5xx/out-of-capacity) return HTTP 503 without retry for this experiment. Cloudflare output is still passed through the same local draft validator before it is returned.

`match_event_details` version 2 adds stable MatchDetails facts while retaining compatibility with version 1 snapshots: score after regulation, score after extra time, penalty score, decision type, winner, formation, tactic/type skill, first/second-half possession, sector ratings, chance counts, and scorer names. MatchDetails does not provide reliable structured prose causes; `EventText` remains excluded. Older v1 archives still generate, but lack these richer facts until explicitly re-fetched.

Forge testing includes a protected `round-press-matchdetails-backfill` tool for a specific tournament season/round. It re-fetches linked Hattrick MatchDetails, stores only parsed v2 facts when `apply=1`, and corrects the stored football score independently from a penalty-shootout score. Round-press generation itself never performs a CHPP fetch.
