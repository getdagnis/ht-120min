const messages = {
  common: {
    appName: 'HT-120min',
    language: 'Language',
    english: 'English',
    latvian: 'Latvian',
  },
  notFound: {
    title: 'Page not found',
    description: 'This page doesn’t exist or may have moved.',
    homeLink: 'Back to home',
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
