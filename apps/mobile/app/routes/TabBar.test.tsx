import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';
import { themes } from '@theme';
import { TabBar } from './TabBar';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const mockColorScheme = jest.mocked(useColorScheme);

beforeEach(() => {
  mockColorScheme.mockReturnValue('light');
});

async function setup(defaultPrevented = false) {
  const emit = jest.fn().mockReturnValue({ defaultPrevented });
  const dispatch = jest.fn();
  const state = {
    key: 'tabs-key',
    index: 0,
    routes: [
      { key: 'home-key', name: 'home' },
      { key: 'account-key', name: 'account' },
    ],
  } as BottomTabBarProps['state'];
  const descriptors = {
    'home-key': { options: { title: 'Home' } },
    'account-key': { options: { title: 'Account' } },
  } as unknown as BottomTabBarProps['descriptors'];
  const navigation = {
    emit,
    dispatch,
  } as unknown as BottomTabBarProps['navigation'];
  const icons = { home: { uri: 'home' }, account: { uri: 'account' } };
  await render(
    <TabBar
      state={state}
      descriptors={descriptors}
      navigation={navigation}
      icons={icons}
    />,
  );
  return { emit, dispatch };
}

const tab = (name: string) => screen.getByRole('tab', { name });

test('exposes a tablist with named tabs and their selected state', async () => {
  await setup();
  expect(
    screen.container.queryAll(
      node => node.props.accessibilityRole === 'tablist',
    ),
  ).toHaveLength(1);
  expect(tab('Home')).toBeSelected();
  expect(tab('Account')).not.toBeSelected();
});

test('applies the bottom safe-area inset to the tab bar', async () => {
  await setup();
  expect(screen.root?.props.edges).toHaveProperty('bottom', 'additive');
});

test('emits tabPress and navigates on an unfocused tab', async () => {
  const { emit, dispatch } = await setup();
  await fireEvent.press(tab('Account'));
  expect(emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'account-key',
    canPreventDefault: true,
  });
  expect(dispatch).toHaveBeenCalledWith({
    type: 'NAVIGATE',
    target: 'tabs-key',
    payload: { name: 'account' },
  });
});

test('emits tabPress without navigating on the focused tab', async () => {
  const { emit, dispatch } = await setup();
  await fireEvent.press(tab('Home'));
  expect(emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'home-key',
    canPreventDefault: true,
  });
  expect(dispatch).not.toHaveBeenCalled();
});

test('honors a prevented tabPress', async () => {
  const { emit, dispatch } = await setup(true);
  await fireEvent.press(tab('Account'));
  expect(emit).toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test('emits tabLongPress', async () => {
  const { emit, dispatch } = await setup();
  await fireEvent(tab('Account'), 'longPress');
  expect(emit).toHaveBeenCalledWith({
    type: 'tabLongPress',
    target: 'account-key',
  });
  expect(dispatch).not.toHaveBeenCalled();
});

test.each(['light', 'dark'] as const)(
  'uses the %s selected and unselected icon tints',
  async scheme => {
    mockColorScheme.mockReturnValue(scheme);
    await setup();
    const tint = (name: string) => {
      const [icon] = tab(name).queryAll(node => node.type === 'Image');
      return StyleSheet.flatten(icon.props.style).tintColor;
    };
    expect(tint('Home')).toBe(themes[scheme].primary);
    expect(tint('Account')).toBe(themes[scheme].textMuted);
  },
);
