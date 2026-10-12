# Average 120 min scoring

`average120` is a separate persisted value in `tournaments.scoring_mode`. It uses the standard 120-minute ruleset and the existing match classifications. Raw achievement, tie-break point, minute, goal-difference, and goal totals remain in standings and season snapshots; each displayed/ranked average divides by the team's counted completed matches. Completed BYEs and unplayed fixtures do not count. A physical season slot owns substitute results, so current occupants inherit results from former occupants in both live standings and new `average120` history snapshots.

Rank by unrounded averages: 120-minute achievements, points, goal difference, goals, minutes; preserve join order on a complete tie. Teams with no counted results follow teams with results and display `—`. Power rating and 120-minute percentage stay raw/informational. There is no minimum match quota. Existing `120min`, `120m`, `points`, and `appg` profiles keep their algorithms and snapshot shape.

No database migration is required by the repository schema: `tournaments.scoring_mode` is unconstrained `TEXT`, and the public snapshot already carries it. The organizer chooses this mode through Create or Admin; no existing row is changed automatically. If the live database has an undocumented constraint, inspect it before selecting the mode there.
