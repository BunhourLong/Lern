import { readFileSync } from 'fs';
import { join } from 'path';

const read = (file: string) =>
  readFileSync(join(__dirname, '..', file), 'utf8');

test('reads the Android Maps key from local properties or the environment', () => {
  const gradle = read('android/app/build.gradle');
  expect(gradle).toContain('rootProject.file("local.properties")');
  expect(gradle).toContain('getProperty("GOOGLE_MAPS_API_KEY")');
  expect(gradle).toContain('System.getenv("GOOGLE_MAPS_API_KEY") ?: ""');
  expect(gradle).toContain(
    'manifestPlaceholders = [GOOGLE_MAPS_API_KEY: googleMapsApiKey]',
  );
  expect(gradle).toContain(
    'buildConfigField "boolean", "HAS_GOOGLE_MAPS_API_KEY", "${!googleMapsApiKey.isEmpty()}"',
  );
  expect(read('.gitignore')).toMatch(/^local\.properties$/m);
  expect(gradle).not.toMatch(/AIza[\w-]{35}/);
});

test('uses the Gradle placeholder for Android Google Maps metadata', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  expect(manifest).toMatch(
    /<meta-data\s+android:name="com\.google\.android\.geo\.API_KEY"\s+android:value="\$\{GOOGLE_MAPS_API_KEY\}"\s*\/>/,
  );
  expect(manifest).not.toMatch(/AIza[\w-]{35}/);
});

test('passes the build flag to React Native as a launch option', () => {
  const activity = read('android/app/src/main/java/com/lern/MainActivity.kt');
  expect(activity).toMatch(/override fun getLaunchOptions\(\): Bundle/);
  expect(activity).toContain(
    'putBoolean("androidMapsConfigured", BuildConfig.HAS_GOOGLE_MAPS_API_KEY)',
  );
});
