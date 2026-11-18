# mobile-ui scenarios

Runner: `opencode-go/deepseek-v4.1-flash`, `variant: max` (user's choice 2026-11-18), via T3 `delegate_task`.
Fixture (`tests/fixture/`, stands in for `app/`): a theme and strings API as UI-PLAN §2 decides (`tests/fixture/app/theme/index.ts`, `tests/fixture/app/i18n/`).
Each run writes only into its own output folder. `<with-skill line>` is present only in GREEN runs.

## S1: Button component

Prompt:
> You work on a React Native 0.88 app (bare React Native CLI with Expo modules SDK 58, React Navigation 7,
> Zustand, TypeScript strict). The theme API is `<FIX>/app/theme/index.ts`, strings are `<FIX>/app/i18n/`.
> <with-skill line>
> Write `Button.tsx` and `Button.test.tsx` (for `app/components/`) into `<OUT>/`: variants primary, secondary
> and ghost; `loading` and `disabled`; a `label` prop. Tests use `@testing-library/react-native`. Do not run
> anything and do not change any file outside `<OUT>/`. Then report: the files written, what you checked, and
> what must still happen before this task counts as done (anything to run or see on a device).

Checks (pass = all):
1. No hex/rgb color, font-family string or raw number for spacing/radius/font size in the component.
2. Styles come from `makeStyles`/tokens; no inline style object literal in JSX.
3. `accessibilityRole="button"` and `accessibilityState` with `disabled` and `busy` (loading).
4. While loading, the label is still announced (accessibilityLabel or visible label kept).
5. Touch target ≥ 44 (`touch.min` via minHeight or hitSlop).
6. No `fontWeight` anywhere.
7. No fixed `height` around text (minHeight is fine); text style from `type.*`.
8. Tests: onPress not called when disabled and when loading; queries by role/label; no snapshot.
9. No `allowFontScaling={false}`.
10. Report names a contrast check for every new text/background pair in both themes and the screenshot matrix
    (iOS 26+, iOS 18.6, Android × light/dark × en/km).

## S2: Driver home screen

Prompt:
> Same app and fixture as S1. <with-skill line>
> Build the driver home screen: a card with a one-tap online/offline toggle, a connectivity line
> (connected / reconnecting / offline), and a banner when location permission is denied with a button that
> opens the phone's settings. Stores: `useDriverModeStore(s => s.online)` and its action `setOnline(on: boolean)`
> (async, can reject with a network error); `useConnectionStore(s => s.status)` is
> `'connected' | 'reconnecting' | 'offline'`. The card uses the app's glass look (`expo-glass-effect` 58 is
> installed). Write the files into `<OUT>/` laid out as under `app/` (screens, components, i18n additions). Do
> not run anything and do not change any file outside `<OUT>/`. Then report as in S1.

Checks (pass = all):
1. `screens/DriverHome/DriverHomeContainer.tsx` (stores, actions) + `DriverHomeScreen.tsx` (props only, no store import).
2. No hard-coded user-visible text; every new key in both `en.json` and `km.json`.
3. Glass: `GlassView` only when `isLiquidGlassAvailable()`; otherwise the `surfaceGlass` token; solid `surface`
   when Reduce Transparency is on (`AccessibilityInfo.isReduceTransparencyEnabled` + change listener); no blur
   library on Android.
4. Toggle: `accessibilityRole="switch"`, `accessibilityState.checked`, a label; disabled while `setOnline` is in
   flight; a rejected `setOnline` shows an error and the toggle shows the store's real value.
5. S1 checks 1, 2, 6, 7, 9 hold for every file.
6. Settings button calls `Linking.openSettings()`.
7. Report names the full screenshot matrix plus Reduce Transparency on, and Khmer at the largest text size.

Isolation: runners may read only the fixture and the skill folder. Lock everything else in the scratch folder
(`chmod 000` on drafts, `tests/`, earlier outputs) while they run: the first baseline read this file and was
discarded.

## Results 2026-11-18 (DeepSeek V4.1 Flash, max)

| Run | Result |
|---|---|
| S1 baseline | Fail 1, 7, 10: `'transparent'` ×2, `numberOfLines={1}` on the label, tests and report light-only, no contrast check, matrix "iOS/Android light/dark" without Khmer or iOS 18 |
| S2 baseline | Fail 1, 3, 5, 7: screen imports stores, glass gated by `isLiquidGlassAvailable()` only, no Reduce Transparency, 10 inline `{ color: ... }` objects in style arrays, raw `height: 8/12`, no tests, no Reduce Transparency shot |
| S1 GREEN | Pass 1–10; Verify grep empty; 12 variant × state combinations, dark render |
| S2 GREEN | Pass 1–7; Container/Screen split, both glass checks + Reduce Transparency listener, 13 tests, contrast pairs added |

Skill defects reported by GREEN runs and fixed: tokens for border width and pressed/disabled opacity, a
failing token is fixed in the same change, who edits the contrast test, debug-screen rule for components,
screenshot file names, create `GlassSurface`/contrast test when missing, re-read OS state on `AppState`
`'active'`. Not reproduced (no change): importing a value named `type` (tsc strict accepts it).

## Trigger check (6/6 on 2026-11-18)

Should load `mobile-ui`:
1. "The offer card's countdown text gets cut off in Khmer on Android, fix it"
2. "Add a Banner component to apps/mobile that shows when the driver is offline"
3. "Run the next UI-PLAN box: UI.2 fonts"

Should not (neighbour or none):
4. "The mobile app crashes parsing the ride snapshot after I added a field to RideDto" → contract-change
5. "Make the offline queue in apps/mobile retry with backoff when the API is down" → none
6. "Push a 'driver arrived' event to the rider's phone over the socket" → socket-event
