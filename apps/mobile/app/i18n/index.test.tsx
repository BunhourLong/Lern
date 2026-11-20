import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import en from './en.json';
import { LanguageContext, languageOf, translate, useT } from './index';
import km from './km.json';

afterEach(() => jest.restoreAllMocks());

it.each([
  ['km', 'km'],
  ['km-KH', 'km'],
  ['KM_kh', 'km'],
  ['en-US', 'en'],
  ['fr', 'en'],
  ['', 'en'],
])('reads the language %p as %s', (tag, locale) => {
  expect(languageOf(tag)).toBe(locale);
});

it.each([
  ['en', 'Try again'],
  ['km', 'ព្យាយាមម្តងទៀត'],
] as const)('translates common.retry in %s', (language, text) => {
  expect(translate(language, 'common.retry')).toBe(text);
});

it.each(['driverApply.error', 'pin.incorrect'] as const)(
  'uses the common Khmer retry spelling in %s',
  key => {
    expect(translate('km', key)).toContain(translate('km', 'common.retry'));
  },
);

it('replaces string and number variables every time they appear', () => {
  jest.replaceProperty(en, 'common.retry', 'Hi {name}, {count} for {name}');
  expect(translate('en', 'common.retry', { name: 'Dara', count: 0 })).toBe(
    'Hi Dara, 0 for Dara',
  );
});

it('leaves a placeholder when its variable is missing', () => {
  jest.replaceProperty(en, 'common.retry', '{name} {x}');
  expect(translate('en', 'common.retry', { name: 'Dara' })).toBe('Dara {x}');
});

it('has the same keys in both catalogs', () => {
  expect(Object.keys(km).sort()).toEqual(Object.keys(en).sort());
});

it('has no empty translations in either catalog', () => {
  for (const value of [...Object.values(en), ...Object.values(km)]) {
    expect(value.trim()).not.toBe('');
  }
});

function Retry() {
  const t = useT();
  return <Text>{t('common.retry')}</Text>;
}

it('uses English by default', async () => {
  await render(<Retry />);
  expect(screen.getByText('Try again')).toBeOnTheScreen();
});

it('uses Khmer inside its language provider', async () => {
  await render(
    <LanguageContext.Provider value="km">
      <Retry />
    </LanguageContext.Provider>,
  );
  expect(screen.getByText('ព្យាយាមម្តងទៀត')).toBeOnTheScreen();
});
