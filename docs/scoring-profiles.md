# Scoring profiles

`tournaments.scoring_mode = 'appg'` is the compatibility storage value for the
current **APPG-120** profile.

APPG-120 combines two independent concepts:

1. **Standings aggregation:** average points per completed classified match.
2. **Match ruleset:** ET3, ET2, PS1, RT0 and OPW for the English 120-minute
   friendly tournament.

Future average-points tournaments must define their own match ruleset. An
APPG-90 or Bone Crushers profile must not inherit APPG-120 outcomes or its CHPP
classifier merely because it also ranks teams by an average.

The current compatibility boundary is intentional:

- keep `scoring_mode = 'appg'` in the database;
- keep existing `appg_*` columns and compatibility function names;
- use `resolveScoringProfile()` for internal decisions;
- display the existing mode as **APPG-120**;
- do not expose generic APPG or additional profiles in tournament creation yet.
