---
name: mobile-ui
description: Use when building or changing anything visible in apps/mobile (a screen, a shared component, a style, the theme, fonts, glass surfaces, the tab bar, on-screen text or translations), when a mobile UI box from UI-PLAN.md runs, or when a screen looks wrong in dark mode, clips Khmer text, ignores large text, or fails a contrast or accessibility check.
---

# Mobile UI (apps/mobile)

Every screen draws from one theme (`app/theme/`, imported as `@theme`), works in light and dark, in English
and Khmer, at large text sizes, and is seen on three simulators before it is done. Server rules stay on the
server; the UI shows what the stores hold.

## Ask first

None: the task box gives the screen and its API; this file gives the rules. If a value the design needs has
no token (a color, a size, a border width, a pressed or disabled opacity), add the token in `app/theme/` in
the same change, colors with a light and a dark value. If an existing token fails its contrast check, fix
the token's value in the same change and say so in the report. If `GlassSurface` or the contrast test does
not exist yet, create it as this file describes.

## Steps

1. **Read before writing.** Open `app/theme/index.ts` (the exports you may use), two neighbouring components,
   and the stores the task names. Check: you can list the tokens and store selectors you will use.
2. **Place the files.**
   - A screen is a folder `app/screens/<Name>/`: `<Name>Container.tsx` reads stores, calls actions, owns
     navigation and I/O; `<Name>Screen.tsx` takes plain props and callbacks only. Feature-only pieces go in
     `app/screens/<Name>/components/`; pieces two screens use go in `app/components/<Name>.tsx`.
   - Navigators and the `TabBar` live in `app/routes/`.
   Check: `grep -nE "stores/|services/|useNavigation" app/screens/<Name>/<Name>Screen.tsx` prints nothing.
3. **Style only from tokens.** `const useStyles = makeStyles((t) => ({ ... }))`, then `const s = useStyles()`.
   A state-dependent look is one more named style in `makeStyles`, picked in JSX. Never: a color literal
   (`'#..'`, `rgb(`, `'transparent'`, `'white'`: leave the property out instead), an inline object in
   `style={...}`, a raw number for spacing, radius, font size or an element size (add a token),
   `StyleSheet.create` outside `makeStyles`, a font name, or `fontWeight` (the weight is in the font file;
   Android drops to the system font when it is set). `StyleSheet.hairlineWidth` is allowed. Pressed and
   disabled looks use tokens too. Check: the grep in Verify prints nothing.
4. **Text that never clips.** Every text style spreads a `type.*` role. Keep `lineHeight >= 1.5 × fontSize`
   (Kantumruy Pro's own ascent + descent is 1.49 em; less clips Khmer marks above and below). No fixed
   `height` on text or anything around it (use `minHeight`). No `numberOfLines` on labels, buttons, titles or
   status text: they wrap. No `allowFontScaling={false}`; `maxFontSizeMultiplier` only where a screenshot showed
   the break, with a comment. Check: the screenshot at the largest text size in Khmer shows every label whole.
5. **Words through strings.** Every visible string is a key read with `useT()` in the Container or Screen, added
   to both `app/i18n/en.json` and `app/i18n/km.json`. Components take already-translated text as props.
   Check: the two JSON files have the same keys.
6. **Controls a screen reader can use.** Use `Pressable` (never `Touchable*`). Every control gets
   `accessibilityRole`, an `accessibilityLabel` and `accessibilityState` (`disabled`, `busy`, `checked`,
   `selected` as they apply), and a target of `touch.min` (44) via `minHeight`/`minWidth` or `hitSlop`.
   An async action: disabled + `busy` while it runs, ignores a second tap, shows the store's real value after a
   rejection, and puts the error inline next to the control (never `Alert`) with
   `accessibilityLiveRegion="polite"`. Check: a test finds each control by role and name.
7. **Screen structure.** Safe area from `react-native-safe-area-context`; scrolling content in a `ScrollView`
   with `contentInsetAdjustmentBehavior="automatic"`; data screens show loading, error (with retry), empty and
   content as four different states; forms use `keyboardShouldPersistTaps="handled"` and keep the submit
   button above the keyboard. Titles and back buttons come from the navigator's header options, not hand-built.
   State the OS owns (a permission, Reduce Transparency) is read in the Container and read again when
   `AppState` turns `'active'`, so returning from Settings updates the screen.
8. **Glass only through `GlassSurface`** (`app/components/GlassSurface.tsx`, see Example). It renders real
   glass only on iOS when `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()` are both true and
   Reduce Transparency is off; with Reduce Transparency on it is the solid `surface`; everywhere else the
   `surfaceGlass` token, no blur (Android blur is too slow on the phones used here).
   Check: text on it passes contrast over both `surfaceGlass` and `surface`.
9. **Tab bar** (in `app/routes/`): chosen once at startup. `isLiquidGlassAvailable()` true:
   `createNativeBottomTabNavigator` from `@react-navigation/bottom-tabs/unstable` (iOS 26 ignores
   `tabBarStyle` background and shadow there; icons are `{ type: 'image', source }` or `sfSymbol`). Otherwise
   `createBottomTabNavigator` with `tabBar={(p) => <TabBar {...p} />}`, our one bar for Android and iOS < 26.
   At most 5 tabs.
10. **Tests (React Native Testing Library), written first.** Query by role and name; cover every state the
    props allow; prove a disabled or busy control does not call its handler; test the Container's async path
    (resolve, reject → error shown, value unchanged); render once with `useColorScheme` mocked to `'dark'`
    when colors depend on state. No snapshots. The same change adds each new text/background color pair to the
    contrast test in `app/theme/` (4.5:1 text, 3:1 large text, icons and control borders, both themes).
    Check: the tests fail before the code exists, then pass.
11. **See it.** Run the gates, then [screenshots.md](screenshots.md). Check: you looked at every screenshot.

## Verify

```sh
pnpm --filter @lern/mobile lint && pnpm --filter @lern/mobile typecheck && pnpm --filter @lern/mobile test
grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(|'transparent'|'white'|'black'|fontWeight|fontFamily: '|style=\{\{|style=\{\[[^]]*\{ *[a-zA-Z]+:|allowFontScaling=\{false\}|Touchable" \
  apps/mobile/app --include='*.tsx' --exclude='*.test.tsx' | grep -v '^apps/mobile/app/theme/'
```
The grep prints nothing (a comment that names a banned word is the one false positive: reword it). Then the screenshot matrix in [screenshots.md](screenshots.md), every cell looked at.

## Common mistakes

| Mistake (seen in baseline runs) | Fix |
|---|---|
| `'transparent'` to keep variants the same height | Leave the color out; give the border to the variants that draw one |
| `numberOfLines={1}` on a button label | Let it wrap; Khmer and large text are longer |
| A screen file that imports stores | Container reads stores, Screen gets props |
| Glass gated by `isLiquidGlassAvailable()` only | Also `isGlassEffectAPIAvailable()` and Reduce Transparency |
| Color picked inline: `style={[s.card, { backgroundColor: c }]}` | A named style per state in `makeStyles` |
| `height: 8` for a status dot | A size token |
| Tests only in light mode, or no tests for a screen | Dark render where colors change; Container resolve/reject tests |
| "Check on device: light/dark, iOS/Android" | The full matrix in screenshots.md, Khmer and largest text included |

## Example

```tsx
// app/components/GlassSurface.tsx
export function GlassSurface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const reduce = useReduceTransparency(); // AccessibilityInfo.isReduceTransparencyEnabled() + 'reduceTransparencyChanged'
  if (canUseGlass && !reduce) return <GlassView style={[s.card, style]}>{children}</GlassView>;
  return <View style={[s.card, reduce ? s.solid : s.glass, style]}>{children}</View>;
}
const canUseGlass = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
const useStyles = makeStyles((t) => ({
  card: { borderRadius: radius.lg, padding: spacing.lg },
  glass: { backgroundColor: t.colors.surfaceGlass },
  solid: { backgroundColor: t.colors.surface },
}));
```

## Sources

See [references.md](references.md). Most important: `expo-glass-effect` 58.0.5 type docs,
`@react-navigation/bottom-tabs` 7.22.0 `unstable` types, Kantumruy Pro's font tables.
Last verified: 2026-11-18 against React Native 0.88, Expo SDK 58, React Navigation 7. Scenarios:
[tests/scenarios.md](tests/scenarios.md).
