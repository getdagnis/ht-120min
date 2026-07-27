# Tournament system

I believe the current "round robin" abstraction might be misaligned with the actual problem. The core constraint is having **X teams** and **Y available friendly slots** before the next cup starts. The goal should be to fill as many slots as possible with meaningful matches, which is fundamentally a scheduling optimization problem, not solely a tournament-format problem.

## Tournament Format Families

I propose splitting tournament formats into three main families:

### 1. Pure Round Robin

This format is ideal when the number of `available_weeks` is approximately equal to `teams - 1`.

**Examples:**

- 6 teams, 5 weeks
- 8 teams, 7 weeks
- 12 teams, 11 weeks

In a pure Round Robin, **everybody plays everybody once**, with no playoffs.

### 2. Round Robin + Playoffs

This is suitable when `available_weeks` are greater than `teams - 1`. This is likely the **sweet spot for HT-120**, as people generally enjoy playoffs.

**Example:**

Consider a tournament with 6 teams and 7 available weeks.

- A Round Robin (RR) would take 5 rounds.
- This leaves 2 weeks remaining for playoffs.

**Playoff Structure:**

- **Week 6:**
  - #1 vs #4
  - #2 vs #3
- **Week 7:**
  - Semi-final winners play in the Final.
  - Semi-final losers play for Bronze.
  - #5 vs #6 placement match.

### 3. Extended League

This format is best when `available_weeks` are significantly greater than the number of `teams`. In such scenarios, simply playing everyone once becomes less engaging.

**Example:**

For 6 teams and 12 available weeks:

- An initial Round Robin (5 rounds).
- Followed by a **top half mini-league** and a **bottom half mini-league**, or a **Swiss-style continuation**.

This approach offers a much more interesting and extended competition.

## Proposed Tournament Generation System

Instead of a simple single/double round robin selector, the system would work as follows:

The admin provides:

- **Teams:** (e.g., 10)
- **Available friendly weeks:** (e.g., 13)

The admin then presses a "Generate format" button.

The system would then **recommend** a format, for example:

- **Option 1:**
  - 9-round regular season
  - 4-round playoffs
  - **Total:** 13 weeks used

- **Option 2:**
  - 9-round regular season
  - 2-round playoffs
  - 2 consolation rounds
  - **Total:** 13 weeks used

The admin then simply presses "Generate" to confirm.

### The Algorithm

**Input:** `teamCount`, `availableWeeks`

**Calculation:**

- `rrWeeks = teamCount - 1`
- `extraWeeks = availableWeeks - rrWeeks`

**Decision Tree:**

- If `extraWeeks <= 0`: **Pure Round Robin**
- If `extraWeeks == 1`: **Bonus rivalry round**
- If `extraWeeks == 2`: **Final Four playoff**
- If `extraWeeks == 3`: **Final Four + placement games**
- If `extraWeeks >= 4`: **Expanded playoff**

This approach is **simple**, **predictable**, and **managers can easily understand it**.

## Weekend Friendlies

I recommend **ignoring weekend friendlies initially**. This is a potential **scope creep** for several reasons:

- Not every team gets them.
- Qualifiers behave differently.
- National cups differ.
- It's impossible to explain simply.

Your core tournament should assume **1 friendly slot per week**. A "Weekend Bonus Round" could be added later as an optional experimental feature.

## Long-term: Swiss System

The format that eventually becomes truly interesting is not a traditional Round Robin.

**Imagine:**

- 16 teams
- 8 weeks

A Round Robin is impossible in this scenario. A **Swiss system** is perfect.

- **Round 1:** Random pairings.
- **Round 2:** Teams with a 1-0 record play each other, teams with a 0-1 record play each other.
- **Round 3:** The same principle applies.

After 6-8 rounds, the **top 4 teams could proceed to playoffs**. This system scales infinitely.

For HT-120, I anticipate the eventual evolution to be:

- **Small tournaments (<10 teams):** Round Robin + Playoffs
- **Large tournaments (10+ teams):** Swiss + Playoffs

This allows the system to **automatically adapt** to the number of weeks remaining before the next cup cycle.
