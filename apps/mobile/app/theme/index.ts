import { StyleSheet, useColorScheme } from 'react-native';
import { fonts } from './fonts';

export { fonts } from './fonts';

export type Colors = {
  background: string;
  surface: string;
  surfaceGlass: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  border: string;
  danger: string;
  success: string;
  warning: string;
  brand: string;
};

export const themes = {
  light: {
    background: '#F7F7F5',
    surface: '#FFFFFF',
    surfaceGlass: 'rgba(255, 255, 255, 0.78)',
    text: '#191919',
    textMuted: '#555555',
    primary: '#1B7339',
    onPrimary: '#FFFFFF',
    border: '#7C7C7C',
    danger: '#AB3030',
    success: '#276344',
    warning: '#80510A',
    brand: '#191919',
  },
  dark: {
    background: '#171717',
    surface: '#222222',
    surfaceGlass: 'rgba(34, 34, 34, 0.78)',
    text: '#F5F5F5',
    textMuted: '#B3B3B3',
    primary: '#89F597',
    onPrimary: '#171717',
    border: '#737373',
    danger: '#FF9292',
    success: '#82D5A3',
    warning: '#F5C16C',
    brand: '#89F597',
  },
} satisfies Record<'light' | 'dark', Colors>;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const touch = { min: 44 } as const;
export const iconSize = 24;
export const logoSize = 120;
export const opacity = { pressed: 0.92, disabled: 0.5 } as const;
export const outlineWidth = 1;
export const bannerEdgeWidth = 4;

export const type = {
  title: { fontSize: 24, lineHeight: 36, fontFamily: fonts.bold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontFamily: fonts.semiBold },
  button: { fontSize: 16, lineHeight: 24, fontFamily: fonts.semiBold },
  caption: { fontSize: 12, lineHeight: 18, fontFamily: fonts.regular },
};

export type Theme = { colors: Colors; dark: boolean };

export function useTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  return { colors: themes[dark ? 'dark' : 'light'], dark };
}

export function makeStyles<T extends Parameters<typeof StyleSheet.create>[0]>(
  fn: (theme: Theme) => T,
) {
  const sheets: Partial<Record<'light' | 'dark', T>> = {};
  return function useStyles(): T {
    const theme = useTheme();
    const scheme = theme.dark ? 'dark' : 'light';
    return (sheets[scheme] ??= StyleSheet.create(fn(theme)));
  };
}
