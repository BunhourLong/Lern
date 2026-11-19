import { readFileSync } from 'fs';
import { join } from 'path';
import { logoSize, themes } from '../app/theme';

const read = (file: string) =>
  readFileSync(join(__dirname, '..', file), 'utf8');
const ios = (file: string) => read(`ios/Lern/${file}`);
const android = (file: string) => read(`android/app/src/main/${file}`);
const assets = 'Images.xcassets';
const mark = read('design/brand/lern-mark.svg');
const path = mark.match(/<path [^>]* d="([^"]+)"/)?.[1];
const schemes = ['light', 'dark'] as const;

test('iOS launches with the centered mark and matches both theme appearances', () => {
  expect(ios('Info.plist')).toMatch(
    /<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/,
  );
  const project = read('ios/Lern.xcodeproj/project.pbxproj');
  const resources = project
    .split('/* Begin PBXResourcesBuildPhase section */')[1]
    ?.split('/* End PBXResourcesBuildPhase section */')[0];
  for (const file of ['LaunchScreen.storyboard', assets]) {
    expect(resources).toContain(`${file} in Resources */,`);
  }

  const storyboard = ios('LaunchScreen.storyboard');
  expect(storyboard).toContain('launchScreen="YES"');
  expect(storyboard).not.toContain('<label ');
  expect(storyboard.match(/<imageView\b[^>]+>/g)).toEqual([
    expect.stringContaining('contentMode="scaleAspectFit" image="LaunchMark"'),
  ]);
  const imageId = storyboard.match(/<imageView\b[^>]+ id="([^"]+)"/)?.[1];
  const viewId = storyboard.match(/<view key="view"[^>]+ id="([^"]+)"/)?.[1];
  for (const axis of ['centerX', 'centerY']) {
    expect(storyboard).toContain(
      `firstItem="${imageId}" firstAttribute="${axis}" secondItem="${viewId}" secondAttribute="${axis}"`,
    );
  }
  for (const side of ['width', 'height']) {
    expect(storyboard).toContain(
      `firstItem="${imageId}" firstAttribute="${side}" constant="${logoSize}"`,
    );
  }
  expect(storyboard).toContain(
    '<color key="backgroundColor" name="LaunchBackground"/>',
  );

  const imageSet = `${assets}/LaunchMark.imageset`;
  const { images } = JSON.parse(ios(`${imageSet}/Contents.json`));
  const { colors } = JSON.parse(
    ios(`${assets}/LaunchBackground.colorset/Contents.json`),
  );
  expect(images).toHaveLength(2);
  expect(colors).toHaveLength(2);
  for (const scheme of schemes) {
    const appearance =
      scheme === 'dark'
        ? [{ appearance: 'luminosity', value: 'dark' }]
        : undefined;
    const matchesScheme = (entry: { appearances?: unknown }) =>
      JSON.stringify(entry.appearances) === JSON.stringify(appearance);
    const image = images.find(matchesScheme);
    expect(image.idiom).toBe('universal');
    expect(ios(`${imageSet}/${image.filename}`)).toBe(
      mark.replace('fill="#89F597"', `fill="${themes[scheme].brand}"`),
    );
    const { color } = colors.find(matchesScheme);
    expect(color['color-space']).toBe('srgb');
    const { red, green, blue, alpha } = color.components;
    expect(Number(alpha)).toBe(1);
    const hex = [red, green, blue]
      .map(value =>
        Math.round(Number(value) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase();
    expect(`#${hex}`).toBe(themes[scheme].background);
  }
});

test('Android selects the OS-specific launch resource for MainActivity', () => {
  const manifest = android('AndroidManifest.xml');
  expect(manifest.match(/<application\b[^>]+>/)?.[0]).toContain(
    'android:theme="@style/AppTheme"',
  );
  const activity = manifest.match(
    /<activity\b[^>]+android:name="\.MainActivity"[^>]+>/,
  )?.[0];
  expect(activity).toContain('android:theme="@style/LaunchTheme"');
  expect(activity).toContain('android:windowSoftInputMode="adjustResize"');

  const styles = android('res/values/styles.xml');
  expect(styles).toMatch(
    /<style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">\s*(?:<!--[\s\S]*?-->\s*)?<item name="android:editTextBackground">@drawable\/rn_edit_text_material<\/item>/,
  );
  expect(styles).toMatch(
    /<style name="LaunchTheme" parent="AppTheme">[\s\S]*?<item name="android:windowBackground">@drawable\/launch_screen<\/item>/,
  );
  const modernStyles = android('res/values-v31/styles.xml');
  expect(modernStyles).toContain(
    '<style name="LaunchTheme" parent="AppTheme">',
  );
  expect(modernStyles).toContain(
    '<item name="android:windowSplashScreenBackground">@color/launch_background</item>',
  );
  expect(modernStyles).toContain(
    '<item name="android:windowSplashScreenAnimatedIcon">@drawable/launch_mark</item>',
  );
  const legacy = android('res/drawable/launch_screen.xml');
  expect(legacy).toContain(
    '<item android:drawable="@color/launch_background" />',
  );
  expect(legacy).toContain(
    '<item android:drawable="@drawable/launch_mark" android:gravity="center" />',
  );
});

test('Android launch drawable preserves the approved mark and both theme palettes', () => {
  const vector = android('res/drawable/launch_mark.xml');
  expect(vector.match(/<path\b[^>]*>/g)).toEqual([
    expect.stringContaining(`android:pathData="${path}"`),
  ]);
  expect(vector).toContain('android:fillColor="@color/launch_mark"');
  for (const scheme of schemes) {
    const qualifier = scheme === 'dark' ? 'values-night' : 'values';
    const colors = android(`res/${qualifier}/launch_colors.xml`);
    expect(colors).toContain(
      `<color name="launch_background">${themes[scheme].background}</color>`,
    );
    expect(colors).toContain(
      `<color name="launch_mark">${themes[scheme].brand}</color>`,
    );
  }
});
