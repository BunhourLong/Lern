import { act, cleanup, render, screen } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Animated,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { themes, type } from '@theme';
import { createConnectionStore } from '../stores/connection.store';
import { createSessionStore } from '../stores/session.store';
import { SyncStatusPill } from './SyncStatusToast';
import { SyncStatusToastContainer } from './SyncStatusToastContainer';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const me = { id: 'rider', phone: '+85512345678', roles: ['rider'] as const };
const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));
const alert = (name: string) => screen.getByRole('alert', { name });
const noAlert = () => expect(screen.queryByRole('alert')).toBeNull();

function setup(signedIn = true) {
  const connection = createConnectionStore();
  const session = createSessionStore();
  if (signedIn) session.getState().signedIn({ ...me, roles: [...me.roles] });
  else session.getState().signedOut();
  const toast = (
    <SyncStatusToastContainer connection={connection} session={session} />
  );
  return {
    mount: () => render(toast),
    network: (network: boolean | null) =>
      act(() => connection.setState({ network })),
    socket: (connected: boolean) =>
      act(() => connection.setState({ connected })),
    signOut: () => act(() => session.getState().signedOut()),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(useColorScheme).mockReturnValue('light');
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockClear();
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('caps the Khmer sync status label at 1.5 times its base size', async () => {
  const label = 'កំពុងភ្ជាប់ឡើងវិញ…';
  await render(<SyncStatusPill status="reconnecting" label={label} />);

  expect(screen.getByText(label)).toHaveProp('maxFontSizeMultiplier', 1.5);
});

test('shows reconnecting only after one second with a signed-in session', async () => {
  const home = setup();
  await home.mount();
  await advance(999);
  noAlert();
  await advance(1);
  expect(alert('Reconnecting…')).toBeOnTheScreen();
});

test('shows a sustained network outage and recovery while signed out', async () => {
  const home = setup(false);
  await home.mount();
  await advance(2000);
  noAlert();
  await home.network(false);
  await advance(999);
  noAlert();
  await advance(1);
  expect(alert('Offline')).toBeOnTheScreen();
  await home.network(true);
  expect(alert('Connected')).toBeOnTheScreen();
});

test('dismisses reconnecting without showing or announcing connected on sign-out', async () => {
  const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);
  const home = setup();
  await home.mount();
  await advance(1000);
  expect(alert('Reconnecting…')).toBeOnTheScreen();

  await home.signOut();
  noAlert();
  expect(
    screen.queryByText('Connected', { includeHiddenElements: true }),
  ).toBeNull();
  expect(announce.mock.calls).toEqual([['Reconnecting…']]);
  await advance(300);
  expect(
    screen.queryByText('Reconnecting…', { includeHiddenElements: true }),
  ).toBeNull();
});

test('swaps the visible warnings immediately and briefly shows connected on recovery', async () => {
  const home = setup();
  await home.mount();
  await advance(1000);
  expect(alert('Reconnecting…')).toBeOnTheScreen();
  await home.network(false);
  expect(alert('Offline')).toBeOnTheScreen();
  await home.network(true);
  expect(alert('Reconnecting…')).toBeOnTheScreen();
  await home.socket(true);
  expect(alert('Connected')).toBeOnTheScreen();
  await advance(1999);
  expect(alert('Connected')).toBeOnTheScreen();
  await advance(1);
  await advance(300);
  noAlert();
  expect(
    screen.queryByText('Connected', { includeHiddenElements: true }),
  ).toBeNull();
});

test('suppresses cold-start and later brief disconnects', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const home = setup();
  await home.mount();
  await advance(999);
  await home.socket(true);
  await advance(1000);
  noAlert();
  expect(announce).not.toHaveBeenCalled();

  await home.socket(false);
  await advance(1000);
  await home.socket(true);
  expect(alert('Connected')).toBeOnTheScreen();
  await home.network(false);
  await advance(500);
  expect(alert('Connected')).toBeOnTheScreen();
  await home.network(true);
  await advance(1500);
  await advance(300);
  noAlert();
  expect(
    screen.queryByText('Connected', { includeHiddenElements: true }),
  ).toBeNull();
  expect(announce.mock.calls).toEqual([['Reconnecting…'], ['Connected']]);
});

test('announces each status once and lets touches pass through', async () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  const home = setup();
  await home.mount();
  await advance(1000);
  expect(screen.getByTestId('sync-status-overlay')).toHaveProp(
    'pointerEvents',
    'none',
  );
  expect(alert('Reconnecting…')).toHaveProp('pointerEvents', 'none');
  expect(alert('Reconnecting…')).toHaveProp(
    'accessibilityLiveRegion',
    'polite',
  );
  await advance(1800);
  await home.network(true);
  await home.network(false);
  await home.socket(true);
  await home.network(true);
  await advance(2300);
  expect(announce.mock.calls).toEqual([
    ['Reconnecting…'],
    ['Offline'],
    ['Connected'],
  ]);
});

test('uses a JS slide and runs the pulse as one native animation on its own view', async () => {
  const spring = jest.spyOn(Animated, 'spring');
  const timing = jest.spyOn(Animated, 'timing');
  const loop = jest.spyOn(Animated, 'loop');
  await setup().mount();
  await advance(1000);
  const pill = alert('Reconnecting…');
  expect(spring).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({ useNativeDriver: false }),
  );
  expect(timing).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({ useNativeDriver: true, isInteraction: false }),
  );
  expect(timing).toHaveBeenCalledTimes(1);
  expect(loop).toHaveBeenCalledWith(timing.mock.results[0].value);
  expect(StyleSheet.flatten(pill.parent?.props.style).transform).toEqual([
    { scale: 1 },
  ]);
  expect(
    StyleSheet.flatten(pill.parent?.parent?.props.style).transform,
  ).toEqual([{ translateY: expect.stringMatching(/%$/) }]);
});

test('runs the pulse only while a warning is shown and stops it on recovery', async () => {
  const loop = jest.spyOn(Animated, 'loop');
  const home = setup();
  await home.mount();
  expect(loop).not.toHaveBeenCalled();
  await advance(1000);
  expect(alert('Reconnecting…')).toBeOnTheScreen();
  expect(loop).toHaveBeenCalledTimes(1);
  const stop = jest.spyOn(loop.mock.results[0].value, 'stop');

  await home.socket(true);
  expect(alert('Connected')).toBeOnTheScreen();
  expect(stop).toHaveBeenCalledTimes(1);
  await advance(2300);
  expect(loop).toHaveBeenCalledTimes(1);
});

test('cross-fades the fill on the native driver when a warning changes', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const home = setup();
  await home.mount();
  await advance(1000);
  timing.mockClear();
  await home.network(false);

  expect(alert('Offline')).toBeOnTheScreen();
  expect(timing).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({ toValue: 0, useNativeDriver: true }),
  );
});

test('uses only an opacity fade with Reduce Motion on and renders dark colors', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  jest.mocked(useColorScheme).mockReturnValue('dark');
  const spring = jest.spyOn(Animated, 'spring');
  const loop = jest.spyOn(Animated, 'loop');
  const home = setup();
  await home.mount();
  await advance(1000);
  const pill = alert('Reconnecting…');
  expect(StyleSheet.flatten(pill.props.style)).toHaveProperty(
    'backgroundColor',
    themes.dark.warning,
  );
  expect(
    StyleSheet.flatten(screen.getByText('Reconnecting…').props.style),
  ).toMatchObject({
    ...type.bodyStrong,
    color: themes.dark.onStatus,
  });
  expect(spring).not.toHaveBeenCalled();
  expect(loop).not.toHaveBeenCalled();
  await home.socket(true);
  expect(alert('Connected')).toBeOnTheScreen();
  await advance(2000);
  await advance(300);
  noAlert();
  expect(
    screen.queryByText('Connected', { includeHiddenElements: true }),
  ).toBeNull();
});

test('honors a Reduce Motion event that arrives before the initial read resolves', async () => {
  let resolveInitial!: (enabled: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(
    new Promise(resolve => {
      resolveInitial = resolve;
    }),
  );
  const listen = jest.spyOn(AccessibilityInfo, 'addEventListener').mockClear();
  const spring = jest.spyOn(Animated, 'spring');
  const loop = jest.spyOn(Animated, 'loop');
  await setup().mount();
  const [, onReduceMotionChanged] = listen.mock.calls.find(
    ([event]) => event === 'reduceMotionChanged',
  )!;
  await act(() => onReduceMotionChanged(true));
  await act(() => resolveInitial(false));
  await advance(1000);

  expect(alert('Reconnecting…')).toBeOnTheScreen();
  expect(spring).not.toHaveBeenCalled();
  expect(loop).not.toHaveBeenCalled();
});
