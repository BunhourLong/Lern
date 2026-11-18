# Sources (read 2026-11-18)

- `expo-glass-effect` 58.0.5 (npm tarball, `build/*.d.ts`, `build/GlassView.js`): exports `GlassView`,
  `GlassContainer`, `isLiquidGlassAvailable`, `isGlassEffectAPIAvailable`. `isLiquidGlassAvailable` stays true
  when Reduce Transparency is on (check `AccessibilityInfo.isReduceTransparencyEnabled()`);
  `isGlassEffectAPIAvailable` guards iOS 26 betas without the API (expo/expo#40911); off iOS `GlassView` is a
  plain `View`.
- `@react-navigation/bottom-tabs` 7.22.0 (npm tarball): `exports` has `./unstable` with
  `createNativeBottomTabNavigator`; `src/unstable/types.tsx`: `tabBarStyle.backgroundColor` "only supported on
  Android and iOS 18 and below", icons `{ type: 'image' | 'sfSymbol' }`, ScrollView insets set to `automatic`
  because the bar is translucent on iOS 26+.
- Kantumruy Pro: `google/fonts` `ofl/kantumruypro` ships only variable fonts; static weights
  (`KantumruyPro-Regular.ttf` … `-Bold.ttf`) are in `anagata-design/kantumruy-pro` `fonts/ttf/`. Name table of
  the variable font: PostScript `KantumruyPro-Regular`; OS/2 usWinAscent 1020, usWinDescent 468, unitsPerEm
  1000 (so a line box under 1.49 em clips).
- `xcrun simctl ui` (Xcode on this machine): `appearance`, `content_size`, `increase_contrast` only; executed
  on iPhone 17 Pro iOS 26.5 with `simctl io screenshot`.
- Android emulator API 37 (`Medium_Phone`): executed `cmd uimode night`, `settings put system font_scale`,
  `exec-out screencap -p`; `cmd locale set-app-locales` exists.
- Expo's `expo-native-ui` and `expo-design-system` skills (github.com/expo/skills, read 2026-11-18): four-state
  screens, keyboard and safe-area rules, `Pressable` only, inline errors not `Alert`, the "native slop" list.
  Not installed: both assume Expo Router, which this app does not use.
- The user's earlier React Native apps (local, not public): Container/Screen split, flat `components/`, a
  custom `TabBar` under `routes/`, per-platform font names. Their palette-named colors and single global
  StyleSheet are what this skill avoids.
- Baseline runs (DeepSeek V4.1 Flash, no skill): `tests/scenarios.md`.
