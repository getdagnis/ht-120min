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
        answer: `HT-120min helps organise recurring friendly tournaments. Its main promise is to keep fixtures, results, standings, live matches and tournament communication together, without spreadsheets, manual counting or scattered forum posts.`,
        status: 'current',
      },
      {
        id: 'only-for-120-minute-tournaments',
        question: 'Is it only for 120-minute tournaments?',
        answer: `HT-120min supports both 120-minute competitions and regular 90-minute points tournaments already, even simultaneously. More community-created formats and scoring systems may also be supported over time.`,
        status: 'current',
      },
      {
        id: 'is-ht-120min-free',
        question: 'Is HT-120min free?',
        answer: `Yes. Joining, participating in and organizing tournaments is free. There might be premium tournaments introduced in the future, but the core functionality will remain free for everyone.`,
        status: 'current',
      },
      {
        id: 'how-to-join-a-tournament',
        question: 'How do I join and play in a tournament?',
        answer: `Find a tourney that you like and is accepting teams, click **Join tournament** and authorize your Hattrick team through CHPP. As simple as that. Once the schedule is ready, arrange your listed friendlies in Hattrick as usual. Apart from joining and booking friendly matches, everything else is automated. HT-120min follows the matches and updates the tournament results and standings.`,
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
        answer: `HT-120min Tinder is a place to advertise that your team is looking for friendly opponents.

You can look for a single match, a regular 120-minute opponent or a longer-term friendly partnership.`,
        status: 'current',
      },
      {
        id: 'why-register-on-tinder',
        question: 'Why should I post my team there?',
        answer: `It's a chance to expose yourself to like-minded managers who are looking for a friendly match or a long-term partnership.

        You may not need a friendly partner today, but another manager looking for the right opponent could discover your team and contact you later.`,
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
        answer: `Choose **Create Tournament**, select the competition type and scoring format, then share the tournament page with the managers you want to invite.

When the teams are ready, generate the fixture schedule and manage the competition from its tournament page.`,
        status: 'current',
      },
      {
        id: 'private-league-or-federation',
        question: 'Can I use it for my league, federation or community?',
        answer: `Yes. HT-120min is designed for private leagues, federations, regional groups and other Hattrick communities that want to run recurring friendly competitions.

Even a small group of committed teams can create a worthwhile tournament.`,
        status: 'current',
      },
      {
        id: 'custom-scoring-formats',
        question: 'Can tournaments use custom rules or scoring systems?',
        answer: `The standard options currently include 120-minute scoring and regular points tournaments.

Organizers with an active community and a clear idea for another format are welcome to propose it for future support.`,
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
        id: 'tournament-what-is-it',
        question: 'What is a HT-120min tournament?',
        answer: `This is a recurring Hattrick friendly tournament organized by members of the community.

Instead of playing unrelated weekly friendlies, participating teams follow a shared fixture schedule and compete in tournament standings.`,
        status: 'current',
      },
      {
        id: 'tournament-how-it-works',
        question: 'How does the tournament work?',
        answer: `The organizer accepts teams and creates the fixture schedule.

Managers arrange their scheduled friendlies in Hattrick as usual. HT-120min then checks those matches, follows the results and updates the tournament standings.`,
        status: 'current',
      },
      {
        id: 'tournament-how-to-join',
        question: 'How do I join?',
        answer: `Join while tournament registration is open and select the Hattrick team you want to enter.

Once the schedule has been created, this page will show who you need to play and when.`,
        status: 'current',
      },
      {
        id: 'tournament-participant-responsibilities',
        question: 'What do I need to do after joining?',
        answer: `Check your upcoming fixtures and arrange the required friendlies with your opponents in Hattrick.

Joining does not automatically book matches, so participants are expected to follow the schedule and communicate when a match cannot be arranged.`,
        status: 'current',
      },
      {
        id: 'tournament-odd-team-count',
        question: 'What happens if there is an odd number of teams?',
        answer: `One team receives a BYE in each round, meaning it has no scheduled tournament opponent that week.

Depending on the tournament "house rules", the BYE may simply be a free round or the organizer may allow another friendly to count for that team.`,
        status: 'current',
      },
      {
        id: 'tournament-rearranged-match',
        question: 'What if we cannot play the fixture as scheduled?',
        answer: `Contact your opponent and the tournament organizer as early as possible.

The organizer can decide whether the match should be moved, replaced or resolved according to the tournament rules.`,
        status: 'current',
      },
      {
        id: 'tournament-finished',
        question: 'What happens when the tournament finishes?',
        answer: `The final results and standings remain available as tournament history.

Participating teams are then released and can join or create another tournament.`,
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
