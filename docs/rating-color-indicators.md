# Fixture rating color rules

Current implementation, checked against source on 2026-10-13. These indicators
favor a regular-time draw and extra time: low scoring potential and balanced
midfield are desirable. They are UI guidance, not predicted event probabilities.

## Color system

All colors use the existing classes in
[`FixtureCard.module.sass`](../src/components/FixtureCard/FixtureCard.module.sass).

| Indicator | CSS variable | Meaning |
| --- | --- | --- |
| 0 / no class | Default text | Neutral / no applicable rule |
| 1 | `--accent` | Green, favorable |
| 2 | `--semi-green` | Softer green, moderately favorable |
| 3 | `--warning` | Yellow, caution |
| 4 | `--danger` | Red, unfavorable |

`ratingIndicatorClass` returns no class for 0, null and undefined. Although the
stylesheet defines indicator 0, this helper does not apply it. Theme variables
control actual colors; rules do not use separate custom color classes. Colored
sector numbers and specialty icons have short hover explanations without numeric
thresholds. Neutral sector numbers have no comparison tooltip.

## Attack versus opposing defence

Requires both shared predictions for the same displayed fixture. Missing,
blank, non-finite or negative sector values stay neutral.

| Own sector | Compared with opponent |
| --- | --- |
| Left attack | Right defence |
| Centre attack | Centre defence |
| Right attack | Left defence |
| Left defence | Right attack |
| Centre defence | Centre attack |
| Right defence | Left attack |

For each attack/defence pair, **both numbers receive the same color**:

| Condition | Indicator |
| --- | --- |
| Defence ≥ attack × **1.25** | 1, green |
| Attack ≥ defence × **1.35** | 4, red |
| Neither condition | Neutral |

Thus a defence at least 25% higher than the attack favors avoiding a goal;
an attack at least 35% higher than the defence signals scoring risk.
Both zero is neutral. Zero attack with positive defence is green; positive
attack with zero defence is red. Boundary comparisons use a `1e-9` tolerance.

## Midfield balance

Requires both shared predictions. Both midfield numbers get the same color.
Difference is measured relative to the **lower** rating, not the higher or average:

`difference = (higher / lower - 1) × 100`

| Difference | Indicator |
| --- | --- |
| Below **20%** | 1, green |
| **20–30%**, inclusive | Neutral |
| Above **30%**, below **55%** | 3, yellow |
| **55% or more** | 4, red |

Both zero gives 0% and green; only one zero gives infinite difference and red.
Invalid values stay neutral. A `1e-9` percentage-point tolerance stabilizes boundaries.

## Formation

Independent of opponent ratings. Unknown/missing formations stay neutral.

| Formation | Indicator |
| --- | --- |
| 5-5-0, 5-4-1, 5-3-2, 4-5-1 | 1, green |
| 5-2-3 | 2, softer green |
| 4-4-2 | 0, neutral |
| 4-3-3, 3-5-2 | 3, yellow |
| 3-4-3, 2-5-3 | 4, red |

## Tactic

| Tactic | Indicator |
| --- | --- |
| Pressing | 1, green |
| Normal | 3, yellow |
| Attack on wings, Attack in the middle, Long shots, Play creatively, Counter-attacks | 4, red |
| Unknown/missing | Neutral |

Case, surrounding whitespace, spaces/hyphens and supported attack-label aliases
are normalized. Tactic skill is displayed as a number in parentheses for
non-Normal tactics when available; it **does not affect the color**.

## Coach style

Only values **-10 or -1000** render the style label **100% Defensive**, indicator
1 (green). Other values, including neutral, offensive and intermediate defensive
values, produce no style label or indicator.

## Set-pieces taker

| Skill value | Display / indicator |
| --- | --- |
| `null` | **Not set**, 4, red |
| 1–3 | Named skill and level, 1, green |
| Above 3 through 5 | Named skill and level, 2, softer green |
| Above 5 through 7 | Named skill and level, 3, yellow |
| Above 7 | Named skill and level, 4, red |
| Undefined or non-finite | Neutral |
| Below 1 (including zero) | Neutral; zero displays Non-existent (0) |

Null is intentionally interpreted as no selected taker. A failed/unavailable
skill lookup can also yield null; the UI accepts that ambiguity. Missing
(undefined) skill displays an em dash. Lower selected skill favors avoiding goals.

## Specialty icons

Comparison requires **both predictions with known specialty arrays**. An empty
array is known; missing data is not. Without this, icons remain neutral.
Colors apply to pitch icons and their counts, not the gray specialties summary.
Players grouped in the same sector are split by matchup reason when necessary.

**Event initiators:** wingers, inner midfielders and forwards (roles 106–113).
**Defensive coverage/vulnerability roles:** wing backs, central defenders and
inner midfielders (101–105 and 107–109). Goalkeepers are excluded.

| Rule | Indicator |
| --- | --- |
| Technical initiator with any opposing Head defensive/inner-midfield player | 4, red on Technical icon |
| Head defensive/inner-midfield player with any opposing Technical initiator | 4, red on Head icon |
| Quick initiator with no opposing Quick coverage player | 4, red |
| Quick initiator without exact-slot Quick coverage, but with Quick coverage elsewhere | 3, yellow |
| Quick defensive/inner-midfield player facing a Quick initiator in the mapped opposing slot | 1, green |
| Quick defensive/inner-midfield player with Quick initiators elsewhere on opponent's team | 1, green; possible coverage only |
| Other situations/specialties | Neutral |

Technical-versus-Head checks are team-wide within the eligible roles; they do
not require matching wings. A Technical defender does not cancel that warning.
No Head-versus-Head cancellation, Head attacking threat color, or other
specialty mitigation is implemented.

Quick checks use these mirrored CHPP slot pairs:

| Roles | Pair |
| --- | --- |
| 101 ↔ 110 | Right back ↔ left winger |
| 105 ↔ 106 | Left back ↔ right winger |
| 102 ↔ 113 | Right central defender ↔ left forward |
| 103 ↔ 112 | Central defender ↔ central forward |
| 104 ↔ 111 | Left central defender ↔ right forward |
| 107 ↔ 109 | Right inner midfielder ↔ left inner midfielder |
| 108 ↔ 108 | Central inner midfielder ↔ central inner midfielder |

Quick inner midfielders can be both initiators and coverage players. Their own
uncovered or partially covered threat takes precedence over their coverage
color. Direct coverage removes the initiator warning, but does not by itself
color a winger/forward green. Tooltips distinguish direct and possible coverage.

These are conservative slot-based hints derived from historical engine
explanations, not a verified current-engine simulator. Green does not guarantee
an event is blocked, and red does not guarantee a goal.

## Where to adjust

- Numeric comparison thresholds: grouped `EXTRA_TIME_COMPARISON` in
  [`FixtureCard.tsx`](../src/components/FixtureCard/FixtureCard.tsx).
- Specialty colors and slot logic: `SPECIALTY_MATCHUP_COLORS`,
  `QUICK_OPPOSING_ROLES` and `specialtyMatchup` in that same file.
- Formation, tactic, coach and set-piece scores:
  [`rating-indicators.ts`](../src/utils/rating-indicators.ts).
- Skill labels: [`hattrick-skill.ts`](../src/utils/hattrick-skill.ts).

Formation/tactic/style/set-piece helpers also apply to finished-match metadata.
Opponent sector and specialty comparisons described above apply to paired shared
predictions; finished-match pitches are not passed an opposing comparison.
