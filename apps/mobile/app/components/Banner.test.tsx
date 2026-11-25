import { render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { themes, type } from '@theme';
import { Banner } from './Banner';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockColorScheme = jest.mocked(useColorScheme);
const message = 'Connection lost · ដាច់ការតភ្ជាប់';

afterEach(() => jest.restoreAllMocks());

test('announces the message as a polite alert', async () => {
  await render(<Banner message={message} />);
  const alert = screen.getByRole('alert', { name: message });
  expect(alert).toHaveProp('accessibilityLiveRegion', 'polite');
});

test.each([
  ['ios', [[message], ['Reconnecting…']]],
  ['android', []],
] as const)(
  'uses the platform announcement behavior for banner messages on %s',
  async (platform, expectedCalls) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockClear()
      .mockImplementation(() => undefined);
    const { rerender } = await render(<Banner message={message} />);
    await rerender(<Banner message={message} tone="warning" />);
    await rerender(<Banner message="Reconnecting…" tone="warning" />);

    expect(announce.mock.calls).toEqual(expectedCalls);
  },
);

test.each(['light', 'dark'] as const)(
  'uses the %s banner colors',
  async scheme => {
    mockColorScheme.mockReturnValue(scheme);
    const { rerender } = await render(<Banner message={message} />);
    const colors = themes[scheme];
    const alert = () => screen.getByRole('alert', { name: message });
    expect(StyleSheet.flatten(alert().props.style)).toMatchObject({
      backgroundColor: colors.surface,
      borderLeftColor: colors.primary,
    });
    expect(
      StyleSheet.flatten(screen.getByText(message).props.style),
    ).toMatchObject({
      ...type.body,
      color: colors.text,
    });

    await rerender(<Banner message={message} tone="warning" />);
    expect(StyleSheet.flatten(alert().props.style)).toHaveProperty(
      'borderLeftColor',
      colors.warning,
    );

    await rerender(<Banner message={message} tone="danger" />);
    expect(StyleSheet.flatten(alert().props.style)).toHaveProperty(
      'borderLeftColor',
      colors.danger,
    );
  },
);
