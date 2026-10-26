import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalogValues, authorizedLocaleMenuOptions, englishCatalog, keysForSection, publicLocaleOptions, sectionForKey } from '../src/i18n/catalog.ts';
import { isValidCatalogMessage, validateCatalogValues } from '../src/i18n/catalog-validation.ts';
import { getDictionary } from '../src/i18n/get-dictionary.ts';

test('registered keys are assigned to their owning Forge sections', () => {
  assert.equal(sectionForKey('common.loadingPage'), 'System');
  assert.equal(sectionForKey('Home.chatWelcome'), 'Home');
  assert.equal(sectionForKey('Home.tinderTitle'), 'Tinder');
  assert.equal(sectionForKey('fixtures.autoArrangeTooltip'), 'TournamentView');
  assert.equal(sectionForKey('lobby.ready_to_join'), 'TournamentView');
  assert.equal(sectionForKey('CreateTournament.title'), 'CreateTournament');
  assert.equal(sectionForKey('ManagerProfiles.myProfile'), 'ManagerProfiles');
  assert.ok(keysForSection('System').includes('notFound.title'));
  assert.ok(Object.keys(englishCatalog).every((key) => keysForSection(sectionForKey(key)).includes(key)));
});

test('draft languages stay out of public navigation while beta keeps its visible state', () => {
  assert.deepEqual(publicLocaleOptions([
    { locale: 'en', status: 'implemented', native_name: 'English' },
    { locale: 'lv', status: 'draft', native_name: 'Latviešu' },
  ]).map((item) => item.locale), ['en']);
  assert.equal(publicLocaleOptions([
    { locale: 'en', status: 'implemented', native_name: 'English' },
    { locale: 'lv', status: 'beta', native_name: 'Latviešu' },
  ])[1].status, 'beta');
});

test('draft menu options are available only to admins and that language’s assigned editors', () => {
  const settings = [
    { locale: 'en', status: 'implemented', native_name: 'English', editor_ht_ids: [] },
    { locale: 'lv', status: 'draft', native_name: 'Latviešu', editor_ht_ids: [123] },
  ];
  assert.deepEqual(authorizedLocaleMenuOptions(settings, null, false).map((item) => item.locale), ['en']);
  assert.deepEqual(authorizedLocaleMenuOptions(settings, 456, false).map((item) => item.locale), ['en']);
  for (const [userId, admin] of [[123, false], [null, true]] as const) {
    const options = authorizedLocaleMenuOptions(settings, userId, admin);
    assert.deepEqual(options.map((item) => item.locale), ['en', 'lv']);
    assert.equal(options[1].status, 'draft');
    assert.ok(options.every((item) => !('editor_ht_ids' in item)));
  }
});

test('draft validation preserves ICU variables and registered rich text tags', () => {
  assert.equal(isValidCatalogMessage('Home.tinderActiveCount', '{count, plural, one {# komanda} other {# komandas}}'), true);
  assert.equal(isValidCatalogMessage('Home.tinderActiveCount', '{other}'), false);
  assert.equal(isValidCatalogMessage('Home.welcomeCreateTournament', 'Izveido <link>turnīru</link>'), true);
  assert.equal(isValidCatalogMessage('Home.welcomeCreateTournament', 'Izveido <script>turnīru</script>'), false);
  assert.equal(isValidCatalogMessage('Home.faq.items.what-is-ht-120min.answer', '[click](javascript:alert(1))'), false);
  assert.equal(validateCatalogValues({ 'Home.welcomeTitle': 'Sveiki!' }, 'Home')?.['Home.welcomeTitle'], 'Sveiki!');
  assert.equal(validateCatalogValues({ 'unknown.key': 'No' }, 'Home'), null);
});

test('published values override registered keys without mutating source or replacing English fallback with blanks', () => {
  const source = getDictionary('lv');
  const result = applyCatalogValues(source, {
    'Home.welcomeTitle': 'Sveicināti!',
    'CreateTournament.title': '',
    'unregistered.key': 'Ignored',
  });
  assert.equal(result.Home.welcomeTitle, 'Sveicināti!');
  assert.equal(result.CreateTournament.title, 'Create Tournament');
  assert.equal(source.Home.welcomeTitle, 'Laipni lūdzam HT-120min!');
  assert.equal('unregistered' in result, false);
});


test('Lobby intention translations and personal fixture labels retain their locale overrides', () => {
  assert.equal(getDictionary('lv').lobby.ready_to_join, 'Gatavs pievienoties');
  assert.equal(getDictionary('lv').PublicUI.FixturesView.myMatches, 'Manas spēles');
  assert.equal(getDictionary('en').lobby.open_to_invitations, 'Available as reserve');
});
