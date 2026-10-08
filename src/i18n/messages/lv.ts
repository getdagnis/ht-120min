import en from './en';

const messages = {
  ...en,
  common: {
    ...en.common,
    language: 'Valoda',
    english: 'Angļu',
    latvian: 'Letiņu',
  },
  notFound: {
    title: 'Lapa nav atrasta',
    description: 'Šī lapa neeksistē vai ir pārvietota.',
    homeLink: 'Atgriezties sākumlapā',
  },
  fixtures: {
    ...en.fixtures,
    autoArrangeMyFixtures: 'Automātiski organizēt manus mačus',
    autoArrangeTeamFixtures: 'Automātiski organizēt {team} mačus',
    autoArrangeOn: 'ieslēgts',
    autoArrangeOff: 'izslēgts',
    autoArrangeTooltip: 'Tavus mačus sistēma centīsies noorganizēt automātiski. Ja otra komanda nebūs devusi šādu atļauju, tai tiks nosūtīts izaicinājums.',
    autoArrangeLoadError: 'Neizdevās ielādēt automātiskas organizēšanas statusu.',
  },
} as const;

export default messages;
