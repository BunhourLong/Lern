import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, useColorScheme } from 'react-native';
import { fonts, makeStyles, themes, type, useTheme } from '@theme';
import type { Theme } from '@theme';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  default: jest.fn(),
}));

const mockColorScheme =
  jest.mocked<() => string | null | undefined>(useColorScheme);

afterEach(() => jest.restoreAllMocks());

test('defines distinct light and dark palettes', () => {
  expect(themes.light).not.toEqual(themes.dark);
});

test.each([
  { scheme: 'dark', dark: true },
  { scheme: 'light', dark: false },
  { scheme: null, dark: false },
  { scheme: undefined, dark: false },
  { scheme: 'unspecified', dark: false },
])('uses dark = $dark for scheme $scheme', ({ scheme, dark }) => {
  mockColorScheme.mockReturnValue(scheme);
  let theme: Theme | undefined;
  function Probe() {
    theme = useTheme();
    return null;
  }

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Probe />);
  });
  expect(theme).toEqual({ colors: themes[dark ? 'dark' : 'light'], dark });
  act(() => renderer.unmount());
});

test('creates styles lazily and reuses each scheme’s sheet across renders', () => {
  const create = jest.spyOn(StyleSheet, 'create');
  const useStyles = makeStyles(theme => ({
    card: { backgroundColor: theme.colors.surface },
  }));
  expect(create).not.toHaveBeenCalled();

  const styles: ReturnType<typeof useStyles>[] = [];
  function Probe(_props: { render: number }) {
    styles.push(useStyles());
    return null;
  }

  mockColorScheme.mockReturnValue('dark');
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Probe render={1} />);
  });
  expect(create).toHaveBeenCalledTimes(1);
  act(() => renderer.update(<Probe render={2} />));

  mockColorScheme.mockReturnValue('light');
  act(() => renderer.update(<Probe render={3} />));
  act(() => renderer.update(<Probe render={4} />));

  mockColorScheme.mockReturnValue('dark');
  act(() => renderer.update(<Probe render={5} />));

  expect(styles).toHaveLength(5);
  expect(styles[0].card.backgroundColor).toBe(themes.dark.surface);
  expect(styles[1]).toBe(styles[0]);
  expect(styles[2].card.backgroundColor).toBe(themes.light.surface);
  expect(styles[3]).toBe(styles[2]);
  expect(styles[4]).toBe(styles[0]);
  expect(create).toHaveBeenCalledTimes(2);
  act(() => renderer.unmount());
});

test('keeps separate style caches for hooks using the same scheme', () => {
  mockColorScheme.mockReturnValue('light');
  const useSurfaceStyles = makeStyles(theme => ({
    card: { backgroundColor: theme.colors.surface },
  }));
  const useBackgroundStyles = makeStyles(theme => ({
    card: { backgroundColor: theme.colors.background },
  }));

  let styles!: [
    ReturnType<typeof useSurfaceStyles>,
    ReturnType<typeof useBackgroundStyles>,
  ];
  function Probe() {
    styles = [useSurfaceStyles(), useBackgroundStyles()];
    return null;
  }

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Probe />);
  });
  act(() => renderer.unmount());

  const [surface, background] = styles;
  expect(surface.card.backgroundColor).toBe(themes.light.surface);
  expect(background.card.backgroundColor).toBe(themes.light.background);
  expect(surface).not.toBe(background);
});

test.each([
  ['title', 'KantumruyPro-Bold'],
  ['body', 'KantumruyPro-Regular'],
  ['bodyStrong', 'KantumruyPro-SemiBold'],
  ['button', 'KantumruyPro-SemiBold'],
  ['caption', 'KantumruyPro-Regular'],
] as const)(
  '%s leaves room for Khmer marks and uses %s',
  (role, fontFamily) => {
    const style = type[role];
    expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize * 1.5);
    expect(style).toHaveProperty('fontFamily', fontFamily);
    expect(Object.values(fonts)).toContain(style.fontFamily);
    expect(style).not.toHaveProperty('fontWeight');
  },
);
