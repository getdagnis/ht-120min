# Local-agent review notes: APPG-120 separation

## Intended result

The current system becomes **APPG-120** conceptually and internally, while the database continues storing `scoring_mode = 'appg'` for compatibility.

The important separation is:

- **aggregation:** average points per completed classified match;
- **match rules:** ET3 / ET2 / PS1 / RT0 / OPW based on 120-minute friendlies.

Those are currently bundled in the `appg-120` profile, but they are no longer treated as universally synonymous.

## Before applying

The patch is based on GitHub commit `a4926f0ffe241d07d1ae6550dfbb6e4bb48e1506` (`0.3.4`). The local checkout may contain newer uncommitted work, so adapt context rather than forcing it.

## Please check and adjust

1. **Import conventions**
   - Browser imports from `shared/` should remain extensionless if that matches the current Vite setup.
   - Server imports must use `.js` and pass `npm run check:server-imports`.

2. **Unknown scoring values**
   - `resolveScoringProfile()` currently falls back to `120min` for null/unknown values to preserve existing behavior.
   - Confirm this is preferable to throwing during development.

3. **Remaining direct APPG checks**
   Search for:

   ```bash
   rg -n "scoring_mode === 'appg'|scoringMode === 'appg'|APPG scoring|\bAPPG\b" src api shared tests PROJECT_STATE.md
   ```

   Categorize each hit:
   - average-points aggregation → use `usesAveragePoints()`;
   - English 120-minute rules/classification → use `isAppg120ScoringMode()` or `supportsAppg120ChppClassification()`;
   - persisted DB compatibility → keeping the literal `'appg'` is acceptable, with a comment when unclear;
   - visible product copy for this current mode → call it **APPG-120**.

4. **Do not rename database fields yet**
   Keep:
   - `scoring_mode = 'appg'`
   - `appg_outcome`
   - `appg_outcome_source`
   - `appgPoints`
   - `appgPlayed`

   Renaming these now would add migration risk without enabling another scoring profile.

5. **Do not rename every function in one pass**
   Existing names such as `getAppgPoints()` and `buildChppAppgUpdate()` may remain as compatibility names. Add comments or aliases later; avoid a noisy repo-wide rename immediately before other planned work.

6. **Creation UI**
   Update the existing organizer-managed option label to `APPG-120`, but do not expose generic APPG, APPG-90 or Bone Crushers average-points options yet.

7. **History snapshots**
   When scoring-profile identity is eventually frozen into new snapshots, store `appg-120`, not the ambiguous legacy value `appg`. Older snapshots should fall back through `resolveScoringProfile()`.

8. **Future extension rule**
   A future profile should be shaped like:

   ```ts
   {
     id: 'appg-90',
     aggregation: 'average-points',
     matchRuleset: 'appg-90',
     targetMinutes: 90,
     supportsChppAutoClassification: false,
   }
   ```

   Bone Crushers should get its own profile/ruleset only after its actual points and match-event rules are defined.

## Validation

Run:

```bash
npm run lint
npm test
npm run build
npm run check:server-imports
find api -name "*.ts" | grep -v "/_lib/" | wc -l
git diff --check
```

Then bump the patch version according to the repository policy and update `PROJECT_STATE.md` to say:

> Persisted `appg` now resolves to the internal APPG-120 profile. Average-points aggregation is separated from the 120-minute match ruleset; no new foreground scoring modes were introduced.
