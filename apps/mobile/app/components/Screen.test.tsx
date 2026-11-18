import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, useColorScheme } from 'react-native';
import { spacing, themes } from '@theme';
import { Screen } from './Screen';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}));

const mockColorScheme = jest.mocked(useColorScheme);

test.each(['light', 'dark'] as const)(
  'renders children on the %s background and forwards the safe-area edges',
  async scheme => {
    mockColorScheme.mockReturnValue(scheme);
    await render(
      <Screen edges={['bottom']}>
        <Text>Ride screen</Text>
      </Screen>,
    );
    const content = screen.getByText('Ride screen').parent;
    expect(screen.root?.type).toBe('SafeAreaView');
    expect(screen.root).toHaveProp('edges', ['bottom']);
    expect(StyleSheet.flatten(screen.root?.props.style)).toMatchObject({
      backgroundColor: themes[scheme].background,
      flex: 1,
    });
    expect(StyleSheet.flatten(content?.props.style)).toMatchObject({
      padding: spacing.md,
      flex: 1,
    });
  },
);

test('uses the SafeAreaView default when edges are omitted', async () => {
  await render(
    <Screen>
      <Text>Ride screen</Text>
    </Screen>,
  );
  expect(screen.root?.type).toBe('SafeAreaView');
  expect(screen.root?.props.edges).toBeUndefined();
});

test('adjusts scroll and keyboard insets and keeps taps on controls', async () => {
  await render(
    <Screen scroll>
      <Text>Ride screen</Text>
    </Screen>,
  );
  const [scrollView] = screen.container.queryAll(
    node => node.type === 'RCTScrollView',
  );
  expect(scrollView).toHaveProp('keyboardShouldPersistTaps', 'handled');
  expect(scrollView).toHaveProp('contentInsetAdjustmentBehavior', 'automatic');
  expect(scrollView).toHaveProp('automaticallyAdjustKeyboardInsets', true);
  expect(
    StyleSheet.flatten(scrollView.props.contentContainerStyle),
  ).toHaveProperty('padding', spacing.md);
});
