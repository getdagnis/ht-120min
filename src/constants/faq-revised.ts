export type FaqItemStatus = 'current' | 'policy' | 'coming-soon';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  status: FaqItemStatus;
  featured?: boolean;
  published?: boolean;
}

export interface FaqSection {
  id: string;
  title: string;
  description?: string;
  order: number;
  published?: boolean;
  items: FaqItem[];
}

/**
 * HT-120min FAQ content.
 *
 * The structure is deliberately shallow:
 * section -> questions.
 *
 * Answers support Markdown. Keep item IDs stable because they may be used for
 * anchors, deep links and search results.
 */
export const faqPublished = true;

export const faqSections: FaqSection[] = [
  {
    id: 'start-here',
    title: 'Start here',
    order: 10,
    items: [
      {
        id: 'what-is-ht-120min',
        question: 'What is HT-120min?',
        answer: `HT-120min is a community tool for organizing recurring Hattrick friendly tournaments.

It gives each tournament one place for:

- participants;
- fixtures and results;
- standings;
- tournament chat and news;
- automatic fixture checks;
- organizer tools.

The tournament itself belongs to HT-120min. Hattrick and CHPP are used for manager identity, team information, scheduled friendlies and match results.`,
        status: 'current',
        featured: true,
      },
      {
        id: 'how-do-i-join',
        question: 'I found a tournament. How do I join it?',
        answer: `Open the tournament page and use the **Join tournament** button while registration is open.

You will be sent through Hattrick's CHPP authorization flow. After authorization, select the eligible team you want to enter. HT-120min then adds that team to the tournament.

If the schedule has already been generated, normal registration is closed. Contact the tournament organizer if you believe you should still be included.`,
        status: 'current',
        featured: true,
      },
      {
        id: 'does-joining-arrange-friendly',
        question: 'Does joining arrange the friendly for me?',
        answer: `No, not yet.

HT-120min creates the tournament fixtures and checks them against the friendlies that actually appear in Hattrick. For now, managers must still arrange the required friendly manually in Hattrick after the tournament fixtures have been generated.

Direct challenge and booking assistance is planned, but you should not assume a match has been arranged until Hattrick itself shows the friendly.`,
        status: 'current',
        featured: true,
      },
      {
        id: 'what-do-i-do-after-joining',
        question: 'I joined. What should I do first?',
        answer: `First, check whether the tournament schedule has already been generated.

If fixtures are visible:

1. Open **Fixtures & Results**.
2. Find your next opponent and scheduled date.
3. Arrange that exact friendly in Hattrick.
4. Return to HT-120min and allow the fixture check to confirm it.
5. Use tournament chat if your opponent is unavailable or something does not match.

Do not silently arrange a different opponent. That will normally be detected as a misarranged friendly.`,
        status: 'current',
        featured: true,
      },
      {
        id: 'where-is-my-next-fixture',
        question: 'Where do I find my next opponent?',
        answer: `Open the tournament's **Fixtures & Results** section.

The fixture list is the tournament's source of truth for:

- your opponent;
- the scheduled round;
- the expected match date;
- home and away order;
- current arrangement or result status.

Always check the tournament fixture before arranging the friendly in Hattrick.`,
        status: 'current',
      },
      {
        id: 'already-booked-friendly',
        question: 'I already booked another friendly. What happens now?',
        answer: `Tell the tournament organizer as soon as possible and explain when the friendly was arranged.

Do not hide the conflict and do not assume HT-120min can replace the booking. The automatic checker may mark the tournament fixture as **Misarranged** and issue a yellow warning, even when the other friendly was booked before you joined.

The warning brings the conflict to everyone's attention. An administrator can then review the circumstances and decide what should happen.`,
        status: 'policy',
        featured: true,
      },
    ],
  },
  {
    id: 'joining-your-team',
    title: 'Joining your team',
    order: 20,
    items: [
      {
        id: 'why-use-chpp',
        question: 'Why does HT-120min send me to Hattrick?',
        answer: `CHPP lets HT-120min identify your Hattrick manager and teams without asking for your Hattrick password.

It is also used to read the Hattrick information required for tournament operation, including team details, scheduled friendlies and match results. Challenge-management permission may also be requested for current or future booking features.`,
        status: 'current',
      },
      {
        id: 'does-ht120-see-password',
        question: 'Does HT-120min see or store my Hattrick password?',
        answer: `No. Authorization happens on Hattrick's side through CHPP.

HT-120min receives authorization tokens and the Hattrick data needed for its features, but it does not receive your Hattrick password.`,
        status: 'current',
      },
      {
        id: 'multiple-teams',
        question: 'I manage more than one team. Which one joins?',
        answer: `When Hattrick returns more than one eligible team, HT-120min allows you to choose which team you are joining with.

Each team is treated as a separate tournament participant. Before confirming, check that you selected the correct team and that its friendly schedule is compatible with the tournament.`,
        status: 'current',
      },
      {
        id: 'can-i-join-after-schedule-generation',
        question: 'Can I join after fixtures have been generated?',
        answer: `Normal registration closes when the organizer generates the schedule.

This protects the existing pairings and dates from changing unexpectedly. If a late entry or replacement is necessary, contact the organizer. It must be handled as an administrative exception rather than a normal self-service join.`,
        status: 'current',
      },
      {
        id: 'can-i-leave-tournament',
        question: 'What if I need to withdraw?',
        answer: `Contact the tournament organizer.

Leaving can affect every opponent and every future round, especially after fixtures have been generated. The organizer must decide whether to deactivate the team, find a replacement, regenerate eligible future rounds or use another solution.`,
        status: 'policy',
      },
    ],
  },
  {
    id: 'fixture-to-kickoff',
    title: 'From fixture to kickoff',
    order: 30,
    items: [
      {
        id: 'how-is-schedule-created',
        question: 'Who creates the tournament schedule?',
        answer: `The tournament organizer selects the schedule format and starting friendly slot, reviews a schedule draft and generates the tournament rounds.

The generated schedule stores the pairings and exact expected match dates. Generating it also closes normal registration so the participant list and pairings remain stable.`,
        status: 'current',
      },
      {
        id: 'why-some-weeks-unavailable',
        question: 'Why are some weeks blocked or marked as risky?',
        answer: `HT-120min follows the Hattrick season calendar.

Current scheduling rules are:

- weeks 1–3 are blocked because they are cup weeks;
- weeks 4–6 can be selected, but carry a cup-risk warning;
- normal tournament rounds primarily use midweek friendly slots;
- the week 15 weekend slot is optional because qualification matches may block some teams;
- the week 16 weekend slot is treated as a regular friendly opportunity and is included by default.

A warning means the slot may not be suitable for every team. It does not guarantee that a friendly can be arranged.`,
        status: 'current',
      },
      {
        id: 'what-is-a-bye',
        question: 'My fixture says BYE. Do I need to arrange a match?',
        answer: `A BYE means your team has no opponent in that round.

BYEs are created when a tournament has an odd number of teams. A BYE is not a match, so you do not need to arrange a tournament friendly for that fixture.`,
        status: 'current',
      },
      {
        id: 'how-do-i-arrange-my-fixture',
        question: 'How do I arrange the correct tournament friendly?',
        answer: `Open the tournament fixture and note the opponent, scheduled date and home/away order.

Then arrange the friendly manually in Hattrick against that opponent. Once Hattrick shows the match, HT-120min can compare it with the tournament fixture and mark the fixture as arranged.

For now, arranging the match in HT-120min alone is not enough. The actual friendly must exist in Hattrick.`,
        status: 'current',
        featured: true,
      },
      {
        id: 'does-home-away-order-matter',
        question: 'What if we reverse the home and away teams?',
        answer: `You should follow the home and away order shown by the tournament.

However, if the same two teams arrange the correct friendly with the venue reversed, HT-120min can still recognize the opponent pairing as arranged. It may record a venue mismatch so the organizer can see that the fixture was not arranged exactly as listed.`,
        status: 'current',
      },
      {
        id: 'which-date-is-authoritative',
        question: 'Which match date should I trust?',
        answer: `Use the date shown for the tournament fixture and confirm that the resulting booking appears correctly in Hattrick.

If the tournament page and Hattrick appear to disagree, do not guess. Contact the organizer before arranging or cancelling anything.`,
        status: 'policy',
      },
      {
        id: 'can-schedule-change',
        question: 'Can the schedule change after it is published?',
        answer: `The organizer can regenerate eligible future rounds, but HT-120min protects rounds that are already committed.

A round is not moved when an affected match is completed, arranged, linked to a Hattrick match, ongoing, misarranged or already past its kickoff time.

Regeneration moves future unarranged rounds while preserving the existing pairings and venue types.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'when-plans-go-wrong',
    title: 'When plans go wrong',
    order: 40,
    items: [
      {
        id: 'opponent-not-available',
        question: 'My opponent has not replied. Should I arrange someone else?',
        answer: `Post in the tournament chat and contact the organizer before arranging somebody else.

The automated checker only sees the tournament fixture and the actual Hattrick friendly. It cannot know that your opponent did not respond. Arranging a different team without an administrative decision will normally appear as a misarranged fixture.`,
        status: 'policy',
      },
      {
        id: 'different-date-request',
        question: 'Can we play on another date?',
        answer: `Do not assume that a different date will be accepted automatically.

Ask the organizer before changing the date. Tournament schedules use specific Hattrick friendly slots, and changing one match can affect fixture detection, later rounds and other commitments. The organizer can decide whether the exception is acceptable.`,
        status: 'policy',
      },
      {
        id: 'why-is-my-match-not-arranged',
        question: 'I booked the correct match. Why is it still not arranged?',
        answer: `First confirm that Hattrick itself shows the friendly.

Then check:

- both teams are correct;
- the match date corresponds to the tournament round;
- you are viewing the correct team and tournament;
- the fixture has been refreshed after the Hattrick booking appeared.

CHPP data may not appear instantly. If the status remains wrong, use tournament chat or contact the organizer so the fixture can be checked.`,
        status: 'current',
      },
      {
        id: 'fixture-status-meanings',
        question: 'What do Arranged, Misarranged and the other statuses mean?',
        answer: `Common fixture statuses include:

- **Not arranged:** HT-120min has not found the required Hattrick friendly.
- **Arranged:** the expected teams have a matching friendly.
- **Misarranged:** at least one team has a friendly that does not match the tournament fixture.
- **Ongoing:** the linked Hattrick match is currently being played.
- **Completed:** a final result has been recorded or synchronized.

A status describes what the system can currently verify. It is not automatically a judgement about who is at fault.`,
        status: 'current',
        featured: true,
      },
      {
        id: 'what-does-misarranged-mean',
        question: 'Why is my fixture marked Misarranged?',
        answer: `**Misarranged** means the actual Hattrick friendly does not match the tournament fixture.

Example:

Tournament fixture:

- Team A vs Team B

Friendly found in Hattrick:

- Team A vs Team C

HT-120min marks the fixture as misarranged so managers and organizers can see the conflict immediately.`,
        status: 'current',
      },
      {
        id: 'what-is-yellow-warning',
        question: 'What does a yellow warning actually mean?',
        answer: `A yellow warning is an automatic visibility signal, not an automatic punishment.

HT-120min compares the tournament fixture with the friendly that actually appears in Hattrick. When they do not match, the warning makes the problem visible to managers and organizers.

The system does not try to guess intent or assign blame. **Automatic system first. Human judgement second.**`,
        status: 'policy',
        featured: true,
      },
      {
        id: 'warning-for-pre-existing-friendly',
        question: 'The other friendly was booked before I joined. Why was I warned?',
        answer: `This can happen, especially in the first round of a new tournament.

A manager may have arranged a friendly:

- before joining the tournament;
- before tournament fixtures were generated;
- or even before the tournament existed.

The automated system can still correctly detect that the existing friendly does not match the tournament fixture. However, an administrator can remove or disregard the warning after reviewing the timeline and explanation.`,
        status: 'policy',
        featured: true,
      },
      {
        id: 'will-yellow-warning-punish-me',
        question: 'Does a yellow warning mean I will be punished?',
        answer: `No.

Yellow warnings are primarily a visibility and tracking tool. Tournament administrators may remove or disregard a warning when there is a clear and reasonable explanation, including:

- a friendly arranged before the team joined;
- a friendly arranged before the tournament was created;
- a technical issue;
- an exceptional circumstance;
- another explanation accepted under that tournament's rules.

Any sporting consequence is an administrative decision, not an automatic result of the warning itself.`,
        status: 'policy',
        featured: true,
      },
      {
        id: 'what-to-do-about-unfair-warning',
        question: 'I think the warning is unfair. What should I do?',
        answer: `Explain the situation in tournament chat or contact the tournament administrator.

Include useful facts such as:

- when the other friendly was arranged;
- whether it was arranged before joining;
- whether your assigned opponent was unavailable;
- any relevant agreement or technical problem.

The system makes the initial automatic comparison. Administrators make the final tournament decision.`,
        status: 'policy',
      },
    ],
  },
  {
    id: 'results-and-standings',
    title: 'Results and standings',
    order: 50,
    items: [
      {
        id: 'how-results-added',
        question: 'How does my Hattrick result reach HT-120min?',
        answer: `HT-120min can synchronize linked Hattrick matches through CHPP and read live or completed match details.

Administrators can also enter or correct results manually when automatic synchronization is unavailable or an exceptional tournament decision is required.`,
        status: 'current',
      },
      {
        id: 'result-not-updated',
        question: 'My result is missing or wrong. What should I do?',
        answer: `First check that Hattrick shows the correct match and final result.

The tournament result may still need to be refreshed or linked through CHPP. If the score remains missing or wrong, contact the organizer and include the Hattrick match link or match ID.

Administrators can inspect the linked match and correct the tournament record when necessary.`,
        status: 'current',
      },
      {
        id: 'how-120min-scoring-works',
        question: 'What are teams competing for in 120-minute mode?',
        answer: `In **120-minute mode**, the main objective is to take friendly matches to extra time.

The current standings order is:

1. number of completed matches that reached 120 minutes;
2. goal difference;
3. goals scored;
4. fewer matches played, when the earlier values are still equal.

Both teams receive a 120-minute achievement when a completed match reaches extra time.`,
        status: 'current',
      },
      {
        id: 'how-points-scoring-works',
        question: 'Can a tournament use normal league points instead?',
        answer: `In **points mode**, HT-120min uses conventional league points:

- 3 points for a win;
- 1 point for a draw;
- 0 points for a loss.

Teams are then separated by goal difference and goals scored.`,
        status: 'current',
      },
      {
        id: 'can-misarranged-result-count',
        question: 'Can a misarranged match ever count?',
        answer: `It can, but only as an organizer decision.

HT-120min allows administrators to enter or confirm results manually, including exceptional cases involving a misarranged match. The system identifies the mismatch; the tournament administrator decides whether the result should count.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'formats-and-playoffs',
    title: 'Formats and playoffs',
    order: 60,
    items: [
      {
        id: 'are-tournaments-round-robin',
        question: 'Which competition formats work today?',
        answer: `HT-120min currently supports league-style schedules where teams meet once, twice or repeatedly.

These formats power the fixtures, results and standings already used by live tournaments. The organizer should describe the chosen format before registration closes.

Built-in knockout playoffs are planned but are not yet a complete live flow.`,
        status: 'current',
      },
      {
        id: 'are-playoffs-available',
        question: 'Are playoffs available yet?',
        answer: `Not yet as a complete built-in tournament flow.

Playoffs are planned. Until a tournament explicitly publishes a supported playoff format, participants should treat the regular schedule and standings as the active competition.`,
        status: 'coming-soon',
      },
      {
        id: 'who-qualifies-for-playoffs',
        question: 'How will teams qualify for the playoffs?',
        answer: `The qualification rules have not been finalized.

Before playoffs are enabled, each tournament will need to state clearly:

- how many teams qualify;
- which standings column determines qualification;
- which tiebreakers apply;
- whether any teams receive a bye.`,
        status: 'coming-soon',
      },
      {
        id: 'how-playoff-seeding-works',
        question: 'How will the playoff bracket be seeded?',
        answer: `Playoff seeding is still to be defined.

The future implementation should publish the complete bracket before the first playoff fixture and explain whether seeds come directly from the regular-season table or from another tournament rule.`,
        status: 'coming-soon',
      },
      {
        id: 'playoff-draws-and-penalties',
        question: 'What will happen if a playoff match is tied?',
        answer: `The rule is not finalized.

A playoff system must define in advance whether the winner is determined by extra time, a penalty shootout, replay, aggregate score or an administrator-entered decision. HT-120min should not guess this after the match.`,
        status: 'coming-soon',
      },
    ],
  },
  {
    id: 'running-a-tournament',
    title: 'Running a tournament',
    order: 70,
    items: [
      {
        id: 'what-can-admin-do',
        question: 'What can the tournament organizer control?',
        answer: `Current organizer and administrator tools include:

- managing tournament teams;
- generating the schedule;
- regenerating eligible future unarranged rounds;
- refreshing fixtures and results;
- entering or correcting results manually;
- reviewing fixture problems and yellow warnings;
- publishing tournament communication through chat, news or announcements;
- handling exceptional situations that automation cannot judge.

The exact controls visible to an administrator depend on the tournament state.`,
        status: 'current',
      },
      {
        id: 'who-decides-disputes',
        question: 'Who makes the final decision when managers disagree?',
        answer: `The tournament administrator makes the tournament decision.

HT-120min provides fixture data, automatic statuses and warnings. It does not replace tournament rules or human judgement. Administrators should explain significant decisions consistently and transparently.`,
        status: 'policy',
      },
      {
        id: 'can-admin-edit-completed-round',
        question: 'Can an organizer move a round after matches are booked?',
        answer: `Schedule regeneration protects committed rounds.

Rounds with completed, arranged, linked, ongoing, misarranged or already-started matches are locked from normal regeneration. This prevents a schedule change from silently invalidating real Hattrick bookings or results.`,
        status: 'current',
      },
      {
        id: 'replace-withdrawn-team',
        question: 'What happens if a team withdraws during the tournament?',
        answer: `First determine whether any fixtures are already arranged or completed.

A replacement, deactivation or schedule change can affect several rounds. The organizer should avoid changing committed matches and clearly announce how past and future fixtures will be treated.

The exact replacement workflow is still an administrative process and should be handled carefully.`,
        status: 'policy',
      },
    ],
  },
  {
    id: 'chat-and-help',
    title: 'Chat and help',
    order: 80,
    items: [
      {
        id: 'what-is-chat-for',
        question: 'When should I use tournament chat?',
        answer: `Use tournament chat for practical tournament coordination, including:

- arranging or confirming fixtures;
- reporting an unavailable opponent;
- explaining a warning or scheduling conflict;
- asking the organizer for help;
- sharing information relevant to other participants.

For important disputes, include enough detail for the organizer to understand what happened.`,
        status: 'current',
      },
      {
        id: 'difference-news-announcement-chat',
        question: 'Where should official tournament information be posted?',
        answer: `Use:

- **Chat** for active coordination and questions;
- **Team news** for a participant's tournament story or update;
- **Official news or announcements** for organizer decisions and information everyone should trust.

Important rule or schedule changes should be published clearly rather than left inside an old chat conversation.`,
        status: 'current',
      },
      {
        id: 'login-or-join-failed',
        question: 'Joining or login failed. What should I try?',
        answer: `Try the following:

1. return to the tournament page;
2. start the CHPP authorization again;
3. confirm you selected the intended Hattrick team;
4. allow reauthorization if Hattrick asks for it;
5. avoid opening several join attempts at the same time.

If it still fails, report the tournament, team and approximate time of the attempt to the site administrator.`,
        status: 'current',
      },
      {
        id: 'report-a-bug',
        question: 'What information makes a useful bug report?',
        answer: `Include:

- the tournament name or link;
- your team name and Hattrick team ID;
- what you expected;
- what actually happened;
- the fixture, round or page involved;
- a screenshot when useful;
- the approximate time of the problem.

Do not publish private authorization tokens, secrets or passwords.`,
        status: 'policy',
      },
      {
        id: 'is-ht120-affiliated-with-hattrick',
        question: 'Is HT-120min an official Hattrick product?',
        answer: `No. HT-120min is an independent community project and is not affiliated with Hattrick Ltd.

It uses Hattrick's authorized CHPP system for supported integrations.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'coming-next',
    title: 'Coming next',
    order: 90,
    items: [
      {
        id: 'direct-challenge-coming',
        question: 'Will HT-120min arrange friendlies automatically later?',
        answer: `Challenge and booking assistance is planned.

Until the tournament page explicitly confirms that a challenge was sent or accepted through a completed feature, managers must continue arranging tournament friendlies manually in Hattrick.`,
        status: 'coming-soon',
      },
      {
        id: 'automatic-round-recaps-coming',
        question: 'Will tournaments get automatic round reports?',
        answer: `Richer tournament news and automatic round summaries are planned areas of development.

Any generated report should use verified tournament facts and remain editable before publication. It should not invent match events, quotes or explanations.`,
        status: 'coming-soon',
      },
    ],
  },
];

export const getPublishedFaqSections = (): FaqSection[] => {
  if (!faqPublished) return [];

  return faqSections
    .filter((section) => section.published !== false)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.published !== false),
    }))
    .filter((section) => section.items.length > 0);
};

export const featuredFaqItems = getPublishedFaqSections()
  .flatMap((section) => section.items)
  .filter((item) => item.featured);

export const getFaqItemById = (id: string): FaqItem | undefined =>
  getPublishedFaqSections()
    .flatMap((section) => section.items)
    .find((item) => item.id === id);

export const searchFaqItems = (query: string): FaqItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return getPublishedFaqSections()
    .flatMap((section) => section.items)
    .filter((item) => `${item.question} ${item.answer}`.toLocaleLowerCase().includes(normalizedQuery));
};
