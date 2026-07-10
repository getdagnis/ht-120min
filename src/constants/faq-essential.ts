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

// Next FAQ questions:
// Q: Is this only for 120min friendly matches?
// A: No, it can be used for also regular friendly tournaments. The 120min scoring mode is the main focus but 90min system is also available.
// Participants can choose how they play their friendlies, it's only affecting their standings in the tournament. Of course, if you are playing
// in a 120min tournament, you should be dedicated to them so its fair to other participants, but the system does not enforce that.

// Q: Can I use this for my private league or federation?
// A: Yes, you can use this for your private league. You can create a tournament and invite your league teams to join. The system will
// handle the fixtures, results, standings, and basic communication for your league. Everyone can create a tournament as long as you don't
// have another team participating in one already, the success of your tournament depends only if you can also get participants to join it.

// Q: Will this stay free forever?
// A: Yes, most features will stay free forever. There's a possibility of some premium features in the future, but the core functionality will
// remain free for all users.

// Q: What possible premium features are planned?
// Premium Tournaments is something I'm considering right now, where organizer (or participants collectivelly) can pay a small fee to create
// a tournament with more advanced interactive features, statistics, tournament history etc. Premium Tournaments could also have
// custom developed features/tournament rules/system as requested by the organizer that could then be optional to be used also
// for other Premium Tournaments. But all the tournament creation and participation (standings, fixtures, admin, chat etc.)
// essentials will always be free.

// Q: Will there be a mobile app for this?
// A: There are no concrete plans for a mobile app at the moment. The website is designed to be mobile-friendly and should work well on most devices.
// However, technologies used and UI flexibility allows for a potential transition to a cross-platform mobile app.

export const faqSections: FaqSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    order: 1,
    items: [
      {
        id: 'what-is-ht-120min',
        question: 'What is HT-120min?',
        answer: `HT-120min is a CHPP tool for organizing recurring Hattrick friendly tournaments, with a special focus on matches that reach 120 minutes. It brings fixtures, results, standings, live match tracking and tournament communication into one place, with separate tournaments for regular league and Hattrick International teams.`,
        status: 'current',
      },
      {
        id: 'what-is-a-120-minute-tournament',
        question: 'What is a 120-minute tournament?',
        answer: `It is a friendly tournament where reaching extra time is part of the competition rather than an accidental bonus. In the main 120-minute scoring mode, the team that takes the most tournament friendlies to 120 minutes leads the table, with normal match statistics used to separate teams when needed. A tournament can still use ordinary points instead if the organizer prefers.`,
        status: 'current',
      },
      {
        id: 'how-to-join-a-tournament',
        question: 'How do I join a tournament?',
        answer: `Open a tournament that is still accepting teams and press **Join tournament**. Hattrick will ask you to authorize HT-120min through CHPP, after which you select the team you want to enter. Once the schedule is created, you will see who you need to play and when.`,
        status: 'current',
      },
      {
        id: 'how-a-tournament-works',
        question: 'How does a tournament work?',
        answer: `The organizer opens registration and invites teams. When enough teams have joined, the organizer generates the fixture schedule. Managers then arrange those friendlies in Hattrick as usual, while HT-120min checks whether the correct matches were booked, follows them live, records the results and updates the standings.`,
        status: 'current',
      },
      {
        id: 'create-and-organize-a-tournament',
        question: 'How do I create and organize a tournament?',
        answer: `Use **Create Tournament**, choose the competition type and scoring format, then share the tournament page with the managers you want to invite. When the field is ready, generate the schedule from the admin area. From there, the same page becomes your control centre for fixtures, results, standings, warnings, chat and tournament news.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'finding-people',
    title: 'Finding people to play with',
    order: 2,
    items: [
      {
        id: 'where-to-find-participants',
        question: 'Where can I find people for my tournament?',
        answer: `The best place to start is usually the Hattrick community you already belong to: your national forum, federation, regional group, private league or a circle of managers who regularly arrange friendlies. A small tournament with four to six committed teams is already enough to create something enjoyable. HT-120min Tinder can also help you discover managers who are actively looking for 120-minute matches or longer-term training partners.`,
        status: 'current',
      },
      {
        id: 'how-to-post-a-tinder-ad',
        question: 'How do I post an ad in HT-120min Tinder?',
        answer: `Open **HT-120min Tinder** and press **Post an Ad**. After signing in through CHPP, choose your team and describe what you are looking for: a 120-minute match or a more flexible friendly, home or away, domestic or international, and whether you want a one-off game or an ongoing partnership. You can also add a short message for other managers.`,
        status: 'current',
      },
      {
        id: 'what-are-long-term-ads',
        question: 'What are long-term ads in Tinder?',
        answer: `Long-term ads are for managers who are not necessarily free this week but want to find reliable future training partners. Instead of sending an immediate challenge, another manager can show interest and begin arranging future matches. They are especially useful for regular 120-minute partners, home-and-away exchanges and teams that want recurring friendlies without searching from scratch every week.`,
        status: 'current',
      },
    ],
  },
  {
    id: 'story-and-future',
    title: 'Why it exists and where it is going',
    order: 3,
    items: [
      {
        id: 'why-ht-120min-exists',
        question: 'Why does HT-120min exist?',
        answer: `HT-120min began with a very small Hattrick International community in Guam. There are only 13 Guam HFI managers in the entire Hattrick universe, yet six of them joined the first tournament season. That small success showed the basic idea: even a tiny community can create a lively recurring competition when schedules, results and coordination are kept in one place.

The project grew from that experiment. Instead of relying on spreadsheets, scattered forum posts and one manager doing everything by hand, HT-120min tries to make small friendly tournaments easy enough that more communities can run them.`,
        status: 'draft',
      },
      {
        id: 'where-ht-120min-is-going',
        question: 'Where is HT-120min going next?',
        answer: `The next goal is to make the coming Hattrick season feel much more active: more live tournaments, clearer tournament discovery and an easier path from finding one friendly to joining a recurring competition.

Over time, tournaments should also build lasting history. Managers could see past seasons, discover trusted training partners, compare performance across competitions and take part in a broader competitive ranking. Some organizers may also want special cups, community awards or tournaments with prizes. The direction is simple: make friendly matches easier to arrange, more meaningful to follow and worth remembering after the final round.`,
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

export const searchFaqItems = (query: string): FaqItem[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  return getPublishedFaqSections()
    .flatMap((section) => section.items)
    .filter((item) => `${item.question} ${item.answer}`.toLocaleLowerCase().includes(normalizedQuery));
};
