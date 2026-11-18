// Fixture for mobile-ui skill tests: the theme API UI-PLAN §2 decides (UI.1 builds the real one).
import { Platform, StyleSheet, useColorScheme } from 'react-native';

const light = {
  background: '#F7F7F5', surface: '#FFFFFF', surfaceGlass: 'rgba(255,255,255,0.72)',
  text: '#16181D', textMuted: '#5B606B', primary: '#0B6E4F', onPrimary: '#FFFFFF',
  border: '#D9DBE0', danger: '#B42318', success: '#067647', warning: '#B54708',
};
const dark: typeof light = {
  background: '#0F1115', surface: '#1A1D23', surfaceGlass: 'rgba(26,29,35,0.72)',
  text: '#F2F3F5', textMuted: '#A3A8B3', primary: '#4FD1A1', onPrimary: '#06281D',
  border: '#2C3039', danger: '#F97066', success: '#47CD89', warning: '#FDB022',
};
export type Colors = typeof light;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;
export const touch = { min: 44 } as const;

// iOS: PostScript name; Android: file name in android/app/src/main/assets/fonts. Never set fontWeight.
const f = (ios: string, android: string) => Platform.select({ ios, default: android });
export const fonts = {
  regular: f('KantumruyPro-Regular', 'KantumruyPro-Regular'),
  medium: f('KantumruyPro-Medium', 'KantumruyPro-Medium'),
  semibold: f('KantumruyPro-SemiBold', 'KantumruyPro-SemiBold'),
  bold: f('KantumruyPro-Bold', 'KantumruyPro-Bold'),
};
export const type = {
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 36 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 26 },
  button: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20 },
};

export type Theme = { colors: Colors; dark: boolean };
export function useTheme(): Theme {
  const dark_ = useColorScheme() === 'dark';
  return { colors: dark_ ? dark : light, dark: dark_ };
}
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(fn: (t: Theme) => T) {
  return () => { const t = useTheme(); return StyleSheet.create(fn(t)); };
}
export const themes = { light, dark };
