import { StrictMode } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { radius, spacing, themes } from '@theme';
import { GlassSurface } from './GlassSurface';

jest.mock('expo-glass-effect', () => ({
  GlassView: 'GlassView',
  isGlassEffectAPIAvailable: jest.fn(),
  isLiquidGlassAvailable: jest.fn(),
}));

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const originalPlatform = Platform.OS;
const mockColorScheme = jest.mocked(useColorScheme);
const mockGlassEffectAPIAvailable = jest.mocked(isGlassEffectAPIAvailable);
const mockLiquidGlassAvailable = jest.mocked(isLiquidGlassAvailable);
const remove = jest.fn();
let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
let onReduceTransparencyChanged: (enabled: boolean) => void;

beforeEach(() => {
  Platform.OS = 'ios';
  mockColorScheme.mockReturnValue('light');
  mockGlassEffectAPIAvailable.mockReturnValue(true);
  mockLiquidGlassAvailable.mockReturnValue(true);
  jest
    .spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled')
    .mockResolvedValue(false);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((event, handler) => {
      expect(event).toBe('reduceTransparencyChanged');
      onReduceTransparencyChanged = handler;
      return { remove };
    });
});

function unmount() {
  if (renderer) {
    act(() => renderer?.unmount());
    renderer = undefined;
  }
}

afterEach(() => {
  unmount();
  Platform.OS = originalPlatform;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function render(style?: StyleProp<ViewStyle>) {
  let result!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    result = ReactTestRenderer.create(
      <GlassSurface style={style}>
        <Text>Glass content</Text>
      </GlassSurface>,
    );
  });
  renderer = result;
  return result;
}

function glassViews(result: ReactTestRenderer.ReactTestRenderer) {
  return result.root.findAllByType(GlassView);
}

function expectFallback(
  result: ReactTestRenderer.ReactTestRenderer,
  backgroundColor: string,
) {
  expect(glassViews(result)).toHaveLength(0);
  const view = result.root.findByType(View);
  expect(StyleSheet.flatten(view.props.style).backgroundColor).toBe(
    backgroundColor,
  );
}

test('renders native glass with children and the shared card style', async () => {
  const result = await render();
  const glass = result.root.findByType(GlassView);
  expect(glass.findByType(Text).props.children).toBe('Glass content');
  expect(StyleSheet.flatten(glass.props.style)).toEqual({
    borderRadius: radius.lg,
    padding: spacing.lg,
  });
});

test('uses translucent glass when liquid glass is unavailable', async () => {
  mockLiquidGlassAvailable.mockReturnValue(false);
  expectFallback(await render(), themes.light.surfaceGlass);
});

test('uses translucent glass when the glass API is unavailable', async () => {
  mockGlassEffectAPIAvailable.mockReturnValue(false);
  expectFallback(await render(), themes.light.surfaceGlass);
});

test('uses translucent glass on Android even when both availability checks return true', async () => {
  Platform.OS = 'android';
  expectFallback(await render(), themes.light.surfaceGlass);
});

test('uses a solid surface when Reduce Transparency is enabled at mount', async () => {
  jest
    .mocked(AccessibilityInfo.isReduceTransparencyEnabled)
    .mockResolvedValue(true);
  expectFallback(await render(), themes.light.surface);
});

test('updates the surface as Reduce Transparency changes and unsubscribes on unmount', async () => {
  const result = await render();
  expect(glassViews(result)).toHaveLength(1);
  act(() => onReduceTransparencyChanged(true));
  expectFallback(result, themes.light.surface);
  act(() => onReduceTransparencyChanged(false));
  expect(glassViews(result)).toHaveLength(1);
  unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test.each([
  [false, themes.dark.surfaceGlass],
  [true, themes.dark.surface],
] as const)(
  'uses the dark palette with Reduce Transparency = %s',
  async (reduce, color) => {
    mockColorScheme.mockReturnValue('dark');
    mockLiquidGlassAvailable.mockReturnValue(false);
    jest
      .mocked(AccessibilityInfo.isReduceTransparencyEnabled)
      .mockResolvedValue(reduce);
    expectFallback(await render(), color);
  },
);

test.each([true, false])(
  'applies caller styles last with native glass = %s',
  async available => {
    mockLiquidGlassAvailable.mockReturnValue(available);
    const result = await render({ padding: spacing.sm });
    const surface = available
      ? glassViews(result)[0]
      : result.root.findByType(View);
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({
      borderRadius: radius.lg,
      padding: spacing.sm,
    });
  },
);

test('uses native glass while the initial Reduce Transparency read is pending', async () => {
  let resolve!: (enabled: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceTransparencyEnabled).mockReturnValue(
    new Promise<boolean>(settle => {
      resolve = settle;
    }),
  );
  const result = await render();
  expect(glassViews(result)).toHaveLength(1);
  act(() => onReduceTransparencyChanged(true));
  await act(async () => resolve(false));
  expectFallback(result, themes.light.surface);
});

test('ignores the cleaned-up effect’s Reduce Transparency read after a StrictMode remount', async () => {
  const firstRead = Promise.withResolvers<boolean>();
  const secondRead = Promise.withResolvers<boolean>();
  const read = jest.mocked(AccessibilityInfo.isReduceTransparencyEnabled);
  read
    .mockReturnValueOnce(firstRead.promise)
    .mockReturnValueOnce(secondRead.promise);

  // React Native's Jest preset defaults to a legacy root without effect replay.
  const options = { createNodeMock: () => null, unstable_isConcurrent: true };
  let result!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    result = ReactTestRenderer.create(
      <StrictMode>
        <GlassSurface>
          <Text>Glass content</Text>
        </GlassSurface>
      </StrictMode>,
      options,
    );
  });
  renderer = result;

  expect(read).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(glassViews(result)).toHaveLength(1);
  act(() => onReduceTransparencyChanged(true));
  expectFallback(result, themes.light.surface);
  await act(async () => firstRead.resolve(false));
  expectFallback(result, themes.light.surface);
});

test('uses native glass after a rejected Reduce Transparency read and still responds to changes', async () => {
  jest
    .mocked(AccessibilityInfo.isReduceTransparencyEnabled)
    .mockRejectedValueOnce(new Error('Reduce Transparency read failed'));

  const result = await render();
  expect(glassViews(result)).toHaveLength(1);
  act(() => onReduceTransparencyChanged(true));
  expectFallback(result, themes.light.surface);
});
