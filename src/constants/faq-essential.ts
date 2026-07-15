export type FaqItemStatus = 'current' | 'draft' | 'planned';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  status: FaqItemStatus;
  published?: boolean;
}

export interface FaqSection {
  id: string;
  title: string;
  order: number;
  published?: boolean;
  items: FaqItem[];
}

export const faqPublished = true;

export const faqSections: FaqSection[] = [
  {
    id: 'getting-started',
    title: 'Joining and playing',
    order: 1,
    items: [
      {
        id: 'what-is-ht-120min',
        question: 'What is HT-120min?',
        answer: `HT-120min is a CHPP tool for organizing recurring Hattrick friendly tournaments. It brings fixtures, results, standings, live match tracking and tournament communication into one place, eliminating the need for spreadsheets, manual counting and scattered forum posts.`,
        status: 'current',
      },
      {
        id: 'only-for-120-minute-tournaments',
        question: 'Is HT-120min only for 120-minute tournaments?',
        answer: `No. The original focus is on tournaments where reaching 120 minutes affects the standings, but organizers can also run regular 90-minute points tournaments.

The longer-term goal is to support more community-created formats and scoring systems, not only one definition of how a friendly tournament should work.`,
        status: 'current',
      },
      {
        id: 'is-ht-120min-free',
        question: 'Is HT-120min free?',
        answer: `Yes. Joining, participating in and organizing tournaments through HT-120min is free. But any motivational BuyMeACoffee tips are welcome since maintaining and developing the platform is practically a full-time job.`,
        status: 'current',
      },
      {
        id: 'how-to-join-a-tournament',
        question: 'How do I join a tournament?',
        answer: `Open a tournament that is still accepting teams and press **Join tournament**. Hattrick will ask you to authorize HT-120min through CHPP, after which you can select the team you want to enter.

Once the organizer creates the schedule, the tournament page will show who you need to play and when.`,
        status: 'current',
      },
      {
        id: 'does-joining-commit-my-team',
        question: 'Am I committing my team by joining?',
        answer: `Joining does not automatically arrange friendlies or lock your team into matches. You remain responsible for managing your friendlies through Hattrick.

However, joining tells the organizer and other participants that you intend to take part. Please only join when you reasonably expect to follow the schedule, as missed matches can affect the whole tournament.`,
        status: 'current',
      },
      {
        id: 'how-a-tournament-works',
        question: 'How does a tournament work?',
        answer: `The organizer opens registration and invites teams. When the field is ready, the organizer generates the fixture schedule.

Managers then arrange the required friendlies in Hattrick as usual. HT-120min checks the scheduled matches, follows them live, records the results and updates the tournament standings.`,
        status: 'current',
      },
      {
        id: 'how-standings-are-calculated',
        question: 'How are the standings calculated?',
        answer: `The scoring system depends on the tournament format chosen by the organizer.

In a 120-minute tournament, reaching extra time is part of the competition and teams are primarily ranked by how often they take their tournament matches to 120 minutes. Regular tournaments can instead use a traditional points table.

More scoring formats and alternative ways to view the standings may be added as the platform develops.`,
        status: 'current',
      },
      {
        id: 'cannot-continue-tournament',
        question: 'What happens if I can no longer continue?',
        answer: `Contact the organizer as early as possible. The organizer can then decide how to handle your remaining fixtures and explain the fairest option to the other participants.

There is no platform penalty for leaving, but disappearing without notice can create unnecessary work and spoil the experience for the rest of the tournament.`,
        status: 'current',
      },
      {
        id: 'where-to-find-tournaments',
        question: 'Where can I find tournaments to join?',
        answer: `Available tournaments can be discovered through HT-120min and through the Hattrick communities that organize them.

National forums, federations, regional groups, private leagues and existing circles of friendly partners are usually the best places to hear about new tournaments.`,
        status: 'current',
      },
      {
        id: 'why-join-a-friendly-tournament',
        question: 'Why join a tournament instead of playing ordinary friendlies?',
        answer: `A tournament gives your midweek friendlies an extra purpose. Instead of arranging an isolated match and forgetting about it, you have fixtures to follow, standings to compete in and a community of familiar opponents.

It turns a normally quiet part of the Hattrick week into an additional competition with its own stories, rivalries and memorable matches.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'finding-friendly-partners',
    title: 'Finding friendly partners',
    order: 2,
    items: [
      {
        id: 'what-is-ht-120min-tinder',
        question: 'What is HT-120min Tinder?',
        answer: `HT-120min Tinder is a place for managers to post one-to-one friendly advertisements, similar to looking for an opponent through a Hattrick forum.

It is separate from tournaments and is intended for managers who want to find a single match, a 120-minute partner or a longer-term friendly arrangement.`,
        status: 'current',
      },
      {
        id: 'how-to-post-a-tinder-ad',
        question: 'How do I post a friendly ad?',
        answer: `Open **HT-120min Tinder** and press **Post an Ad**. After signing in through CHPP, choose your team and describe what you are looking for.

You can specify details such as 120-minute or regular friendlies, home or away, domestic or international opponents and whether you want a one-off match or an ongoing partnership.`,
        status: 'current',
      },
      {
        id: 'what-are-long-term-ads',
        question: 'What are long-term friendly ads?',
        answer: `Long-term ads are for managers who want to find reliable future opponents rather than arrange only one immediate match.

They can be useful for recurring 120-minute partners, home-and-away exchanges, regular training matches or managers who prefer not to search for a new opponent every week.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'organizing-tournaments',
    title: 'For tournament organizers',
    order: 3,
    items: [
      {
        id: 'create-and-organize-a-tournament',
        question: 'How do I create a tournament?',
        answer: `Use **Create Tournament**, choose the competition type and scoring format, then share the tournament page with the managers you want to invite.

When enough teams have joined, generate the schedule from the admin area. The tournament page then becomes your control centre for participants, fixtures, results, standings, warnings, chat and tournament news.`,
        status: 'current',
      },
      {
        id: 'private-league-or-federation',
        question: 'Can I use HT-120min for a private league or federation?',
        answer: `Yes. Private leagues, federations, regional groups and other Hattrick communities can create their own tournaments and invite their members to join.

HT-120min can handle the schedule, results, standings and basic tournament communication, while the community remains responsible for recruiting participants and setting its own expectations.`,
        status: 'current',
      },
      {
        id: 'where-to-find-participants',
        question: 'Where can I find participants for my tournament?',
        answer: `Start with a Hattrick community you already belong to: a national forum, federation, regional group, private league or an existing circle of friendly partners.

You do not need a large audience. A small group of four to six committed teams can already create an enjoyable recurring tournament.`,
        status: 'current',
      },
      {
        id: 'organizer-responsibilities',
        question: 'What is the tournament organizer responsible for?',
        answer: `The organizer decides the format, invites participants, creates the fixture schedule and handles situations that cannot be resolved automatically.

The most important responsibility is communication: make the rules clear, remind managers about upcoming fixtures and deal with withdrawals or missed matches consistently and fairly.`,
        status: 'current',
      },
      {
        id: 'custom-scoring-formats',
        question: 'Can HT-120min support custom rules or scoring systems?',
        answer: `The standard formats currently focus on 120-minute scoring and regular points tournaments.

More unusual community formats—such as scoring based on discipline, injuries or other match events—may require additional development. HT-120min is intended to grow toward supporting more organizer-created formats where there is a serious community ready to use them.`,
        status: 'planned',
      },
      {
        id: 'collaborate-on-tournament-format',
        question: 'Can I propose a tournament format for my community?',
        answer: `Yes. Organizers representing an active federation, league or established community are welcome to propose formats that would not fit the standard tournament settings.

The best proposals have clear rules, committed participants and a realistic plan for running the competition. Custom development cannot be guaranteed, but serious formats can be discussed and considered for broader support.`,
        status: 'planned',
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

export const getFaqItemById = (id: string): FaqItem | undefined =>
  getPublishedFaqSections()
    .flatMap((section) => section.items)
    .find((item) => item.id === id);

export const getTournamentFaqSections = (): FaqSection[] => [
  {
    id: 'tournament-faq',
    title: 'Tournament FAQ',
    order: 1,
    items: [
      {
        id: 'tournament-how-it-works',
        question: 'How does this tournament work?',
        answer: `The organizer opens registration, creates the schedule and uses this page to manage fixtures, results, standings, news and chat.

Managers still arrange their friendlies in Hattrick. HT-120min checks those Hattrick matches, links them to tournament fixtures and updates results when match data is available.`,
        status: 'current',
      },
      {
        id: 'tournament-bye-result',
        question: 'Can a BYE round still count?',
        answer: `A BYE means your team has no tournament opponent in that round.

If the organizer's house rules allow it, the admin can manually enter an outside-friendly result or link a specific Hattrick match ID. In that case, the result counts only for the tournament team that had the BYE.`,
        status: 'current',
      },
      {
        id: 'tournament-linked-match-id',
        question: 'Why would an organizer link a Match ID manually?',
        answer: `Manual Match ID linking is for exceptions.

Examples include a BYE team playing an outside friendly, two teams moving their match to a different friendly slot, or an organizer choosing to count a related match even when the automatic checker would not select it.`,
        status: 'current',
      },
      {
        id: 'tournament-moved-friendly',
        question: 'Can a rearranged friendly still count?',
        answer: `Yes, if the tournament organizer decides it should.

The automatic checker looks for the expected fixture. If teams play on another date or in another valid friendly slot, the organizer can link that Hattrick match manually so HT-120min follows it and records the result.`,
        status: 'current',
      },
      {
        id: 'tournament-one-team-linked',
        question: 'Why can a linked match count when only one tournament team is detected?',
        answer: `This gives organizers flexibility for real-world exceptions and test tournaments.

If one scheduled team is detected in the linked Hattrick match, HT-120min can map that team's score into the fixture. The organizer can still edit the recorded result afterwards if the tournament rules require a different interpretation.`,
        status: 'current',
      },
      {
        id: 'tournament-finished-release',
        question: 'What happens when all rounds are finished?',
        answer: `When all real tournament fixtures are completed or resolved, the tournament becomes finished.

Finished tournaments remain visible as history, but teams are released from active participation so they can join or create other tournaments.`,
        status: 'current',
      },
      {
        id: 'tournament-paused',
        question: 'What does it mean when a tournament is paused?',
        answer: `A paused tournament is postponed, not ended.

Teams can still join and admins can manage participants, but schedule generation and rescheduling are hidden until the organizer sets the tournament active again. Existing teams are still treated as active participants, so they cannot freely join another real tournament while the tournament is only paused.`,
        status: 'current',
      },
      {
        id: 'tournament-stopped',
        question: 'What does it mean when a tournament is fully stopped?',
        answer: `A fully stopped tournament is halted and unpublished from public lists.

Its teams may join other tournaments. If the organizer later wants to continue, the tournament must first move back to paused, and any team already playing elsewhere must be removed or replaced before the tournament can continue.`,
        status: 'current',
      },
      {
        id: 'tournament-admin-missing',
        question: 'What should I do if the tournament admin is missing?',
        answer: `First try contacting the organizer through Hattrick or the tournament chat.

If they are not responding, [report it](https://stage.hattrick.org/MyHattrick/Inbox/?actionType=newMail&userId=8777402) with the subject **Admin missing** and include the tournament URL.`,
        status: 'current',
      },
    ],
  },
];

export const searchFaqItems = (query: string): FaqItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return getPublishedFaqSections()
    .flatMap((section) => section.items)
    .filter((item) => `${item.question} ${item.answer}`.toLocaleLowerCase().includes(normalizedQuery));
};
