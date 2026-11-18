# Screenshot check (end of every task that changes something visible)

A UI task is done only when the main session has looked at every cell below. Save the files under
`.superpowers/screens/<task-id>/` (private, never committed) as `<device>-<theme>-<lang>.png`, with
`<device>` one of `ios26`, `ios18`, `android` (e.g. `ios18-dark-km.png`, `android-light-km-xl.png`).

## Matrix

| Device (simulator) | Why | light en | light km | dark en | dark km |
|---|---|---|---|---|---|
| iPhone 17 Pro, iOS 26.5 | real glass, native tab bar | ✓ | ✓ | ✓ | ✓ |
| iPhone 16 Pro, iOS 18.6 | glass fallback, JS `TabBar` | ✓ | ✓ | ✓ | ✓ |
| Android `Medium_Phone` (API 37) | fallback, Android fonts | ✓ | ✓ | ✓ | ✓ |

Plus three extra shots: Khmer at the largest text size on iOS 26.5 and on Android, and, for a screen with glass,
iOS 26.5 with Reduce Transparency on. A shared component with no screen yet: the same task adds a section
showing all its states to the debug screen (`app/screens/Debug/`, reachable in `__DEV__`), then runs the
same matrix on it.

## Commands (run from the repo root)

Find the simulator ids: `xcrun simctl list devices available`.

```sh
# iOS: boot, set theme and text size, capture
xcrun simctl boot <udid> && xcrun simctl bootstatus <udid>
pnpm --filter @lern/mobile ios --udid <udid>        # unverified: build + install via the RN CLI
xcrun simctl ui <udid> appearance dark              # or light
xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large   # largest; reset with: large
xcrun simctl io <udid> screenshot .superpowers/screens/<task-id>/ios26-dark-km.png
```

Reduce Transparency has no `simctl` switch: turn it on in the simulator's Settings → Accessibility →
Display & Text Size.

```sh
# Android
ADB=~/Library/Android/sdk/platform-tools/adb
~/Library/Android/sdk/emulator/emulator -avd Medium_Phone &   # wait: $ADB shell getprop sys.boot_completed → 1
pnpm --filter @lern/mobile android                   # unverified: build + install via the RN CLI
$ADB shell pm grant com.lern android.permission.ACCESS_LOCAL_NETWORK   # API 37: else the app can't reach Metro
$ADB shell cmd uimode night yes                      # or no
$ADB shell settings put system font_scale 2.0        # largest; reset with 1.0
$ADB exec-out screencap -p > .superpowers/screens/<task-id>/android-dark-km.png
```

Language: switch with the app's in-app language setting. Per-app locale from the shell
(`$ADB shell cmd locale set-app-locales com.lern --locales km`) is unverified until the app declares its
locales.

## What to look for in each shot

- Nothing clipped: Khmer marks above and below the line, labels at the largest size, buttons whole.
- Dark mode: no white boxes, no unreadable text, borders still visible.
- Glass: real glass only on iOS 26.5; a flat translucent surface on iOS 18.6 and Android; solid with
  Reduce Transparency.
- Every control at least 44 pt, nothing under the notch, home indicator or keyboard.
