const messages = {
  Home: {
    appName: 'HT-120min',
    forumTitle: 'Official HT-120min Hattrick forum',
    forumLink: 'HT-120min forum',
    forumDescription:
      'Have a question, an idea, found a bug or just want to say hi? Come and do so on our Hattrick forum! They somehow gave us one of our own! 😍',
    fallbackTournamentName: 'Tournament',
    welcomeImageAlt: 'Hattrick managers preparing for a new tournament season',
    welcomeTitle: 'Welcome to HT-120min!',
    welcomeProceed: 'Proceed',
    welcomeIntro: "When cups are finishing, it's time to launch one for auto-arranged friendlies!",
    welcomeHowTo: "Here's how:",
    welcomeCreateTournament: "If you're new here, create your first <link>dummy test tournament</link>",
    welcomeExploreManagement: 'Explore tournament management using dummy Hattrick teams',
    welcomeCreateRealCup: 'Once ready — create a real cup and invite others to join!',
    welcomeForumMore: 'Visit HT-120min <link>Hattrick forum</link> for more!',
    heroSubtitle:
      'Organise 120 min tournaments and recurring friendlies with ease by getting together with other like-minded Hattrick managers.',
    createTournament: 'Create Tournament',
    joinTournament: 'Join Tournament',
    featuredTournaments: 'Featured Tournaments',
    allExoticHfiLeagues: 'All Exotic HFI Leagues',
    allCollectionTournaments: 'All {title} tournaments',
    ongoingTournaments: 'Ongoing Tournaments',
    waitingParticipants: 'Waiting Participants',
    weeklyReadFull: 'Read full',
    weeklyVisitCup: 'Visit cup',
    weeklySectionTitle: '🗞 120min Weekly: In the tournaments',
    monthlyBest: 'Monthly Best',
    topTenTeams: 'Top 10 Teams (120m)',
    mostActive: 'Most Active',
    perfectToolHeading: 'The perfect tool for friendly tournaments',
    featureRunHeading: 'Run tournaments, not spreadsheets',
    featureRunDescription:
      'Create or join leagues, cups and recurring competitions in minutes. HT-120min handles schedules, fixtures and administration so you can focus on your community.',
    featureManagersHeading: 'Never chase managers again',
    featureManagersDescription:
      'Automatic scheduling, challenge tracking, live standings and match updates eliminate most of the repetitive work that makes tournament administration painful.',
    featureRivalriesHeading: 'Build rivalries, not just fixtures',
    featureRivalriesDescription:
      'Achievements, club profiles, records and community leaderboards turn friendly matches into long-term stories managers actually care about.',
  },
  common: {
    appName: 'HT-120min',
    language: 'Language',
  },
  fixtures: {
    autoArrangeMyFixtures: 'Auto-arrange my fixtures',
    autoArrangeTeamFixtures: 'Auto-arrange {team} fixtures',
    autoArrangeOn: 'on',
    autoArrangeOff: 'off',
    autoArrangeTooltip: 'Your matches will be auto-arranged if the other team has this feature on as well. If not, an automatic challenge will be sent to them.',
    autoArrangeLoadError: 'Auto-arrange status could not be loaded.',
  },
} as const;

export default messages;
