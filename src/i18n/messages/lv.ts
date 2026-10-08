import en from './en';

const messages = {
  ...en,
  common: {
    ...en.common,
    language: 'Valoda',
  },
  notFound: {
    title: 'Lapa nav atrasta',
    description: 'Šī lapa neeksistē vai ir pārvietota.',
    homeLink: 'Atgriezties sākumlapā',
  },
  fixtures: {
    ...en.fixtures,
    autoArrangeMyFixtures: 'Gribu, lai mači organizējas paši',
    autoArrangeMyFixturesDisabled: 'Negribu, ka mači organizējas paši',
    autoArrangeTeamFixtures: 'Sarunāt {team} mačus automātiski',
    autoArrangeTeamFixturesDisabled: 'Nesarunāt {team} mačus automātiski',
    autoArrangeTooltip: 'Tavus mačus sistēma centīsies noorganizēt automātiski. Ja otra komanda nebūs devusi šādu atļauju, tad tai tiks nosūtīts izaicinājums.',
    autoArrangeLoadError: 'Neizdevās ielādēt automātiskas organizēšanas statusu.',
  },
  Home: {
    appName: 'HT-120min',
    forumTitle: 'Oficiālais HT-120min Hattrick forums',
    forumLink: 'HT-120min forums',
    forumDescription:
      'Ir jautājums, ideja, atradi kļūdu vai vienkārši gribi sasveicināties? Nāc uz mūsu Hattrick forumu! Mums kaut kā izdevās tikt pie pašiem sava! 😍',
    fallbackTournamentName: 'Turnīrs',
    welcomeImageAlt: 'Hattrick menedžeri gatavojas jaunai turnīru sezonai',
    welcomeTitle: 'Laipni lūdzam HT-120min!',
    welcomeProceed: 'Turpināt',
    welcomeIntro:
      'Kad kausu izcīņas tuvojas beigām, laiks sākt savējo ar automātiski sarunātiem draudzības mačiem!',
    welcomeHowTo: 'Kā sākt:',
    welcomeCreateTournament:
      'Ja esi šeit pirmoreiz, izveido savu pirmo <link>izmēģinājuma turnīru</link>',
    welcomeExploreManagement:
      'Izmēģini turnīra vadību ar testa Hattrick komandām',
    welcomeCreateRealCup:
      'Kad esi gatavs — izveido īstu turnīru un uzaicini citus piedalīties!',
    welcomeForumMore:
      'Vairāk uzzināsi HT-120min <link>Hattrick forumā</link>!',
    heroSubtitle:
      'Ar rokas mājienu organizē 120 minūšu vai parastu draudzības maču turnīrus, kuros sacensties ar citiem Hattrick menedžeriem. Bonusā — mači organizēsies paši.',
    createTournament: 'Izveidot turnīru',
    joinTournament: 'Pieteikties turnīram',
    featuredTournaments: 'Ieteiktie turnīri',
    allExoticHfiLeagues: 'Visas eksotiskās HFI līgas',
    allCollectionTournaments: 'Visi {title} turnīri',
    ongoingTournaments: 'Notiekošie turnīri',
    waitingParticipants: 'Gaida dalībniekus',
    weeklyReadFull: 'Lasīt visu',
    weeklyVisitCup: 'Apskatīt turnīru',
    weeklySectionTitle: '🗞 120min Weekly: Turnīru aktualitātes',
    monthlyBest: 'Mēneša labākie',
    topTenTeams: 'Top 10 komandas (120 min)',
    mostActive: 'Aktīvākie',
    perfectToolHeading: 'Viss nepieciešamais draudzības turnīriem',
    featureRunHeading: 'Organizē turnīrus, nevis Excel tabulas',
    featureRunDescription:
      'Izveido savu līgu vai kausu, vai pievienojies citu rīkotajiem turnīriem dažu minūšu laikā. HT-120min parūpēsies par spēļu kalendāru, pāriem un administrēšanu, lai tu varētu vairāk laika veltīt savai kopienai.',
    featureManagersHeading: 'Vairs nav jāskraida pakaļ menedžeriem',
    featureManagersDescription:
      'Automātiska spēļu sarunāšana, izaicinājumu uzraudzība, aktuālā turnīra tabula un spēļu rezultātu atjaunošana aiztaupīs lielu daļu no ikdienas administrēšanas.',
    featureRivalriesHeading: 'Veido sāncensību, ne tikai spēļu kalendāru',
    featureRivalriesDescription:
    'Sasniegumi, klubu profili, rekordi un kopienas reitingi pārvērš draudzības mačus ilgstošā sāncensībā ar savu vēsturi.',
},
} as const;

export default messages;
