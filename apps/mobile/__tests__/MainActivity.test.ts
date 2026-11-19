import { readFileSync } from 'fs';
import { join } from 'path';

// react-native-screens can't restore its fragments: when Android recreates the activity (font size
// change, process death) with saved state, the app crashes on ScreenStackFragment. Its setup docs
// require dropping that state.
test('MainActivity applies AppTheme and drops saved state for react-native-screens', () => {
  const source = readFileSync(
    join(__dirname, '../android/app/src/main/java/com/lern/MainActivity.kt'),
    'utf8',
  );
  expect(source).toMatch(
    /override fun onCreate\(savedInstanceState: Bundle\?\)\s*\{\s*setTheme\(R\.style\.AppTheme\)\s*super\.onCreate\(null\)/,
  );
});
