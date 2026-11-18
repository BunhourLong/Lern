import { render, screen } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';
import { themes, type } from '@theme';
import { Text } from './Text';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockColorScheme = jest.mocked(useColorScheme);

beforeEach(() => mockColorScheme.mockReturnValue('light'));

test.each(Object.keys(type) as (keyof typeof type)[])(
  'uses the font size for the %s role',
  async role => {
    await render(<Text role={role}>Ride details</Text>);
    expect(
      StyleSheet.flatten(screen.getByText('Ride details').props.style),
    ).toHaveProperty('fontSize', type[role].fontSize);
  },
);

test.each([
  ['default', 'text'],
  ['muted', 'textMuted'],
  ['danger', 'danger'],
] as const)('uses the light color for the %s tone', async (tone, color) => {
  await render(<Text tone={tone}>Ride details</Text>);
  expect(
    StyleSheet.flatten(screen.getByText('Ride details').props.style),
  ).toHaveProperty('color', themes.light[color]);
});

test('makes the title a header and passes through native text props', async () => {
  await render(
    <Text role="title" accessibilityLiveRegion="polite" testID="ride-title">
      Ride details
    </Text>,
  );
  const heading = screen.getByRole('header', { name: 'Ride details' });
  expect(heading).toHaveProp('accessibilityLiveRegion', 'polite');
  expect(heading).toHaveProp('testID', 'ride-title');
});

test('defaults to body text in the dark theme', async () => {
  mockColorScheme.mockReturnValue('dark');
  await render(<Text>Ride details</Text>);
  expect(
    StyleSheet.flatten(screen.getByText('Ride details').props.style),
  ).toMatchObject({ ...type.body, color: themes.dark.text });
});
